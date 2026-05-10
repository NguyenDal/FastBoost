const bcrypt = require("bcrypt");
const prisma = require("../prisma");
const { uploadProfileImageToS3 } = require("../utils/s3Upload");

function getUserId(req) {
  return req.user?.userId || req.user?.id;
}

function sanitizeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    profile: user.profile || null,
    profileImage: user.profile?.profileImageUrl || "",
  };
}

// Authenticated: get current user with username/profile
module.exports.me = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Not authorized",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: {
          select: {
            displayName: true,
            bio: true,
            profileImageUrl: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    return res.json({
      ok: true,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error("me error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to load user",
    });
  }
};

// Authenticated: update username/email/profile picture
module.exports.updateMyAccount = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Not authorized",
      });
    }

    const username = (req.body.username || "").toString().trim();
    const email = (req.body.email || "").toString().trim().toLowerCase();
    const profileImageUrl = (req.body.profileImageUrl || "").toString().trim();

    if (!username) {
      return res.status(400).json({
        ok: false,
        field: "username",
        message: "Username is required.",
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        ok: false,
        field: "username",
        message: "Username must be at least 3 characters.",
      });
    }

    if (!email) {
      return res.status(400).json({
        ok: false,
        field: "email",
        message: "Email is required.",
      });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      return res.status(400).json({
        ok: false,
        field: "email",
        message: "Please enter a valid email address.",
      });
    }

    const usernameTaken = await prisma.user.findFirst({
      where: {
        username: {
          equals: username,
          mode: "insensitive",
        },
        NOT: {
          id: userId,
        },
      },
      select: {
        id: true,
      },
    });

    if (usernameTaken) {
      return res.status(409).json({
        ok: false,
        field: "username",
        message: "This username is already taken.",
      });
    }

    const emailTaken = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
        NOT: {
          id: userId,
        },
      },
      select: {
        id: true,
      },
    });

    if (emailTaken) {
      return res.status(409).json({
        ok: false,
        field: "email",
        message: "This email is already in use.",
      });
    }

    const updatedUser = await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        username,
        email,
        profile: {
          upsert: {
            create: {
              profileImageUrl: profileImageUrl || null,
            },
            update: {
              profileImageUrl: profileImageUrl || null,
            },
          },
        },
      },
      include: {
        profile: {
          select: {
            displayName: true,
            bio: true,
            profileImageUrl: true,
          },
        },
      },
    });

    return res.json({
      ok: true,
      message: "Account updated successfully.",
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    console.error("updateMyAccount error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to update account settings.",
    });
  }
};

// Authenticated: change password
module.exports.changeMyPassword = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Not authorized",
      });
    }

    const currentPassword = req.body.currentPassword || "";
    const newPassword = req.body.newPassword || "";
    const confirmPassword = req.body.confirmPassword || "";

    if (!currentPassword) {
      return res.status(400).json({
        ok: false,
        field: "currentPassword",
        message: "Current password is required.",
      });
    }

    if (!newPassword) {
      return res.status(400).json({
        ok: false,
        field: "newPassword",
        message: "New password is required.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        ok: false,
        field: "confirmPassword",
        message: "Passwords do not match.",
      });
    }

    const passwordChecks = {
      length: newPassword.length >= 8,
      upper: /[A-Z]/.test(newPassword),
      lower: /[a-z]/.test(newPassword),
      number: /[0-9]/.test(newPassword),
      special: /[^A-Za-z0-9]/.test(newPassword),
    };

    const passwordValid = Object.values(passwordChecks).every(Boolean);

    if (!passwordValid) {
      return res.status(400).json({
        ok: false,
        field: "newPassword",
        message: "Password does not meet all requirements.",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        passwordHash: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found.",
      });
    }

    const currentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.passwordHash
    );

    if (!currentPasswordValid) {
      return res.status(401).json({
        ok: false,
        field: "currentPassword",
        message: "Current password is incorrect.",
      });
    }

    const sameAsOldPassword = await bcrypt.compare(
      newPassword,
      user.passwordHash
    );

    if (sameAsOldPassword) {
      return res.status(400).json({
        ok: false,
        field: "newPassword",
        message: "New password must be different from your current password.",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        passwordHash,
      },
    });

    return res.json({
      ok: true,
      message: "Password updated successfully.",
    });
  } catch (error) {
    console.error("changeMyPassword error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to update password.",
    });
  }
};

// Authenticated: upload profile picture to S3
module.exports.uploadMyProfilePicture = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Not authorized",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        message: "Please choose an image to upload.",
      });
    }

    const uploaded = await uploadProfileImageToS3({
      userId,
      file: req.file,
    });

    const updatedUser = await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        profile: {
          upsert: {
            create: {
              profileImageUrl: uploaded.url,
            },
            update: {
              profileImageUrl: uploaded.url,
            },
          },
        },
      },
      include: {
        profile: {
          select: {
            displayName: true,
            bio: true,
            profileImageUrl: true,
          },
        },
      },
    });

    return res.json({
      ok: true,
      message: "Profile picture uploaded successfully.",
      imageUrl: uploaded.url,
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    console.error("uploadMyProfilePicture error:", error);

    return res.status(500).json({
      ok: false,
      message: error.message || "Failed to upload profile picture.",
    });
  }
};

// Admin: list providers for assignment
module.exports.listProviders = async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim();

    const where = { role: "PROVIDER" };

    if (q) {
      where.OR = [
        {
          email: {
            contains: q,
            mode: "insensitive",
          },
        },
        {
          username: {
            contains: q,
            mode: "insensitive",
          },
        },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        createdAt: true,
        profile: {
          select: {
            displayName: true,
            profileImageUrl: true,
          },
        },
      },
    });

    return res.json({ ok: true, users });
  } catch (error) {
    console.error("listProviders error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to list providers",
    });
  }
};

// Public: check if a username is available
module.exports.checkUsername = async (req, res) => {
  try {
    const raw = (req.query.u || "").toString().trim();

    if (!raw || raw.length < 3) {
      return res.json({
        ok: true,
        available: false,
        reason: "too_short",
      });
    }

    const existing = await prisma.user.findFirst({
      where: {
        username: {
          equals: raw,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
      },
    });

    return res.json({
      ok: true,
      available: !Boolean(existing),
    });
  } catch (error) {
    console.error("checkUsername error:", error);

    return res.status(500).json({
      ok: false,
      available: false,
    });
  }
};