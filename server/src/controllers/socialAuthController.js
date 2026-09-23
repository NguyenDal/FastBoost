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
function sessionPayload(user, rememberMe) {
  const token = jwt.sign({ userId: user.id, email: user.email, username: user.username || undefined, role: user.role }, process.env.JWT_SECRET, { expiresIn: '3d' });
  return { token, rememberMe: Boolean(rememberMe), user: { id: user.id, email: user.email, username: user.username, role: user.role, profile: user.profile } };
}
// Signup tickets cannot be used as app session tokens or OAuth state cookies.
function signupSecret() {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update('fastboost-social-signup').digest('hex');
}
function oauthStateSecret() {
  // Linking state contains an account ID, but must never act as an app session.
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update('fastboost-oauth-state').digest('hex');
}
function signupUsername(value) {
  const username = typeof value === 'string' ? value.trim() : '';
  if (username.length < 3 || username.length > 60) {
    throw Object.assign(new Error('Choose a username between 3 and 60 characters.'), { field: 'username' });
  }
  return username;
}
function usernameTaken() {
  return Object.assign(new Error('This username is already taken. Please choose another.'), { field: 'username', status: 409 });
}
exports.socialProviders = (_req, res) => res.json({ google: Boolean(configuration('google')), discord: Boolean(configuration('discord')) });
exports.socialConnections = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user?.userId) return res.status(401).json({ error: 'Please sign in again.' });
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, include: { socialIdentities: { select: { provider: true } } } });
    if (!user || user.suspendedAt) return res.status(403).json({ error: 'This account is unavailable.' });
    return res.json(Object.fromEntries(Object.keys(providers).map(provider => [provider, {
      linked: user.socialIdentities.some(identity => identity.provider === provider), configured: Boolean(configuration(provider)),
    }])));
  } catch { return res.status(500).json({ error: 'Could not load linked accounts. Please try again.' }); }
};
async function unlinkSocialUser(db, userId, provider, identity, expectedLink) {
  const providerUserId = verifiedProviderId(provider, identity);
  if (typeof userId !== 'string' || !userId || typeof expectedLink?.identityId !== 'string' || !expectedLink.identityId || !expectedLink.providerUserId) {
    throw new Error('Please start unlinking again from Profile Settings.');
  }
  if (providerUserId !== expectedLink.providerUserId) throw new Error(`Please use your linked ${provider === 'google' ? 'Google' : 'Discord'} account.`);
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, suspendedAt: true } });
  if (!user || user.suspendedAt) throw new Error('This account is unavailable.');
  // Match the original row as well as the freshly verified provider identity.
  // A delayed/replayed callback cannot remove a replacement connection.
  const removed = await db.socialIdentity.deleteMany({ where: { id: expectedLink.identityId, userId, provider, providerUserId } });
  if (removed.count !== 1) throw new Error('This connection changed. Please refresh and try again.');
}
function beginSocialAuth(res, provider, config, context) {
  const state = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  res.cookie(`fb_oauth_${provider}`, jwt.sign({ ...context, provider, state, verifier }, oauthStateSecret(), { expiresIn: '10m', audience: 'fastboost-oauth-state' }), cookieOptions(config));
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const url = new URL(config.authorization);
  for (const [key, value] of Object.entries({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: config.scope, state, prompt: provider === 'google' ? 'select_account' : 'consent' })) url.searchParams.set(key, value);
  if (provider === 'google') {
    url.searchParams.set('code_challenge', crypto.createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return res.redirect(303, url.toString());
}
exports.startSocialAuth = (req, res) => {
  const { provider } = req.params;
  const config = configuration(provider);
  const origin = String(req.query.origin || '');
  if (!allowedOrigin(origin)) return res.status(400).send('Please start sign-in from FastBoost.');
  if (!config) return finish(res, origin, { error: 'This sign-in option is not configured yet. Please use email and password.' });
  const termsAccepted = req.query.termsAccepted === 'true';
  const mode = req.query.mode === 'register' ? 'register' : 'login';
  const context = { origin, mode, termsAccepted,
    promotionalEmails: req.query.promotionalEmails === 'true', rememberMe: req.query.rememberMe === 'true',
    referralCode: String(req.query.referralCode || '').slice(0, 64) };
  return beginSocialAuth(res, provider, config, context);
};
async function startSocialAccountAction(req, res, mode) {
  // Submitted into a popup as a POST: the app session token never enters a URL.
  const origin = String(req.body?.origin || '');
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  if (origin !== req.headers.origin || !allowedOrigin(origin)) return res.status(400).send('Please manage linked accounts from FastBoost Profile Settings.');
  const { provider } = req.params;
  const config = configuration(provider);
  if (!config) return finish(res, origin, { error: 'This sign-in provider is not available yet.' });
  let session;
  try {
    session = jwt.verify(req.body.sessionToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (session.aud || typeof session.userId !== 'string' || !session.userId || !Number.isFinite(session.exp)) throw new Error('Invalid session');
  } catch { return finish(res, origin, { error: 'Your session expired. Please sign in again.' }); }
  try {
    const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, suspendedAt: true } });
    if (!user || user.suspendedAt) return finish(res, origin, { error: 'This account is unavailable.' });
    const context = { origin, mode, userId: user.id, sessionExpiresAt: session.exp };
    if (mode === 'unlink') {
      const linked = await prisma.socialIdentity.findUnique({ where: { userId_provider: { userId: user.id, provider } }, select: { id: true, providerUserId: true } });
      if (!linked) return finish(res, origin, { error: 'This account is not linked. Please refresh Profile Settings.' });
      context.identityId = linked.id;
      context.providerUserId = linked.providerUserId;
    }
    return beginSocialAuth(res, provider, config, context);
  } catch { return finish(res, origin, { error: 'Could not start account verification. Please try again.' }); }
}
exports.startSocialLink = (req, res) => startSocialAccountAction(req, res, 'link');
exports.startSocialUnlink = (req, res) => startSocialAccountAction(req, res, 'unlink');
function verifiedProviderId(provider, identity) {
  if (!Object.hasOwn(providers, provider)) throw new Error('Unknown sign-in provider.');
  const providerUserId = String(provider === 'google' ? identity.sub || '' : identity.id || '');
  const verified = provider === 'google' ? identity.email_verified === true : identity.verified === true;
  if (!providerUserId || !verified || !identity.email) throw new Error('Please verify your email with this provider before continuing.');
  return providerUserId;
}
async function attachIdentity(db, user, provider, providerUserId) {
  if (user.suspendedAt) throw new Error('This account is suspended. Please contact support.');
  const current = await db.socialIdentity.findUnique({ where: { userId_provider: { userId: user.id, provider } } });
  if (current) {
    if (current.providerUserId === providerUserId) return user;
    throw new Error('Please use the same email as your FastBoost account.');
  }
  try {
    await db.socialIdentity.create({ data: { userId: user.id, provider, providerUserId } });
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    const winner = await db.socialIdentity.findUnique({ where: { provider_providerUserId: { provider, providerUserId } } });
    if (winner?.userId !== user.id) throw new Error('Please use the same email as your FastBoost account.');
  }
  return user;
}
async function linkSocialUser(db, userId, provider, identity) {
  const providerUserId = verifiedProviderId(provider, identity);
  if (typeof userId !== 'string' || !userId) throw new Error('Please sign in again before linking an account.');
  const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } });
  if (!user) throw new Error('This account is unavailable.');
  const owner = await db.socialIdentity.findUnique({ where: { provider_providerUserId: { provider, providerUserId } } });
  if (owner && owner.userId !== user.id) throw new Error('Please use the same email as your FastBoost account.');
  return attachIdentity(db, user, provider, providerUserId);
}
async function resolveSocialUser(db, provider, identity, context) {
  const providerUserId = verifiedProviderId(provider, identity);
  const linked = await db.socialIdentity.findUnique({ where: { provider_providerUserId: { provider, providerUserId } }, include: { user: { include: { profile: true } } } });
  if (linked) {
    if (linked.user.suspendedAt) throw new Error('This account is suspended. Please contact support.');
    return linked.user;
  }
  const email = String(identity.email).trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email }, include: { profile: true } });
  if (existing) {
    // Only Google-managed email proves current mailbox ownership. Other addresses
    // can be linked after signing into the FastBoost account in Profile Settings.
    const googleOwnsEmail = provider === 'google' && (email.endsWith('@gmail.com') || (typeof identity.hd === 'string' && Boolean(identity.hd.trim())));
    if (!existing.emailVerifiedAt || !googleOwnsEmail) throw new Error('Please sign in with email and password, then link this provider in Profile Settings.');
    return attachIdentity(db, existing, provider, providerUserId);
  }
  if (context.username === undefined || context.termsAccepted !== true) {
    const error = new Error('Choose a username and agree to the Terms and Conditions to create an account.');
    error.code = 'SOCIAL_SIGNUP_REQUIRED';
    throw error;
  }
  const username = signupUsername(context.username);
  const consent = registrationConsent(context);
  if (await db.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } }, select: { id: true } })) throw usernameTaken();
  const referrer = context.referralCode ? await db.user.findUnique({ where: { referralCode: context.referralCode.toUpperCase() }, select: { id: true } }) : null;
  // The schema requires a hash; this random, discarded value is never a customer password.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(48).toString('base64url'), 10);
  try {
    return await db.user.create({ data: {
      email, username, emailVerifiedAt: new Date(), role: 'CUSTOMER', passwordHash,
      referralCode: crypto.randomBytes(12).toString('hex').toUpperCase(), referredById: referrer?.id || null,
      profile: { create: { displayName: username } },
      registrationConsent: { create: consent },
      socialIdentities: { create: { provider, providerUserId } },
    }, include: { profile: true } });
  } catch (error) {
    // Keep the chosen name intact if another signup claimed it concurrently.
    if (error.code === 'P2002' && error.meta?.target?.includes('username')) throw usernameTaken();
    throw error;
  }
}
exports.completeSocialSignup = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  let pending;
  try {
    pending = jwt.verify(req.body.signupToken, signupSecret(), { algorithms: ['HS256'], audience: 'fastboost-social-signup' });
    if (!Object.hasOwn(providers, pending.provider) || pending.origin !== req.headers.origin || !allowedOrigin(pending.origin)) throw new Error('Invalid signup');
  } catch { return res.status(400).json({ error: 'This sign-in request expired or could not be verified. Please continue with your provider again.' }); }
  let username;
  try { username = signupUsername(req.body.username); registrationConsent(req.body); }
  catch (error) { return res.status(400).json({ error: error.message, field: error.field }); }
  try {
    const user = await resolveSocialUser(prisma, pending.provider, pending.identity, {
      mode: 'register', username, termsAccepted: true, promotionalEmails: req.body.promotionalEmails === true,
      referralCode: pending.referralCode,
    });
    return res.json(sessionPayload(user, pending.rememberMe));
  } catch (error) {
    if (error.field === 'username') return res.status(error.status || 400).json({ error: error.message, field: 'username' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'This account was just created. Please try signing in again.' });
    return res.status(error.code ? 500 : 400).json({ error: error.code ? 'We could not create your account. Please try again.' : error.message });
  }
};
exports.socialCallback = async (req, res) => {
  const { provider } = req.params;
  const config = configuration(provider);
  if (!config) return res.status(400).send('Sign-in is unavailable. Please return to FastBoost.');
  let context;
  try {
    const cookie = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`fb_oauth_${provider}=`));
    context = jwt.verify(decodeURIComponent(cookie?.slice(cookie.indexOf('=') + 1) || ''), oauthStateSecret(), { algorithms: ['HS256'], audience: 'fastboost-oauth-state' });
    if (context.provider !== provider || !allowedOrigin(context.origin) || typeof req.query.state !== 'string' || context.state !== req.query.state) throw new Error('Invalid state');
    if (['link', 'unlink'].includes(context.mode) && (typeof context.userId !== 'string' || !context.userId || !Number.isFinite(context.sessionExpiresAt) || context.sessionExpiresAt <= Date.now() / 1000)) throw new Error('Account session expired');
    if (context.mode === 'unlink' && (typeof context.identityId !== 'string' || !context.identityId || typeof context.providerUserId !== 'string' || !context.providerUserId)) throw new Error('Invalid unlink context');
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
    try {
      if (context.mode === 'link') {
        user = await linkSocialUser(prisma, context.userId, provider, identity);
        return finish(res, context.origin, { linked: provider, userId: user.id });
      }
      if (context.mode === 'unlink') {
        await unlinkSocialUser(prisma, context.userId, provider, identity, context);
        return finish(res, context.origin, { unlinked: provider, userId: context.userId });
      }
      user = await resolveSocialUser(prisma, provider, identity, context);
    }
    catch (error) {
      if (error.code === 'SOCIAL_SIGNUP_REQUIRED') {
        const signupToken = jwt.sign({ provider, origin: context.origin,
          identity: { sub: identity.sub, id: identity.id, email: identity.email, email_verified: identity.email_verified, verified: identity.verified, hd: identity.hd },
          referralCode: context.referralCode, rememberMe: context.rememberMe,
        }, signupSecret(), { audience: 'fastboost-social-signup', expiresIn: '10m' });
        return finish(res, context.origin, { signupToken, termsAccepted: context.termsAccepted === true, promotionalEmails: context.promotionalEmails === true });
      }
      if (error.code === 'P2002') return finish(res, context.origin, { error: 'This account was just created. Please try signing in again.' });
      if (error.code) throw error;
      return finish(res, context.origin, { error: error.message });
    }
    return finish(res, context.origin, sessionPayload(user, context.rememberMe));
  } catch {
    return finish(res, context.origin, { error: 'We could not complete sign-in. Please try again or use email and password.' });
  }
};
exports.resolveSocialUser = resolveSocialUser;
exports.linkSocialUser = linkSocialUser;
exports.unlinkSocialUser = unlinkSocialUser;
