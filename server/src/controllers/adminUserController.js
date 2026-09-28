const prisma = require("../prisma");

const ALLOWED_ROLES = ["CUSTOMER", "PROVIDER", "ADMIN"];

function getRoleLabel(role) {
    if (role === "ADMIN") return "Admin";
    if (role === "PROVIDER") return "Booster";
    return "Customer";
}

async function adminListUsers(req, res) {
    try {
        const page = Math.max(Number(req.query.page || 1), 1);
        const pageSize = Math.min(Math.max(Number(req.query.pageSize || 20), 1), 50);
        const q = String(req.query.q || "").trim();
        const role = String(req.query.role || "").trim();
        const viewerId = req.user?.id || req.user?.userId;
        const viewer = viewerId ? await prisma.user.findUnique({ where: { id: viewerId }, select: { isOwner: true, role: true, suspendedAt: true } }) : null;
        const canManageExtraRoles = Boolean(viewer?.isOwner && viewer.role === "ADMIN" && !viewer.suspendedAt);

        const where = {};

        if (q) {
            where.OR = [
                { email: { contains: q, mode: "insensitive" } },
                { username: { contains: q, mode: "insensitive" } },
                {
                    profile: {
                        displayName: { contains: q, mode: "insensitive" },
                    },
                },
            ];
        }

        if (role === "OWNER") { where.isOwner = true; }
        if (role && ALLOWED_ROLES.includes(role)) {
            where.role = role;
            where.isOwner = false;
        }

        // Pin the signed-in account before pagination, not just within its current page.
        const pinned = viewerId ? await prisma.user.count({ where: { AND: [where, { id: viewerId }] } }) : 0;
        const start = (page - 1) * pageSize;
        const select = {
            id: true, username: true, email: true, role: true, isOwner: true,
            hasBoosterAccess: true, suspendedAt: true, suspendedReason: true,
            createdAt: true, updatedAt: true, emailVerifiedAt: true,
            profile: { select: { displayName: true, profileImageUrl: true } },
        };
        const [others, first, total] = await Promise.all([
            prisma.user.findMany({
                where: pinned ? { AND: [where, { id: { not: viewerId } }] } : where,
                orderBy: [{ createdAt: "desc" }, { id: "asc" }],
                skip: Math.max(0, start - pinned),
                take: pageSize - (page === 1 ? pinned : 0),
                select,
            }),
            pinned && page === 1 ? prisma.user.findUnique({ where: { id: viewerId }, select }) : null,
            prisma.user.count({ where }),
        ]);

        return res.json({
            items: first ? [first, ...others] : others,
            canManageExtraRoles,
            total,
            page,
            pageSize,
        });
    } catch (error) {
        console.error("adminListUsers error:", error);
        return res.status(500).json({ message: "Failed to load users" });
    }
}

async function adminUpdateUserRole(req, res) {
    try {
        const { userId } = req.params;
        const { role } = req.body;

        const currentAdminId = req.user?.id || req.user?.userId;

        if (!ALLOWED_ROLES.includes(role)) {
            return res.status(400).json({ message: "Invalid role" });
        }

        if (currentAdminId === userId && role !== "ADMIN") {
            return res.status(400).json({
                message: "You cannot remove your own admin access.",
            });
        }

        const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                isOwner: true, hasBoosterAccess: true,
            },
        });

        if (!targetUser) {
            return res.status(404).json({ message: "User not found" });
        }

        if (targetUser.isOwner) {
            return res.status(403).json({ message: "The owner account is protected." });
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId, isOwner: false },
            data: { role },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                isOwner: true, hasBoosterAccess: true,
                suspendedAt: true,
                suspendedReason: true,
                emailVerifiedAt: true,
                createdAt: true,
                updatedAt: true,
                profile: {
                    select: {
                        displayName: true,
                        profileImageUrl: true,
                    },
                },
            },
        });

        if (targetUser.role !== role) {
            await prisma.notification.create({
                data: {
                    userId,
                    type: "ACCOUNT_ROLE_UPDATED",
                    title: "Account privilege updated",
                    message: `Your account privilege was updated from ${getRoleLabel(targetUser.role)} to ${getRoleLabel(role)}.`,
                    data: {
                        oldRole: targetUser.role,
                        newRole: role,
                        oldRoleLabel: getRoleLabel(targetUser.role),
                        newRoleLabel: getRoleLabel(role),
                        changedByAdminId: currentAdminId || null,
                    },
                },
            });
        }

        return res.json({
            message: "User role updated",
            user: updatedUser,
        });
    } catch (error) {
        if (error.code === "P2025") return res.status(403).json({ message: "Account no longer editable. Refresh and try again." });
        console.error("adminUpdateUserRole error:", error);
        return res.status(500).json({ message: "Failed to update user role" });
    }
}

async function adminUpdateUserSuspension(req, res) {
    try {
        const { userId } = req.params;
        const { suspended, reason } = req.body;

        if (req.user?.userId === userId || req.user?.id === userId) {
            return res.status(400).json({
                message: "You cannot suspend your own account.",
            });
        }

        const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                role: true,
                isOwner: true, hasBoosterAccess: true,
                suspendedAt: true,
            },
        });

        if (!targetUser) {
            return res.status(404).json({ message: "User not found" });
        }

        if (targetUser.isOwner) {
            return res.status(403).json({ message: "The owner account is protected." });
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId, isOwner: false },
            data: suspended
                ? {
                    suspendedAt: new Date(),
                    suspendedReason: reason || "Suspended by admin",
                }
                : {
                    suspendedAt: null,
                    suspendedReason: null,
                },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                isOwner: true, hasBoosterAccess: true,
                suspendedAt: true,
                suspendedReason: true,
                emailVerifiedAt: true,
                createdAt: true,
                updatedAt: true,
                profile: {
                    select: {
                        displayName: true,
                        profileImageUrl: true,
                    },
                },
            },
        });

        return res.json({
            message: suspended ? "User suspended" : "User restored",
            user: updatedUser,
        });
    } catch (error) {
        if (error.code === "P2025") return res.status(403).json({ message: "Account no longer editable. Refresh and try again." });
        console.error("adminUpdateUserSuspension error:", error);
        return res.status(500).json({ message: "Failed to update account status" });
    }
}

module.exports = {
    adminListUsers,
    adminUpdateUserRole,
    adminUpdateUserSuspension,
};

module.exports.ownerUpdateBoosterAccess = async (req, res) => {
    try {
        const viewer = await prisma.user.findUnique({
            where: { id: req.user?.id || req.user?.userId },
            select: { role: true, isOwner: true, suspendedAt: true },
        });
        if (!viewer?.isOwner || viewer.role !== "ADMIN" || viewer.suspendedAt) {
            return res.status(403).json({ message: "Only the owner can manage additional roles." });
        }
        const { hasBoosterAccess } = req.body;
        if (typeof hasBoosterAccess !== "boolean") return res.status(400).json({ message: "Booster access must be true or false." });
        const user = await prisma.user.update({
            where: { id: req.params.userId }, data: { hasBoosterAccess },
            select: { id: true, hasBoosterAccess: true },
        });
        return res.json({ user });
    } catch (error) {
        if (error.code === "P2025") return res.status(404).json({ message: "User not found" });
        console.error("ownerUpdateBoosterAccess error:", error);
        return res.status(500).json({ message: "Failed to update additional role" });
    }
};
