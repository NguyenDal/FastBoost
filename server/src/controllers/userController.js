const prisma = require("../prisma");

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
      select: { id: true, email: true, role: true, createdAt: true },
    });

    return res.json({ ok: true, users });
  } catch (error) {
    console.error("listProviders error:", error);
    return res.status(500).json({ ok: false, message: "Failed to list providers" });
  }
};
