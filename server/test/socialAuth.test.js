const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { registrationConsent } = require('../src/utils/registrationConsent');

function controller(t, db = {}, file = 'socialAuthController') {
  const path = require.resolve('../src/prisma');
  const old = require.cache[path];
  require.cache[path] = { exports: db, loaded: true };
  const target = require.resolve('../src/controllers/' + file);
  delete require.cache[target];
  t.after(() => { delete require.cache[target]; if (old) require.cache[path] = old; else delete require.cache[path]; });
  return require(target);
}
function environment(t) {
  const values = { NODE_ENV: 'test', JWT_SECRET: 'unit-test-only-secret', CLIENT_URL: 'http://localhost:5173',
    GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REDIRECT_URI: 'http://localhost:5000/api/auth/social/google/callback',
    DISCORD_CLIENT_ID: 'test-id', DISCORD_CLIENT_SECRET: 'test-secret', DISCORD_REDIRECT_URI: 'http://localhost:5000/api/auth/social/discord/callback' };
  const old = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}
function response() { return { code: 200, headers: {}, cookies: {}, status(n) { this.code = n; return this; }, set(k, v) { this.headers[k] = v; return this; }, type(v) { this.mime = v; return this; }, send(v) { this.body = v; return this; }, json(v) { this.body = v; return this; }, redirect(v) { this.url = v; return this; }, cookie(k, v, options) { this.cookies[k] = { value: v, options }; return this; }, clearCookie(k, options) { this.cleared = { k, options }; return this; } }; }
const identity = { sub: 'google-user', id: 'discord-user', email_verified: true, verified: true, email: 'PLAYER@example.com', name: 'Player' };
const signup = { mode: 'register', termsAccepted: true, promotionalEmails: false };

test('registration requires affirmative terms and records marketing only when explicitly opted in', () => {
  for (const value of [undefined, false, 'true']) assert.throws(() => registrationConsent({ termsAccepted: value }), /agree/);
  const consent = registrationConsent(signup);
  assert.match(consent.termsVersion, /2026-09-22/);
  assert.ok(consent.termsAcceptedAt instanceof Date);
  assert.equal(consent.promotionalEmails, false);
  assert.equal(consent.promotionalConsentAt, null);
  assert.ok(registrationConsent({ ...signup, promotionalEmails: true }).promotionalConsentAt instanceof Date);
});

test('password signup rejects missing terms before access and cannot self-assign an admin role', async t => {
  environment(t);
  let writes = 0;
  const auth = controller(t, { user: { findUnique: async () => null, create: async ({ data }) => {
    writes++; assert.equal(data.role, 'CUSTOMER'); assert.equal(data.registrationConsent.create.promotionalEmails, false);
    return { id: 'new', email: data.email, role: data.role };
  } } }, 'authController');
  const missing = response(); await auth.registerUser({ body: {} }, missing);
  assert.equal(missing.code, 400); assert.equal(writes, 0);
  const valid = response(); await auth.registerUser({ body: { ...signup, email: 'new@example.com', password: 'Example123!', role: 'ADMIN' } }, valid);
  assert.equal(valid.code, 201); assert.equal(writes, 1);
  assert.equal(jwt.verify(valid.body.token, process.env.JWT_SECRET).role, 'CUSTOMER');
});

test('social signup creates one customer with identity and consent atomically for either provider', async t => {
  const { resolveSocialUser } = controller(t);
  for (const provider of ['google', 'discord']) {
    let data;
    const db = { socialIdentity: { findUnique: async () => null }, user: { findUnique: async () => null, create: async args => { data = args.data; return { id: 'new' }; } } };
    assert.equal((await resolveSocialUser(db, provider, identity, signup)).id, 'new');
    assert.equal(data.email, 'player@example.com'); assert.equal(data.role, 'CUSTOMER');
    assert.equal(data.socialIdentities.create.providerUserId, provider + '-user');
    assert.equal(data.registrationConsent.create.promotionalEmails, false);
    assert.ok(data.emailVerifiedAt instanceof Date); assert.ok(data.passwordHash);
  }
});

test('social auth rejects unverified identities, email collisions, missing consent and suspended users', async t => {
  const { resolveSocialUser } = controller(t);
  const db = { socialIdentity: { findUnique: async () => null }, user: { findUnique: async () => null, create: async () => assert.fail('No account should be created') } };
  await assert.rejects(resolveSocialUser(db, 'google', { ...identity, email_verified: false }, signup), /verify your email/);
  await assert.rejects(resolveSocialUser(db, 'discord', { ...identity, verified: false }, signup), /verify your email/);
  await assert.rejects(resolveSocialUser(db, 'google', identity, { mode: 'login' }), /Choose Register/);
  await assert.rejects(resolveSocialUser(db, 'google', identity, { ...signup, termsAccepted: false }), /accept the terms/);
  db.user.findUnique = async () => ({ id: 'existing' });
  await assert.rejects(resolveSocialUser(db, 'google', identity, signup), /email and password/);
  db.socialIdentity.findUnique = async () => ({ user: { id: 'linked', suspendedAt: new Date() } });
  await assert.rejects(resolveSocialUser(db, 'google', identity, signup), /suspended/);
  db.socialIdentity.findUnique = async () => ({ user: { id: 'linked', suspendedAt: null } });
  assert.equal((await resolveSocialUser(db, 'google', identity, { mode: 'login' })).id, 'linked');
});

test('OAuth start rejects foreign origins and unsigned signup consent and binds state to a secure cookie', t => {
  environment(t); const auth = controller(t);
  const bad = response(); auth.startSocialAuth({ params: { provider: 'google' }, query: { origin: 'https://attacker.example' } }, bad);
  assert.equal(bad.code, 400); assert.equal(bad.url, undefined);
  const noTerms = response(); auth.startSocialAuth({ params: { provider: 'discord' }, query: { origin: 'http://localhost:5173', mode: 'register' } }, noTerms);
  assert.match(noTerms.body, /agree/); assert.equal(noTerms.url, undefined);
  const res = response(); auth.startSocialAuth({ params: { provider: 'google' }, query: { origin: 'http://localhost:5173', mode: 'register', termsAccepted: 'true', rememberMe: 'true' } }, res);
  const url = new URL(res.url); const cookie = res.cookies.fb_oauth_google;
  const state = jwt.verify(cookie.value, process.env.JWT_SECRET, { audience: 'fastboost-oauth-state' });
  assert.equal(state.state, url.searchParams.get('state')); assert.equal(state.termsAccepted, true);
  assert.equal(cookie.options.httpOnly, true); assert.equal(cookie.options.sameSite, 'lax');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.equal(state.rememberMe, true);
});

test('OAuth callback rejects missing, tampered, expired or mismatched state without calling the provider', async t => {
  environment(t); const auth = controller(t); const fetchBefore = global.fetch;
  global.fetch = async () => assert.fail('Must validate state before fetching'); t.after(() => { global.fetch = fetchBefore; });
  const context = { provider: 'google', origin: 'http://localhost:5173', state: 'expected' };
  const signed = jwt.sign(context, process.env.JWT_SECRET, { audience: 'fastboost-oauth-state', expiresIn: '10m' });
  const expired = jwt.sign(context, process.env.JWT_SECRET, { audience: 'fastboost-oauth-state', expiresIn: -1 });
  for (const [cookie, state] of [['', 'expected'], [signed + 'bad', 'expected'], [signed, 'wrong'], [expired, 'expected']]) {
    const res = response(); await auth.socialCallback({ params: { provider: 'google' }, query: { state, code: 'test-code' }, headers: { cookie: 'fb_oauth_google=' + cookie } }, res);
    assert.equal(res.code, 400); assert.match(res.body, /could not be verified/);
  }
});

test('OAuth callback exchanges code on server and posts only app credentials to the trusted window', async t => {
  environment(t); const user = { id: 'linked', email: 'player@example.com', role: 'CUSTOMER', profile: {} };
  const auth = controller(t, { socialIdentity: { findUnique: async () => ({ user }) } });
  const fetchBefore = global.fetch; t.after(() => { global.fetch = fetchBefore; });
  for (const provider of ['google', 'discord']) {
    let calls = 0;
    global.fetch = async (url, options) => {
      calls++;
      if (calls === 1) { assert.equal(options.body.get('code'), 'one-use-code'); assert.equal(options.body.get('client_secret'), 'test-secret'); return { ok: true, json: async () => ({ access_token: 'private-provider-token' }) }; }
      assert.equal(options.headers.Authorization, 'Bearer private-provider-token');
      return { ok: true, json: async () => identity };
    };
    const context = { provider, origin: 'http://localhost:5173', state: 'state', verifier: 'verifier', rememberMe: true };
    const cookie = jwt.sign(context, process.env.JWT_SECRET, { audience: 'fastboost-oauth-state', expiresIn: '10m' });
    const req = { params: { provider }, headers: { cookie: `fb_oauth_${provider}=${cookie}` }, query: { state: 'state', code: 'one-use-code' } };
    const res = response(); await auth.socialCallback(req, res);
    assert.equal(calls, 2); assert.match(res.body, /postMessage/); assert.match(res.body, /http:\/\/localhost:5173/);
    assert.doesNotMatch(res.body, /private-provider-token|test-secret/); assert.equal(res.url, undefined);
    assert.equal(res.headers['Cache-Control'], 'no-store'); assert.match(res.headers['Content-Security-Policy'], /nonce-/);
    assert.equal(res.cleared.options.maxAge, undefined);
    const payload = JSON.parse(res.body.match(/postMessage\((.+),"http:\/\/localhost:5173"\)/)[1]);
    assert.equal(jwt.verify(payload.token, process.env.JWT_SECRET).userId, 'linked'); assert.equal(payload.rememberMe, true);
    const cancelled = response(); await auth.socialCallback({ ...req, query: { state: 'state', error: 'access_denied' } }, cancelled);
    assert.match(cancelled.body, /cancelled/); assert.equal(calls, 2);
  }
});
