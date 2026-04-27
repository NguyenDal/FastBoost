const prisma = require("../prisma");

function getUserId(req) {
  return req.user?.id || req.user?.userId;
}

exports.listMyNotifications = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized: user id missing from token",
      });
    }

    const notifications = await prisma.notification.findMany({
      where: {
        userId,
        active: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 30,
    });

    return res.json({
      ok: true,
      notifications,
    });
  } catch (error) {
    console.error("listMyNotifications error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to load notifications",
      error: error.message,
    });
  }
};

exports.markNotificationRead = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized: user id missing from token",
      });
    }

    const notification = await prisma.notification.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!notification) {
      return res.status(404).json({
        ok: false,
        message: "Notification not found",
      });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: {
        read: true,
      },
    });

    return res.json({
      ok: true,
      notification: updated,
    });
  } catch (error) {
    console.error("markNotificationRead error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to mark notification as read",
      error: error.message,
    });
  }
};