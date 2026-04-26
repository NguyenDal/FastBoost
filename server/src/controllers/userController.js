const prisma = require("../prisma");

// Authenticated: get current user with username/profile
module.exports.me = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, message: "Not authorized" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, role: true, profile: { select: { displayName: true } } },
    });

    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    return res.json({ ok: true, user });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Failed to load user" });
  }
};

// Admin: list providers for assignment
module.exports.listProviders = async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim();
    const where = { role: "PROVIDER" };
    if (q) {
      where.email = { contains: q, mode: "insensitive" };
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, username: true, role: true, createdAt: true, profile: { select: { displayName: true } } },
    });

    return res.json({ ok: true, users });
  } catch (error) {
    console.error("listProviders error:", error);
    return res.status(500).json({ ok: false, message: "Failed to list providers" });
  }
};

// Public: check if a username is available
module.exports.checkUsername = async (req, res) => {
  try {
    const raw = (req.query.u || "").toString().trim();
    if (!raw || raw.length < 3) {
      return res.json({ ok: true, available: false, reason: "too_short" });
    }

    // Case-insensitive lookup so Starlight/starlight collide
    const existing = await prisma.user.findFirst({
      where: { username: { equals: raw, mode: "insensitive" } },
      select: { id: true },
    });

    return res.json({ ok: true, available: !Boolean(existing) });
  } catch (error) {
    return res.status(500).json({ ok: false, available: false });
  }
};
