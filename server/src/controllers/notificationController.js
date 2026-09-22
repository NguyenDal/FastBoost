const prisma = require("../prisma");
const { getReferralFirstPurchaseOffer } = require("../utils/referralProgram");

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

    const offer = await getReferralFirstPurchaseOffer(userId);
    if (offer.eligible) {
      await prisma.notification.upsert({
        where: { id: `first-purchase-${userId}` },
        update: {},
        create: {
          id: `first-purchase-${userId}`,
          userId,
          type: "FIRST_PURCHASE_DISCOUNT",
          title: `${offer.firstPurchaseDiscountPercent}% First Purchase Discount`,
          message: `You joined through a friend's referral link. You get ${offer.firstPurchaseDiscountPercent}% off your first purchase.`,
          data: { targetPath: "/" },
        },
      });
    }

    const dashboard = req.query.view === "dashboard";
    const notifications = dashboard ? (await Promise.all([
      prisma.notification.findMany({
        where: { userId, active: true, type: { not: "CHAT_MESSAGE" } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 3,
      }),
      prisma.notification.findMany({
        where: { userId, active: true, type: "CHAT_MESSAGE" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 3,
      }),
    ])).flat() : await prisma.notification.findMany({
      where: {
        userId,
        active: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 30,
    });

    // Resolve current avatars in one query, including older chat notifications.
    const senderIds = [...new Set(notifications
      .filter((item) => item.type === "CHAT_MESSAGE" && item.data?.senderId)
      .map((item) => item.data.senderId))];
    if (senderIds.length > 0) {
      const senders = await prisma.user.findMany({
        where: { id: { in: senderIds } },
        select: { id: true, profile: { select: { profileImageUrl: true } } },
      });
      const avatars = new Map(senders.map((sender) => [sender.id, sender.profile?.profileImageUrl || null]));
      for (const item of notifications) {
        if (item.type === "CHAT_MESSAGE") {
          item.data = { ...item.data, senderAvatar: avatars.get(item.data?.senderId) || null };
        }
      }
    }

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

exports.markAllNotificationsRead = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized: user id missing from token",
      });
    }

    await prisma.notification.updateMany({
      where: {
        userId,
        active: true,
        read: false,
        type: {
          not: "CHAT_MESSAGE",
        },
      },
      data: {
        read: true,
      },
    });

    const notifications = await prisma.notification.findMany({
      where: {
        userId,
        active: true,
      },
      orderBy: [
        { read: "asc" },
        { createdAt: "desc" },
      ],
      take: 30,
    });

    return res.json({
      ok: true,
      notifications,
    });
  } catch (error) {
    console.error("markAllNotificationsRead error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to mark notifications as read",
      error: error.message,
    });
  }
};

exports.markAllChatNotificationsRead = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized: user id missing from token",
      });
    }

    await prisma.notification.updateMany({
      where: {
        userId,
        active: true,
        read: false,
        type: "CHAT_MESSAGE",
      },
      data: {
        read: true,
      },
    });

    const notifications = await prisma.notification.findMany({
      where: {
        userId,
        active: true,
      },
      orderBy: [
        { read: "asc" },
        { createdAt: "desc" },
      ],
      take: 30,
    });

    return res.json({
      ok: true,
      notifications,
    });
  } catch (error) {
    console.error("markAllChatNotificationsRead error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to mark chat notifications as read",
      error: error.message,
    });
  }
};
