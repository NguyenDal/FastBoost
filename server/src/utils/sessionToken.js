const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');

// A keyed digest avoids putting the password hash in the token. Changing the
// password immediately invalidates all earlier sessions without a schema change.
function sessionSecurityStamp(user) {
    return crypto.createHmac('sha256', process.env.JWT_SECRET)
        .update(JSON.stringify(['fastboost-session-v1', user.id, user.passwordHash || '']))
        .digest('hex');
}

async function verifySessionToken(token, { db = require('../prisma') } = {}) {
    if (typeof token !== 'string' || token.length > 8192) throw new Error('Invalid session');
    const claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!claims || claims.aud || typeof claims.userId !== 'string' || !claims.userId
        || !Number.isFinite(claims.exp) || typeof claims.securityStamp !== 'string'
        || !/^[a-f0-9]{64}$/.test(claims.securityStamp)) throw new Error('Invalid session');
    let user;
    try {
        user = await db.user.findUnique({ where: { id: claims.userId }, select: {
            id: true, email: true, username: true, role: true, hasBoosterAccess: true,
            passwordHash: true, suspendedAt: true,
        } });
    } catch {
        throw Object.assign(new Error('Session verification unavailable'), { code: 'SESSION_STORE_UNAVAILABLE' });
    }
    if (!user || user.suspendedAt || !crypto.timingSafeEqual(
        Buffer.from(claims.securityStamp, 'hex'), Buffer.from(sessionSecurityStamp(user), 'hex'),
    )) throw new Error('Session is no longer available');
    return { userId: user.id, email: user.email, username: user.username || undefined,
        role: user.role, hasBoosterAccess: Boolean(user.hasBoosterAccess),
        rememberMe: claims.rememberMe === true, exp: claims.exp, iat: claims.iat, securityStamp: claims.securityStamp };
}

function signSessionToken(user, rememberMe = false) {
    return jwt.sign({ userId: user.id, email: user.email, username: user.username || undefined,
        role: user.role, hasBoosterAccess: Boolean(user.hasBoosterAccess), rememberMe: rememberMe === true,
        securityStamp: sessionSecurityStamp(user),
    }, process.env.JWT_SECRET, { expiresIn: rememberMe === true ? '30d' : '3d' });
}
module.exports = { signSessionToken, verifySessionToken, sessionSecurityStamp };
