const crypto = require("crypto");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const prisma = require("../prisma");
const { generateReferralCode } = require("../utils/referralCode");
const { registrationConsent } = require("../utils/registrationConsent");

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

  if (Buffer.byteLength(password, 'utf8') > 72) {
    return 'Password must be 72 UTF-8 bytes or fewer';
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

const { signSessionToken: signToken } = require('../utils/sessionToken');

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
    subject: "Reset your FastBoost password",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>Reset your password</h2>
        <p>We received a request to reset your FastBoost password.</p>
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
    const { email, password, username, referralCode } = req.body;
    let consent;
    try { consent = registrationConsent(req.body); }
    catch (error) { return res.status(400).json({ ok: false, message: error.message }); }

    if (typeof email !== 'string' || email.length > 254 || !email.trim()
      || typeof password !== 'string' || !password) {
      return res.status(400).json({
        ok: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
      || (username !== undefined && (typeof username !== 'string' || username.trim().length > 60))) {
      return res.status(400).json({ ok: false, message: 'Enter a valid email and username.' });
    }

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

    let referredByUser = null;

    if (referralCode) {
      referredByUser = await prisma.user.findUnique({
        where: {
          referralCode: String(referralCode).trim().toUpperCase(),
        },
        select: {
          id: true,
        },
      });
    }

    const cleanUsername = username ? String(username).trim() : "";

    let newReferralCode = generateReferralCode(cleanUsername);

    let existingReferralCode = await prisma.user.findUnique({
      where: {
        referralCode: newReferralCode,
      },
    });

    while (existingReferralCode) {
      newReferralCode = generateReferralCode(cleanUsername);

      existingReferralCode = await prisma.user.findUnique({
        where: {
          referralCode: newReferralCode,
        },
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        username: cleanUsername || null,
        passwordHash: hashedPassword,
        role: "CUSTOMER",
        registrationConsent: { create: consent },
        referralCode: newReferralCode,
        referredById: referredByUser?.id || null,
        profile: cleanUsername
          ? { create: { displayName: cleanUsername } }
          : undefined,
      },
      include: {
        profile: true,
      },
    });

    const token = signToken(user, req.body.rememberMe === true);

    return res.status(201).json({
      ok: true,
      message: "User registered successfully",
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role, hasBoosterAccess: Boolean(user.hasBoosterAccess),
        username: user.username || null,
        referralCode: user.referralCode,
        profile: user.profile ? { displayName: user.profile.displayName } : null,
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

    if (typeof email !== 'string' || email.length > 254 || !email.trim()
      || typeof password !== 'string' || !password || password.length > 1024) {
      return res.status(400).json({
        ok: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { profile: true },
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

    if (user.suspendedAt) {
      return res.status(403).json({
        ok: false,
        code: "ACCOUNT_SUSPENDED",
        message: "Account suspended",
        suspendedAt: user.suspendedAt,
        suspendedReason: user.suspendedReason || "This account has been suspended.",
      });
    }

    const token = signToken(user, req.body.rememberMe === true);

    return res.status(200).json({
      ok: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role, hasBoosterAccess: Boolean(user.hasBoosterAccess),
        username: user.username || null,
        referralCode: user.referralCode || null,
        profile: user.profile ? { displayName: user.profile.displayName } : null,
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
    const email = typeof req.body.email === 'string' ? req.body.email.toLowerCase().trim() : '';

    if (!email || email.length > 254) {
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

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const created = await prisma.$transaction(async tx => {
      // Lock the same account snapshot used for the email destination. Profile
      // changes share this lock and invalidate previously issued recovery links.
      const locked = await tx.user.updateMany({
        where: { id: user.id, email: user.email, passwordHash: user.passwordHash, suspendedAt: null },
        data: { passwordHash: user.passwordHash },
      });
      if (locked.count !== 1) return false;
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      await tx.passwordResetToken.create({ data: { tokenHash, userId: user.id, expiresAt } });
      return true;
    });

    if (created) {
      const resetUrl = `${process.env.APP_BASE_URL}/reset-password?token=${rawToken}`;
      await sendPasswordResetEmail({ to: user.email, resetUrl });
    }

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

    if (typeof token !== 'string' || !token || token.length > 256) {
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

    const updatedUser = await prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id: resetRecord.userId } });
      if (!user || user.suspendedAt) throw Object.assign(new Error('Account unavailable'), { code: 'INVALID_RESET_TOKEN' });
      // Keep the user -> token lock order shared with password changes and OAuth
      // recovery. A password change while waiting invalidates this attempt.
      const locked = await tx.user.updateMany({
        where: { id: user.id, email: user.email, emailVerifiedAt: user.emailVerifiedAt, passwordHash: user.passwordHash, suspendedAt: null },
        data: { passwordHash: user.passwordHash },
      });
      if (locked.count !== 1) throw Object.assign(new Error('Account unavailable'), { code: 'INVALID_RESET_TOKEN' });
      const now = new Date();
      // Claim under the transaction lock: a concurrent request cannot consume
      // the same link after its first use, even if both preliminary reads pass.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: resetRecord.id, tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw Object.assign(new Error('Invalid reset token'), { code: 'INVALID_RESET_TOKEN' });
      if (!user.emailVerifiedAt) await tx.socialIdentity.deleteMany({ where: { userId: user.id } });
      const updated = await tx.user.update({ where: { id: user.id }, data: {
        passwordHash, ...(!user.emailVerifiedAt ? { emailVerifiedAt: now } : {}),
      } });
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id, id: { not: resetRecord.id } } });
      return updated;
    });

    const authToken = signToken(updatedUser);

    return res.status(200).json({
      ok: true,
      message: "Password reset successful",
      token: authToken,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
      },
    });
  } catch (error) {
    if (error.code === 'INVALID_RESET_TOKEN') {
      return res.status(400).json({ ok: false, message: 'This reset link is invalid or has expired' });
    }
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
  validatePassword,
};
