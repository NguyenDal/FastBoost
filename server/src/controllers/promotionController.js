const prisma = require("../prisma");

// Public projection: never expose recipient identities or personal coupon codes.
exports.getFooterPromotion = async (req, res) => {
    const now = new Date();
    const serviceId = typeof req.query.serviceId === "string" && req.query.serviceId.length <= 100
        ? req.query.serviceId : null;
    const where = {
        active: true, footerDecoration: true, recipientAccountId: null, recipientAccountIds: { isEmpty: true },
        AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
    };
    const select = { id: true, title: true, discountPercent: true, couponCode: true,
        endsAt: true, footerTimer: true, scope: true, service: { select: { title: true } } };
    const orderBy = [{ createdAt: "desc" }, { id: "asc" }];
    try {
        let promotion = serviceId ? await prisma.serviceSale.findFirst({
            where: { ...where, scope: "SERVICE", serviceId, service: { priceRules: { some: { active: true } } } }, select, orderBy,
        }) : null;
        if (!promotion) promotion = await prisma.serviceSale.findFirst({ where: {
            ...where,
            ...(serviceId ? { scope: "GLOBAL" } : { OR: [
                { scope: "GLOBAL" },
                { scope: "SERVICE", service: { priceRules: { some: { active: true } } } },
            ] }),
        }, select, orderBy });
        res.set("Cache-Control", "no-store");
        return res.json({ ok: true, promotion });
    } catch {
        return res.status(503).json({ ok: false, promotion: null });
    }
};
