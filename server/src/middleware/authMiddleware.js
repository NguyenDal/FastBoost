const { verifySessionToken } = require('../utils/sessionToken');

const createProtect = (db) => async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (typeof authHeader !== 'string' || !/^Bearer \S+$/.test(authHeader)) {
      return res.status(401).json({
        ok: false,
        message: "Not authorized, no token",
      });
    }

    const token = authHeader.slice(7);
    const decoded = await verifySessionToken(token, db ? { db } : undefined);

    req.user = decoded;
  } catch (error) {
    if (error.code === 'SESSION_STORE_UNAVAILABLE') return res.status(503).json({
      ok: false, message: 'Session verification is temporarily unavailable. Please try again.',
    });
    return res.status(401).json({
      ok: false,
      message: "Not authorized, token failed",
    });
  }
  return next();
};

const protect = createProtect();

const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      ok: false,
      message: "Not authorized",
    });
  }

  if (req.user.role !== "ADMIN") {
    return res.status(403).json({
      ok: false,
      message: "Access denied, admin only",
    });
  }

  return next();
};

module.exports = { protect, createProtect, adminOnly };
