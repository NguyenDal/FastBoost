const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const prisma = require("../prisma");

const PASSWORD_RULES = {
  minLength: 8,
  maxLength: 64,
  upper: /[A-Z]/,
  lower: /[a-z]/,
  number: /[0-9]/,
  special: /[^A-Za-z0-9]/,
};

const validatePassword = (password) => {
  if (typeof password !== "string") {
    return "Password is required";
  }

  if (password.length < PASSWORD_RULES.minLength) {
    return "Password must be at least 8 characters";
  }

  if (password.length > PASSWORD_RULES.maxLength) {
    return "Password must be 64 characters or fewer";
  }

  if (!PASSWORD_RULES.upper.test(password)) {
    return "Password must include at least one uppercase letter";
  }

  if (!PASSWORD_RULES.lower.test(password)) {
    return "Password must include at least one lowercase letter";
  }

  if (!PASSWORD_RULES.number.test(password)) {
    return "Password must include at least one number";
  }

  if (!PASSWORD_RULES.special.test(password)) {
    return "Password must include at least one special character";
  }

  return null;
};

const signToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
};

const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const sendPasswordResetEmail = async ({ to, resetUrl }) => {
  const transporter = createTransporter();

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Reset your SquadBoost password",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>Reset your password</h2>
        <p>We received a request to reset your SquadBoost password.</p>
        <p>
          <a
            href="${resetUrl}"
            style="display:inline-block;padding:12px 18px;background:#22c55e;color:#fff;text-decoration:none;border-radius:8px;"
          >
            Reset Password
          </a>
        </p>
        <p>This link expires in 15 minutes.</p>
        <p>If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });
};

const registerUser = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({
        ok: false,
        message: passwordError,
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return res.status(409).json({
        ok: false,
        message: "User already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: hashedPassword,
        role: role || "CUSTOMER",
      },
    });

    return res.status(201).json({
      ok: true,
      message: "User registered successfully",
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return res.status(401).json({
        ok: false,
        message: "Invalid email or password",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      return res.status(401).json({
        ok: false,
        message: "Invalid email or password",
      });
    }

    const token = signToken(user);

    return res.status(200).json({
      ok: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();

    if (!email) {
      return res.status(400).json({
        ok: false,
        message: "Email is required",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(200).json({
        ok: true,
        message: "If that email is registered, a reset link has been sent.",
      });
    }

    await prisma.passwordResetToken.deleteMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
    });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt,
      },
    });

    const resetUrl = `${process.env.APP_BASE_URL}/reset-password?token=${rawToken}`;

    await sendPasswordResetEmail({
      to: user.email,
      resetUrl,
    });

    return res.status(200).json({
      ok: true,
      message: "If that email is registered, a reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({
      ok: false,
      message: "Could not send reset link",
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;

    if (!token) {
      return res.status(400).json({
        ok: false,
        message: "Reset token is required",
      });
    }

    if (!password || !confirmPassword) {
      return res.status(400).json({
        ok: false,
        message: "Password and confirm password are required",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        ok: false,
        message: "Passwords do not match",
        field: "confirmPassword",
      });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({
        ok: false,
        message: passwordError,
        field: "password",
      });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !resetRecord ||
      resetRecord.usedAt ||
      resetRecord.expiresAt.getTime() < Date.now()
    ) {
      return res.status(400).json({
        ok: false,
        message: "This reset link is invalid or has expired",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      }),
      prisma.passwordResetToken.deleteMany({
        where: {
          userId: resetRecord.userId,
          id: { not: resetRecord.id },
        },
      }),
    ]);

    const authToken = signToken(resetRecord.user);

    return res.status(200).json({
      ok: true,
      message: "Password reset successful",
      token: authToken,
      user: {
        id: resetRecord.user.id,
        email: resetRecord.user.email,
        role: resetRecord.user.role,
      },
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      ok: false,
      message: "Could not reset password",
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
};