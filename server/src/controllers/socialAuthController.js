const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma');
const { registrationConsent } = require('../utils/registrationConsent');

const providers = {
  google: { authorization: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', user: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid email profile' },
  discord: { authorization: 'https://discord.com/oauth2/authorize', token: 'https://discord.com/api/oauth2/token', user: 'https://discord.com/api/users/@me', scope: 'identify email' },
};
function configuration(provider) {
  if (!Object.hasOwn(providers, provider)) return null;
  const prefix = provider.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  const redirectUri = process.env[`${prefix}_REDIRECT_URI`];
  if (!clientId || !clientSecret || !redirectUri) return null;
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
    if (url.search || url.hash || url.pathname !== `/api/auth/social/${provider}/callback`) return null;
  } catch { return null; }
  return { ...providers[provider], clientId, clientSecret, redirectUri };
}
function allowedOrigin(value) {
  const allowed = String(process.env.CLIENT_URL || '').split(',').map(x => x.trim()).filter(Boolean);
  if (process.env.NODE_ENV !== 'production') allowed.push('http://localhost:5173');
  return allowed.some(url => { try { return new URL(url).origin === value; } catch { return false; } });
}
function cookieOptions(config) {
  return { httpOnly: true, sameSite: 'lax', secure: new URL(config.redirectUri).protocol === 'https:', path: '/api/auth/social', maxAge: 10 * 60 * 1000 };
}
function finish(res, origin, payload) {
  const nonce = crypto.randomBytes(18).toString('base64');
  const data = JSON.stringify({ type: 'fastboost:social-auth', ...payload }).replace(/</g, '\\u003c');
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
  return res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>FastBoost sign-in</title><body><p>You can close this window and return to FastBoost.</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${data},${JSON.stringify(origin)});window.close();}</script></body></html>`);
}
exports.socialProviders = (_req, res) => res.json({ google: Boolean(configuration('google')), discord: Boolean(configuration('discord')) });
exports.startSocialAuth = (req, res) => {
  const { provider } = req.params;
  const config = configuration(provider);
  const origin = String(req.query.origin || '');
  if (!allowedOrigin(origin)) return res.status(400).send('Please start sign-in from FastBoost.');
  if (!config) return finish(res, origin, { error: 'This sign-in option is not configured yet. Please use email and password.' });
  const termsAccepted = req.query.termsAccepted === 'true';
  const mode = req.query.mode === 'register' ? 'register' : 'login';
  if (mode === 'register' && !termsAccepted) return finish(res, origin, { error: 'Please agree to the Terms and Conditions before signing up.' });
  const state = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const context = { provider, origin, state, verifier, mode, termsAccepted,
    promotionalEmails: req.query.promotionalEmails === 'true', rememberMe: req.query.rememberMe === 'true',
    referralCode: String(req.query.referralCode || '').slice(0, 64) };
  res.cookie(`fb_oauth_${provider}`, jwt.sign(context, process.env.JWT_SECRET, { expiresIn: '10m', audience: 'fastboost-oauth-state' }), cookieOptions(config));
  res.set('Cache-Control', 'no-store');
  const url = new URL(config.authorization);
  for (const [key, value] of Object.entries({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: config.scope, state, prompt: provider === 'google' ? 'select_account' : 'consent' })) url.searchParams.set(key, value);
  if (provider === 'google') {
    url.searchParams.set('code_challenge', crypto.createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return res.redirect(url.toString());
};

async function resolveSocialUser(db, provider, identity, context) {
  const providerUserId = String(provider === 'google' ? identity.sub || '' : identity.id || '');
  const verified = provider === 'google' ? identity.email_verified === true : identity.verified === true;
  if (!providerUserId || !verified || !identity.email) throw new Error('Please verify your email with this provider before continuing.');
  const linked = await db.socialIdentity.findUnique({ where: { provider_providerUserId: { provider, providerUserId } }, include: { user: { include: { profile: true } } } });
  if (linked) {
    if (linked.user.suspendedAt) throw new Error('This account is suspended. Please contact support.');
    return linked.user;
  }
  const email = String(identity.email).trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  // Email matches alone never grant access to an existing password account.
  if (existing) throw new Error('An account already uses this email. Please sign in with email and password.');
  if (context.mode !== 'register' || !context.termsAccepted) throw new Error('No linked account yet. Choose Register and accept the terms to create one.');
  const consent = registrationConsent(context);
  const referrer = context.referralCode ? await db.user.findUnique({ where: { referralCode: context.referralCode.toUpperCase() }, select: { id: true } }) : null;
  return db.user.create({ data: {
    email, emailVerifiedAt: new Date(), role: 'CUSTOMER',
    passwordHash: await bcrypt.hash(crypto.randomBytes(48).toString('base64url'), 10),
    referralCode: crypto.randomBytes(12).toString('hex').toUpperCase(), referredById: referrer?.id || null,
    profile: { create: { displayName: String(identity.name || identity.global_name || identity.username || 'Player').slice(0, 60) } },
    registrationConsent: { create: consent },
    socialIdentities: { create: { provider, providerUserId } },
  }, include: { profile: true } });
}
exports.socialCallback = async (req, res) => {
  const { provider } = req.params;
  const config = configuration(provider);
  if (!config) return res.status(400).send('Sign-in is unavailable. Please return to FastBoost.');
  let context;
  try {
    const cookie = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`fb_oauth_${provider}=`));
    context = jwt.verify(decodeURIComponent(cookie?.slice(cookie.indexOf('=') + 1) || ''), process.env.JWT_SECRET, { algorithms: ['HS256'], audience: 'fastboost-oauth-state' });
    if (context.provider !== provider || !allowedOrigin(context.origin) || typeof req.query.state !== 'string' || context.state !== req.query.state) throw new Error('Invalid state');
  } catch { return res.status(400).send('This sign-in request expired or could not be verified. Please close this window and try again.'); }
  const clearOptions = cookieOptions(config);
  delete clearOptions.maxAge;
  res.clearCookie(`fb_oauth_${provider}`, clearOptions);
  try {
    if (req.query.error || typeof req.query.code !== 'string') return finish(res, context.origin, { error: 'Sign-in was cancelled. You can try again.' });
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri });
    if (provider === 'google') body.set('code_verifier', context.verifier);
    const tokenResponse = await fetch(config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error('provider_exchange');
    const profileResponse = await fetch(config.user, { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15000) });
    if (!profileResponse.ok) throw new Error('provider_profile');
    const identity = await profileResponse.json();
    let user;
    try { user = await resolveSocialUser(prisma, provider, identity, context); }
    catch (error) {
      if (error.code === 'P2002') return finish(res, context.origin, { error: 'This account was just created. Please try signing in again.' });
      if (error.code) throw error;
      return finish(res, context.origin, { error: error.message });
    }
    const token = jwt.sign({ userId: user.id, email: user.email, username: user.username || undefined, role: user.role }, process.env.JWT_SECRET, { expiresIn: '3d' });
    return finish(res, context.origin, { token, rememberMe: context.rememberMe, user: { id: user.id, email: user.email, username: user.username, role: user.role, profile: user.profile } });
  } catch {
    return finish(res, context.origin, { error: 'We could not complete sign-in. Please try again or use email and password.' });
  }
};
exports.resolveSocialUser = resolveSocialUser;
