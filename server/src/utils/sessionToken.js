const jwt = require('jsonwebtoken');

function signSessionToken(user, rememberMe = false) {
    return jwt.sign({ userId: user.id, email: user.email, username: user.username || undefined,
        role: user.role, hasBoosterAccess: Boolean(user.hasBoosterAccess), rememberMe: rememberMe === true,
    }, process.env.JWT_SECRET, { expiresIn: rememberMe === true ? '30d' : '3d' });
}
module.exports = { signSessionToken };
