const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const oauthStateSecret = () => require('node:crypto').createHmac('sha256', process.env.JWT_SECRET).update('fastboost-oauth-state').digest('hex');
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
function response() { return { code: 200, headers: {}, cookies: {}, status(n) { this.code = n; return this; }, set(k, v) { this.headers[k] = v; return this; }, type(v) { this.mime = v; return this; }, send(v) { this.body = v; return this; }, json(v) { this.body = v; return this; }, redirect(code, url) { this.code = url ? code : 302; this.url = url || code; return this; }, cookie(k, v, options) { this.cookies[k] = { value: v, options }; return this; }, clearCookie(k, options) { this.cleared = { k, options }; return this; } }; }
const identity = { sub: 'google-user', id: 'discord-user', email_verified: true, verified: true, email: 'PLAYER@example.com', name: 'Player' };
const signup = { mode: 'register', username: 'ChosenPlayer', termsAccepted: true, promotionalEmails: false };

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
    const db = { socialIdentity: { findUnique: async () => null }, user: { findUnique: async () => null, findFirst: async () => null, create: async args => { data = args.data; return { id: 'new' }; } } };
    assert.equal((await resolveSocialUser(db, provider, identity, signup)).id, 'new');
    assert.equal(data.email, 'player@example.com'); assert.equal(data.role, 'CUSTOMER');
    assert.equal(data.username, 'ChosenPlayer'); assert.equal(data.profile.create.displayName, 'ChosenPlayer');
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
  await assert.rejects(resolveSocialUser(db, 'google', identity, { mode: 'login' }), { code: 'SOCIAL_SIGNUP_REQUIRED' });
  await assert.rejects(resolveSocialUser(db, 'google', identity, { ...signup, termsAccepted: false }), { code: 'SOCIAL_SIGNUP_REQUIRED' });
  db.user.findUnique = async () => ({ id: 'existing' });
  await assert.rejects(resolveSocialUser(db, 'google', identity, signup), /email and password/);
  db.socialIdentity.findUnique = async () => ({ user: { id: 'linked', suspendedAt: new Date() } });
  await assert.rejects(resolveSocialUser(db, 'google', identity, signup), /suspended/);
  db.socialIdentity.findUnique = async () => ({ user: { id: 'linked', suspendedAt: null } });
  assert.equal((await resolveSocialUser(db, 'google', identity, { mode: 'login' })).id, 'linked');
});

test('OAuth start rejects foreign origins and binds consent choices to a signed state cookie', t => {
  environment(t); const auth = controller(t);
  const bad = response(); auth.startSocialAuth({ params: { provider: 'google' }, query: { origin: 'https://attacker.example' } }, bad);
  assert.equal(bad.code, 400); assert.equal(bad.url, undefined);
  const noTerms = response(); auth.startSocialAuth({ params: { provider: 'discord' }, query: { origin: 'http://localhost:5173', mode: 'register' } }, noTerms);
  assert.equal(new URL(noTerms.url).origin, 'https://discord.com');
  assert.equal(jwt.verify(noTerms.cookies.fb_oauth_discord.value, oauthStateSecret(), { audience: 'fastboost-oauth-state' }).termsAccepted, false);
  const res = response(); auth.startSocialAuth({ params: { provider: 'google' }, query: { origin: 'http://localhost:5173', mode: 'register', termsAccepted: 'true', rememberMe: 'true' } }, res);
  const url = new URL(res.url); const cookie = res.cookies.fb_oauth_google;
  const state = jwt.verify(cookie.value, oauthStateSecret(), { audience: 'fastboost-oauth-state' });
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
  const signed = jwt.sign(context, oauthStateSecret(), { audience: 'fastboost-oauth-state', expiresIn: '10m' });
  const expired = jwt.sign(context, oauthStateSecret(), { audience: 'fastboost-oauth-state', expiresIn: -1 });
  const appSigned = jwt.sign(context, process.env.JWT_SECRET, { audience: 'fastboost-oauth-state', expiresIn: '10m' });
  for (const [cookie, state] of [['', 'expected'], [signed + 'bad', 'expected'], [signed, 'wrong'], [expired, 'expected'], [appSigned, 'expected']]) {
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
    const cookie = jwt.sign(context, oauthStateSecret(), { audience: 'fastboost-oauth-state', expiresIn: '10m' });
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

test('Google signup uses the chosen username without deriving it from email or Google name', async t => {
  const { resolveSocialUser } = controller(t);
  let created;
  const db = { socialIdentity: { findUnique: async () => null }, user: {
    findUnique: async () => null,
    findFirst: async () => null,
    create: async ({ data }) => { created = data; return { id: 'new', ...data }; },
  } };
  const user = await resolveSocialUser(db, 'google', { ...identity, email: 'annguyen27504@gmail.com', name: 'Different Google display name' }, { ...signup, mode: 'login', username: '  MyChosenName  ' });
  assert.equal(user.username, 'MyChosenName');
  assert.equal(created.profile.create.displayName, 'MyChosenName');
  assert.equal(created.email, 'annguyen27504@gmail.com');
  assert.notEqual(created.passwordHash, '');
  const returning = { ...user, profile: { displayName: 'Custom name' }, username: 'custom-name' };
  db.socialIdentity.findUnique = async () => ({ user: returning });
  db.user.create = async () => assert.fail('Returning users must not be recreated');
  assert.equal(await resolveSocialUser(db, 'google', identity, { mode: 'login' }), returning);
});

test('taken usernames, including concurrent claims, are rejected without changing the chosen name', async t => {
  const { resolveSocialUser } = controller(t);
  for (const racing of [false, true]) {
    let writes = 0;
    const db = { socialIdentity: { findUnique: async () => null }, user: {
      findUnique: async () => null,
      findFirst: async ({ where }) => {
        assert.deepEqual(where.username, { equals: 'ChosenPlayer', mode: 'insensitive' });
        return racing ? null : { id: 'other-account' };
      },
      create: async ({ data }) => {
        writes++;
        assert.equal(data.username, 'ChosenPlayer');
        if (racing) throw Object.assign(new Error('Unique constraint'), { code: 'P2002', meta: { target: ['username'] } });
        return data;
      },
    } };
    await assert.rejects(resolveSocialUser(db, 'google', identity, signup), { field: 'username', status: 409 });
    assert.equal(writes, racing ? 1 : 0);
  }
});

test('new Google login completes signup after terms, retaining verified identity and session options', async t => {
  environment(t);
  let user = null, writes = 0, created;
  const db = { socialIdentity: { findUnique: async () => user ? { user } : null }, user: {
    findUnique: async ({ where }) => where.referralCode === 'FRIEND' ? { id: 'referrer' } : null,
    findFirst: async () => null,
    create: async ({ data }) => { writes++; created = data; user = { id: 'created', ...data, profile: { displayName: data.username } }; return user; },
  } };
  const auth = controller(t, db);
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  let calls = 0;
  global.fetch = async () => ({ ok: true, json: async () => ++calls === 1 ? { access_token: 'provider-secret-token' } : identity });
  const context = { provider: 'google', origin: 'http://localhost:5173', state: 'state', verifier: 'verifier', mode: 'login', referralCode: 'FRIEND', rememberMe: true };
  const cookie = jwt.sign(context, oauthStateSecret(), { audience: 'fastboost-oauth-state', expiresIn: '10m' });
  const callback = response();
  await auth.socialCallback({ params: { provider: 'google' }, headers: { cookie: `fb_oauth_google=${cookie}` }, query: { state: 'state', code: 'code' } }, callback);
  assert.equal(writes, 0);
  const payload = JSON.parse(callback.body.match(/postMessage\((.+),"http:\/\/localhost:5173"\)/)[1]);
  assert.equal(payload.email, undefined);
  assert.equal(payload.termsAccepted, false); assert.equal(payload.promotionalEmails, false);
  assert.ok(payload.signupToken); assert.equal(payload.token, undefined);
  assert.doesNotMatch(callback.body, /provider-secret-token|test-secret/);
  assert.throws(() => jwt.verify(payload.signupToken, process.env.JWT_SECRET), /invalid signature/);
  const request = { headers: { origin: context.origin }, body: { signupToken: payload.signupToken, username: 'ChosenName' } };
  const missingTerms = response(); await auth.completeSocialSignup(request, missingTerms);
  assert.equal(missingTerms.code, 400); assert.equal(writes, 0);
  const tampered = response(); await auth.completeSocialSignup({ ...request, body: { ...request.body, signupToken: payload.signupToken + 'bad', termsAccepted: true } }, tampered);
  assert.equal(tampered.code, 400); assert.equal(writes, 0);
  const foreign = response(); await auth.completeSocialSignup({ ...request, headers: { origin: 'https://attacker.example' }, body: { ...request.body, termsAccepted: true } }, foreign);
  assert.equal(foreign.code, 400); assert.equal(writes, 0);
  for (const username of [undefined, null, '', '  ', 'ab', 'a'.repeat(61), { toString: 'ChosenName' }]) {
    const invalid = response(); await auth.completeSocialSignup({ ...request, body: { ...request.body, username, termsAccepted: true } }, invalid);
    assert.equal(invalid.code, 400); assert.equal(invalid.body.field, 'username'); assert.equal(writes, 0);
  }
  db.user.findFirst = async () => ({ id: 'taken' });
  const taken = response(); await auth.completeSocialSignup({ ...request, body: { ...request.body, termsAccepted: true } }, taken);
  assert.equal(taken.code, 409); assert.equal(taken.body.field, 'username'); assert.equal(writes, 0);
  db.user.findFirst = async () => null;
  const completed = response();
  await auth.completeSocialSignup({ ...request, body: { ...request.body, termsAccepted: true, email: 'injected@example.com', role: 'ADMIN', rememberMe: false } }, completed);
  assert.equal(completed.code, 200); assert.equal(writes, 1);
  assert.equal(completed.body.user.username, 'ChosenName'); assert.equal(completed.body.user.email, 'player@example.com');
  assert.equal(completed.body.rememberMe, true); assert.equal(created.referredById, 'referrer');
  assert.equal(created.registrationConsent.create.promotionalEmails, false);
  assert.equal(jwt.verify(completed.body.token, process.env.JWT_SECRET).role, 'CUSTOMER');
  // Retrying a request returns the same account; it cannot overwrite its profile or consent.
  const repeated = response(); await auth.completeSocialSignup({ ...request, body: { ...request.body, termsAccepted: true, promotionalEmails: true } }, repeated);
  assert.equal(repeated.body.user.id, 'created'); assert.equal(writes, 1);
  user.suspendedAt = new Date();
  const suspended = response(); await auth.completeSocialSignup({ ...request, body: { ...request.body, termsAccepted: true } }, suspended);
  assert.equal(suspended.code, 400); assert.match(suspended.body.error, /suspended/);
});

test('expired, wrong-purpose, and missing signup tickets cannot create accounts', async t => {
  environment(t);
  const crypto = require('node:crypto');
  const auth = controller(t, { socialIdentity: { findUnique: async () => assert.fail('Invalid ticket reached the database') } });
  const secret = crypto.createHmac('sha256', process.env.JWT_SECRET).update('fastboost-social-signup').digest('hex');
  const context = { provider: 'google', origin: 'http://localhost:5173', identity };
  const expired = jwt.sign(context, secret, { audience: 'fastboost-social-signup', expiresIn: -1 });
  const wrongPurpose = jwt.sign(context, secret, { audience: 'fastboost-oauth-state', expiresIn: '10m' });
  for (const signupToken of [undefined, '', expired, wrongPurpose]) {
    const res = response(); await auth.completeSocialSignup({ headers: { origin: context.origin }, body: { signupToken, termsAccepted: true } }, res);
    assert.equal(res.code, 400); assert.match(res.body.error, /expired|verified/);
  }
});

test('new users from Login and Register must choose a username even if terms were already accepted', async t => {
  environment(t);
  const auth = controller(t, { socialIdentity: { findUnique: async () => null }, user: {
    findUnique: async () => null,
    create: async () => assert.fail('OAuth callback must not invent a username'),
  } });
  const previousFetch = global.fetch; t.after(() => { global.fetch = previousFetch; });
  for (const mode of ['login', 'register']) {
    let calls = 0;
    global.fetch = async () => ({ ok: true, json: async () => ++calls === 1 ? { access_token: 'provider-token' } : identity });
    const context = { provider: 'google', origin: 'http://localhost:5173', state: 'state', mode, termsAccepted: true, promotionalEmails: true };
    const cookie = jwt.sign(context, oauthStateSecret(), { audience: 'fastboost-oauth-state', expiresIn: '10m' });
    const res = response();
    await auth.socialCallback({ params: { provider: 'google' }, headers: { cookie: `fb_oauth_google=${cookie}` }, query: { state: 'state', code: 'code' } }, res);
    const payload = JSON.parse(res.body.match(/postMessage\((.+),"http:\/\/localhost:5173"\)/)[1]);
    assert.ok(payload.signupToken); assert.equal(payload.token, undefined);
    assert.equal(payload.email, undefined); assert.equal(payload.username, undefined);
    assert.equal(payload.termsAccepted, true); assert.equal(payload.promotionalEmails, true);
  }
});

function linkingDatabase(users) {
  const links = [];
  return { links, user: {
    findUnique: async ({ where, include }) => {
      const user = users.find(user => where.id ? user.id === where.id : user.email === where.email);
      if (!user) return null;
      return include?.socialIdentities ? { ...user, socialIdentities: links.filter(link => link.userId === user.id) } : user;
    },
    create: async () => assert.fail('Linking must never create a second user'),
    update: async () => assert.fail('Linking must not overwrite passwords or profiles'),
  }, socialIdentity: {
    findUnique: async ({ where, include }) => {
      const key = where.provider_providerUserId || where.userId_provider;
      const link = links.find(link => Object.entries(key).every(([key, value]) => link[key] === value));
      if (!link) return null;
      return include?.user ? { ...link, user: users.find(user => user.id === link.userId) } : link;
    },
    create: async ({ data }) => {
      if (links.some(link => link.provider === data.provider && (link.providerUserId === data.providerUserId || link.userId === data.userId))) {
        throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      }
      links.push({ ...data }); return data;
    },
    deleteMany: async ({ where }) => {
      let count = 0;
      for (let index = links.length - 1; index >= 0; index--) {
        if (Object.entries(where).every(([key, value]) => links[index][key] === value)) { links.splice(index, 1); count++; }
      }
      return { count };
    },
  } };
}

test('matching verified Gmail and Workspace emails link to the same account and preserve password/profile', async t => {
  const { resolveSocialUser } = controller(t);
  for (const email of ['existing@gmail.com', 'existing@workspace.example']) {
    const user = { id: 'existing', email, emailVerifiedAt: new Date(), username: 'ChosenName', passwordHash: 'original-hash', role: 'CUSTOMER', profile: { displayName: 'Original' } };
    const before = structuredClone(user);
    const db = linkingDatabase([user]);
    const google = { ...identity, email, hd: email.endsWith('@gmail.com') ? undefined : 'workspace.example' };
    await assert.rejects(resolveSocialUser(db, 'google', google, { mode: 'login' }), { code: 'SOCIAL_LINK_CONFIRMATION_REQUIRED' });
    await controller(t).linkSocialUser(db, user.id, 'google', google);
    assert.deepEqual(db.links, [{ userId: user.id, provider: 'google', providerUserId: identity.sub }]);
    assert.deepEqual(user, before);
    assert.equal(await resolveSocialUser(db, 'google', google, { mode: 'login' }), user);
    assert.equal(db.links.length, 1);
  }
});

test('unverified existing email and non-Google-managed email require linking from Settings', async t => {
  const { resolveSocialUser } = controller(t);
  for (const [provider, email, emailVerifiedAt] of [
    ['google', 'existing@gmail.com', null], ['google', 'existing@example.com', new Date()], ['discord', 'existing@gmail.com', null],
  ]) {
    const db = linkingDatabase([{ id: 'existing', email, emailVerifiedAt }]);
    await assert.rejects(resolveSocialUser(db, provider, { ...identity, email }, { mode: 'login' }), /Profile Settings/);
    assert.equal(db.links.length, 0);
  }
});

test('authenticated linking supports both providers and different emails without overwriting either account', async t => {
  const { linkSocialUser, resolveSocialUser } = controller(t);
  const owner = { id: 'owner', email: 'owner@example.com', passwordHash: 'unchanged', username: 'Original', profile: {} };
  const db = linkingDatabase([owner]);
  for (const provider of ['google', 'discord']) {
    assert.equal(await linkSocialUser(db, owner.id, provider, identity), owner);
    assert.equal(await linkSocialUser(db, owner.id, provider, identity), owner);
    assert.equal(await resolveSocialUser(db, provider, identity, { mode: 'login' }), owner);
  }
  assert.equal(db.links.length, 2); assert.equal(owner.passwordHash, 'unchanged'); assert.equal(owner.email, 'owner@example.com');
  const other = { id: 'other', email: 'other@gmail.com', emailVerifiedAt: new Date() };
  const conflicts = linkingDatabase([owner, other]);
  await linkSocialUser(conflicts, owner.id, 'google', identity);
  await assert.rejects(linkSocialUser(conflicts, other.id, 'google', identity), { message: 'Please use the same email as your FastBoost account.' });
  await assert.rejects(linkSocialUser(conflicts, owner.id, 'google', { ...identity, sub: 'different-google' }), { message: 'Please use the same email as your FastBoost account.' });
  assert.equal(conflicts.links.length, 1);
});

test('linking rejects unverified identities and suspended accounts; automatic linking cannot replace an identity', async t => {
  const { linkSocialUser, resolveSocialUser } = controller(t);
  const user = { id: 'user', email: 'user@gmail.com', emailVerifiedAt: new Date() };
  const db = linkingDatabase([user]);
  await assert.rejects(linkSocialUser(db, user.id, 'google', { ...identity, email_verified: false }), /verify your email/);
  await assert.rejects(linkSocialUser(db, user.id, 'discord', { ...identity, verified: false }), /verify your email/);
  await assert.rejects(linkSocialUser(db, undefined, 'google', identity), /sign in again/);
  user.suspendedAt = new Date();
  await assert.rejects(linkSocialUser(db, user.id, 'google', identity), /suspended/);
  await assert.rejects(resolveSocialUser(db, 'google', { ...identity, email: user.email }, { mode: 'login' }), /suspended/);
  assert.equal(db.links.length, 0);
  user.suspendedAt = null;
  await linkSocialUser(db, user.id, 'google', { ...identity, sub: 'original-google' });
  await assert.rejects(resolveSocialUser(db, 'google', { ...identity, email: user.email }, { mode: 'login' }), { code: 'SOCIAL_LINK_CONFIRMATION_REQUIRED' });
  assert.equal(db.links[0].providerUserId, 'original-google');
});

test('simultaneous linking is idempotent for the same user and cannot transfer a provider identity', async t => {
  const { linkSocialUser } = controller(t);
  const users = [{ id: 'first' }, { id: 'second' }];
  const db = linkingDatabase(users);
  const same = await Promise.all([linkSocialUser(db, 'first', 'google', identity), linkSocialUser(db, 'first', 'google', identity)]);
  assert.equal(same[0].id, 'first'); assert.equal(same[1].id, 'first'); assert.equal(db.links.length, 1);
  const competing = linkingDatabase(users);
  const results = await Promise.allSettled(users.map(user => linkSocialUser(competing, user.id, 'google', identity)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(competing.links.length, 1);
});

test('link start requires a valid app session and allowed POST origin, never a user ID supplied by the client', async t => {
  environment(t);
  const db = linkingDatabase([{ id: 'authenticated' }]);
  const auth = controller(t, db);
  const origin = 'http://localhost:5173';
  const sessionToken = jwt.sign({ userId: 'authenticated' }, process.env.JWT_SECRET, { expiresIn: '3d' });
  const request = { params: { provider: 'google' }, headers: { origin }, body: { origin, sessionToken, userId: 'attacker-target' } };
  const res = response(); await auth.startSocialLink(request, res);
  assert.equal(res.code, 303); assert.equal(new URL(res.url).origin, 'https://accounts.google.com');
  assert.ok(!res.url.includes(sessionToken)); assert.ok(!res.url.includes('authenticated'));
  const context = jwt.verify(res.cookies.fb_oauth_google.value, oauthStateSecret(), { audience: 'fastboost-oauth-state' });
  assert.throws(() => jwt.verify(res.cookies.fb_oauth_google.value, process.env.JWT_SECRET), /invalid signature/);
  assert.equal(context.mode, 'link'); assert.equal(context.userId, 'authenticated'); assert.ok(context.sessionExpiresAt);
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  for (const token of ['', 'invalid', jwt.sign({ userId: 'authenticated' }, process.env.JWT_SECRET, { expiresIn: -1 }), jwt.sign({ userId: 'authenticated' }, oauthStateSecret(), { audience: 'fastboost-oauth-state', expiresIn: '10m' })]) {
    const rejected = response(); await auth.startSocialLink({ ...request, body: { ...request.body, sessionToken: token } }, rejected);
    assert.equal(rejected.url, undefined); assert.match(rejected.body, /session expired/);
  }
  const foreign = response(); await auth.startSocialLink({ ...request, headers: { origin: 'https://evil.example' } }, foreign);
  assert.equal(foreign.code, 400); assert.equal(foreign.url, undefined);
  const forgedGet = response(); auth.startSocialAuth({ params: request.params, query: { origin, mode: 'link', userId: 'authenticated' } }, forgedGet);
  const ordinary = jwt.verify(forgedGet.cookies.fb_oauth_google.value, oauthStateSecret(), { audience: 'fastboost-oauth-state' });
  assert.equal(ordinary.mode, 'login'); assert.equal(ordinary.userId, undefined);
});

test('link callback adds the identity to the authenticated user and returns link status without replacing their session', async t => {
  environment(t);
  const db = linkingDatabase([{ id: 'owner', email: 'owner@example.com', passwordHash: 'unchanged' }]);
  const auth = controller(t, db);
  const beforeFetch = global.fetch; t.after(() => { global.fetch = beforeFetch; });
  for (const provider of ['google', 'discord']) {
    let calls = 0;
    global.fetch = async () => ({ ok: true, json: async () => ++calls === 1 ? { access_token: 'secret' } : identity });
    const context = { provider, origin: 'http://localhost:5173', state: 'state', mode: 'link', userId: 'owner', sessionExpiresAt: Math.floor(Date.now() / 1000) + 300 };
    const cookie = jwt.sign(context, oauthStateSecret(), { audience: 'fastboost-oauth-state', expiresIn: '10m' });
    const request = { params: { provider }, headers: { cookie: `fb_oauth_${provider}=${cookie}` }, query: { state: 'state', code: 'code' } };
    const res = response(); await auth.socialCallback(request, res);
    const payload = JSON.parse(res.body.match(/postMessage\((.+),"http:\/\/localhost:5173"\)/)[1]);
    assert.equal(payload.linked, provider); assert.equal(payload.userId, 'owner'); assert.equal(payload.token, undefined);
    const expiredCookie = jwt.sign({ ...context, sessionExpiresAt: 1 }, oauthStateSecret(), { audience: 'fastboost-oauth-state', expiresIn: '10m' });
    const expired = response(); await auth.socialCallback({ ...request, headers: { cookie: `fb_oauth_${provider}=${expiredCookie}` } }, expired);
    assert.equal(expired.code, 400); assert.equal(calls, 2);
  }
  assert.equal(db.links.length, 2);
});

test('connection status exposes only the signed-in user link flags and provider availability', async t => {
  environment(t);
  const db = linkingDatabase([{ id: 'owner', passwordHash: 'private' }]);
  db.links.push({ userId: 'owner', provider: 'google', providerUserId: 'private-google-id' });
  const auth = controller(t, db);
  const res = response(); await auth.socialConnections({ user: { userId: 'owner' } }, res);
  assert.deepEqual(res.body, { google: { linked: true, configured: true }, discord: { linked: false, configured: true } });
  assert.doesNotMatch(JSON.stringify(res.body), /private/);
  const unauthorized = response(); await auth.socialConnections({ user: {} }, unauthorized);
  assert.equal(unauthorized.code, 401);
});

function unlinkContext(provider, link, overrides = {}) {
  return { provider, origin: 'http://localhost:5173', state: 'unlink-state', verifier: 'verifier', mode: 'unlink',
    userId: link.userId, identityId: link.id, providerUserId: link.providerUserId,
    sessionExpiresAt: Math.floor(Date.now() / 1000) + 300, ...overrides };
}
function unlinkRequest(context, query = {}) {
  const signed = jwt.sign(context, oauthStateSecret(), { audience: 'fastboost-oauth-state', expiresIn: '10m' });
  return { params: { provider: context.provider }, headers: { cookie: `fb_oauth_${context.provider}=${signed}` }, query: { state: context.state, code: 'fresh-code', ...query } };
}
function callbackPayload(res) {
  return JSON.parse(res.body.match(/postMessage\((.+),"http:\/\/localhost:5173"\)/)[1]);
}

test('unlink starts provider verification with the app session and exact stored link bound into signed state', async t => {
  environment(t);
  const db = linkingDatabase([{ id: 'owner' }]);
  const auth = controller(t, db);
  const sessionToken = jwt.sign({ userId: 'owner' }, process.env.JWT_SECRET, { expiresIn: '3d' });
  for (const provider of ['google', 'discord']) {
    const linked = { id: `${provider}-row`, userId: 'owner', provider, providerUserId: `${provider}-identity` };
    db.links.push(linked);
    const req = { params: { provider }, headers: { origin: 'http://localhost:5173' }, body: { origin: 'http://localhost:5173', sessionToken, userId: 'attacker', identityId: 'forged', providerUserId: 'forged', mode: 'login' } };
    const res = response(); await auth.startSocialUnlink(req, res);
    assert.equal(res.code, 303); assert.ok(res.url);
    const context = jwt.verify(res.cookies[`fb_oauth_${provider}`].value, oauthStateSecret(), { audience: 'fastboost-oauth-state' });
    assert.equal(context.mode, 'unlink'); assert.equal(context.userId, 'owner'); assert.equal(context.identityId, linked.id); assert.equal(context.providerUserId, linked.providerUserId);
    assert.equal(context.sessionExpiresAt, jwt.decode(sessionToken).exp);
    assert.doesNotMatch(res.url, /attacker|forged|google-row|discord-row|sessionToken/); assert.equal(res.url.includes(sessionToken), false);
    assert.equal(new URL(res.url).searchParams.get('prompt'), provider === 'google' ? 'select_account' : 'consent');
    assert.throws(() => jwt.verify(res.cookies[`fb_oauth_${provider}`].value, process.env.JWT_SECRET), /invalid signature/);
    const link = response(); await auth.startSocialLink({ ...req, body: { ...req.body, mode: 'unlink' } }, link);
    assert.equal(jwt.verify(link.cookies[`fb_oauth_${provider}`].value, oauthStateSecret()).mode, 'link');
    const get = response(); auth.startSocialAuth({ params: req.params, query: { origin: req.body.origin, mode: 'unlink', userId: 'owner' } }, get);
    assert.equal(jwt.verify(get.cookies[`fb_oauth_${provider}`].value, oauthStateSecret()).mode, 'login');
  }
  assert.equal(db.links.length, 2); // Starting verification cannot unlink.
});

test('unlink start rejects missing/expired session, foreign origin, missing connection and suspended user', async t => {
  environment(t);
  const user = { id: 'owner' };
  const db = linkingDatabase([user]);
  const auth = controller(t, db);
  const req = { params: { provider: 'google' }, headers: { origin: 'http://localhost:5173' }, body: { origin: 'http://localhost:5173', sessionToken: jwt.sign({ userId: 'owner' }, process.env.JWT_SECRET, { expiresIn: '3d' }) } };
  for (const sessionToken of [undefined, 'invalid', jwt.sign({ userId: 'owner' }, process.env.JWT_SECRET, { expiresIn: -1 })]) {
    const res = response(); await auth.startSocialUnlink({ ...req, body: { ...req.body, sessionToken } }, res);
    assert.equal(res.url, undefined); assert.match(callbackPayload(res).error, /session expired/);
  }
  const foreign = response(); await auth.startSocialUnlink({ ...req, headers: { origin: 'https://attacker.example' } }, foreign);
  assert.equal(foreign.code, 400); assert.equal(foreign.url, undefined);
  const missing = response(); await auth.startSocialUnlink(req, missing); assert.match(callbackPayload(missing).error, /not linked/);
  user.suspendedAt = new Date();
  const suspended = response(); await auth.startSocialUnlink(req, suspended); assert.match(callbackPayload(suspended).error, /unavailable/);
});

test('Google and Discord callbacks unlink the verified identity even when it is the last sign-in method, preserving the user', async t => {
  environment(t);
  const beforeFetch = global.fetch; t.after(() => { global.fetch = beforeFetch; });
  for (const provider of ['google', 'discord']) {
    const user = { id: 'owner', email: 'owner@example.com', passwordHash: 'discarded-social-hash', username: 'Original', profile: { displayName: 'Preserved' } };
    const before = structuredClone(user);
    const db = linkingDatabase([user, { id: 'other' }]);
    const link = { id: `${provider}-row`, userId: 'owner', provider, providerUserId: provider === 'google' ? identity.sub : identity.id };
    db.links.push(link, { id: 'other-row', userId: 'other', provider, providerUserId: 'other-id' });
    const auth = controller(t, db);
    let calls = 0;
    global.fetch = async () => ({ ok: true, json: async () => ++calls === 1 ? { access_token: 'provider-secret' } : identity });
    const res = response(); await auth.socialCallback(unlinkRequest(unlinkContext(provider, link)), res);
    assert.equal(calls, 2); assert.deepEqual(callbackPayload(res), { type: 'fastboost:social-auth', unlinked: provider, userId: 'owner' });
    assert.equal(db.links.length, 1); assert.equal(db.links[0].userId, 'other'); assert.deepEqual(user, before);
    assert.equal(res.cleared.k, `fb_oauth_${provider}`); assert.doesNotMatch(res.body, /provider-secret|discarded-social-hash/);
  }
});

test('unlink verifies stable provider identity, not just email, and rejects unverified or unavailable users', async t => {
  environment(t);
  const user = { id: 'owner' };
  const db = linkingDatabase([user]);
  const { unlinkSocialUser } = controller(t, db);
  for (const provider of ['google', 'discord']) {
    const link = { id: `${provider}-row`, userId: 'owner', provider, providerUserId: provider === 'google' ? identity.sub : identity.id };
    db.links.push(link);
    const context = unlinkContext(provider, link);
    await assert.rejects(unlinkSocialUser(db, 'owner', provider, { ...identity, sub: 'wrong-id', id: 'wrong-id' }, context), /Please use your linked/);
    await assert.rejects(unlinkSocialUser(db, 'owner', provider, { ...identity, email_verified: false, verified: false }, context), /verify your email/);
    await assert.rejects(unlinkSocialUser(db, 'owner', provider, identity), /start unlinking again/);
    await assert.rejects(unlinkSocialUser(db, 'missing', provider, identity, context), /unavailable/);
    await assert.rejects(unlinkSocialUser(db, '', provider, identity, context), /start unlinking again/);
    user.suspendedAt = new Date();
    await assert.rejects(unlinkSocialUser(db, 'owner', provider, identity, context), /unavailable/);
    user.suspendedAt = null;
  }
  assert.equal(db.links.length, 2);
});

test('cancelled, failed, tampered and expired unlink callbacks leave connections intact', async t => {
  environment(t);
  const db = linkingDatabase([{ id: 'owner' }]);
  const link = { id: 'row', userId: 'owner', provider: 'google', providerUserId: identity.sub }; db.links.push(link);
  const { socialCallback } = controller(t, db);
  const context = unlinkContext('google', link);
  const beforeFetch = global.fetch; t.after(() => { global.fetch = beforeFetch; });
  global.fetch = async () => assert.fail('Must not call provider');
  for (const override of [{ sessionExpiresAt: 1 }, { identityId: undefined }, { providerUserId: undefined }, { userId: '' }]) {
    const res = response(); await socialCallback(unlinkRequest({ ...context, ...override }), res); assert.equal(res.code, 400);
  }
  const tampered = unlinkRequest(context); tampered.headers.cookie += 'bad';
  const invalid = response(); await socialCallback(tampered, invalid); assert.equal(invalid.code, 400);
  const cancelled = response(); await socialCallback(unlinkRequest(context, { error: 'access_denied' }), cancelled);
  assert.match(callbackPayload(cancelled).error, /cancelled/);
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  const failed = response(); await socialCallback(unlinkRequest(context), failed); assert.ok(callbackPayload(failed).error);
  let calls = 0;
  global.fetch = async () => ({ ok: true, json: async () => ++calls === 1 ? { access_token: 'provider-token' } : { ...identity, sub: 'wrong-id' } });
  const wrongAccount = response(); await socialCallback(unlinkRequest(context), wrongAccount);
  assert.equal(callbackPayload(wrongAccount).error, 'Please use your linked Google account.');
  assert.deepEqual(db.links, [link]);
});

test('stale or repeated unlink authorization cannot delete a replacement connection or another users link', async t => {
  const db = linkingDatabase([{ id: 'owner' }, { id: 'other' }]);
  const { unlinkSocialUser } = controller(t, db);
  const old = { id: 'old-row', userId: 'owner', provider: 'google', providerUserId: identity.sub };
  const context = unlinkContext('google', old);
  const replacement = { ...old, id: 'new-row' }; db.links.push(replacement);
  await assert.rejects(unlinkSocialUser(db, 'owner', 'google', identity, context), /connection changed/);
  await assert.rejects(unlinkSocialUser(db, 'other', 'google', identity, { ...context, identityId: 'new-row' }), /connection changed/);
  assert.deepEqual(db.links, [replacement]);
  await unlinkSocialUser(db, 'owner', 'google', identity, { ...context, identityId: 'new-row' });
  await assert.rejects(unlinkSocialUser(db, 'owner', 'google', identity, { ...context, identityId: 'new-row' }), /connection changed/);
  assert.equal(db.links.length, 0);
});



test('both providers require permission before email linking, preserve the account and sign in directly afterward', async t => {
  environment(t);
  for (const provider of ['google', 'discord']) {
    const user = { id: 'existing', email: 'player@gmail.com', emailVerifiedAt: new Date(), username: 'Original', passwordHash: 'keep', role: 'CUSTOMER', profile: { displayName: 'Original' } };
    const before = structuredClone(user);
    const db = linkingDatabase([user]);
    const auth = controller(t, db);
    const profile = { ...identity, email: user.email };
    t.mock.method(global, 'fetch', async url => ({ ok: true, json: async () => url.includes('token') ? { access_token: 'test' } : profile }));
    const context = { provider, origin: 'http://localhost:5173', state: 'state', mode: 'login', rememberMe: true };
    const cookie = jwt.sign(context, oauthStateSecret(), { audience: 'fastboost-oauth-state', expiresIn: '5m' });
    const callback = response();
    await auth.socialCallback({ params: { provider }, headers: { cookie: 'fb_oauth_' + provider + '=' + cookie }, query: { state: 'state', code: 'code' } }, callback);
    const pending = callbackPayload(callback);
    assert.ok(pending.linkToken); assert.equal(pending.token, undefined); assert.equal(pending.signupToken, undefined); assert.equal(db.links.length, 0);
    const request = { headers: { origin: context.origin }, body: { linkToken: pending.linkToken, allow: false } };
    const cancel = response(); await auth.confirmSocialLink(request, cancel);
    assert.equal(cancel.body.cancelled, true); assert.equal(db.links.length, 0);
    for (const change of [{ headers: { origin: 'https://foreign.example' } }, { body: { ...request.body, linkToken: pending.linkToken + 'invalid', allow: true } }]) {
      const bad = response(); await auth.confirmSocialLink({ ...request, ...change }, bad); assert.equal(bad.code, 400); assert.equal(db.links.length, 0);
    }
    const claims = jwt.decode(pending.linkToken);
    const secret = require('node:crypto').createHmac('sha256', process.env.JWT_SECRET).update('fastboost-social-signup').digest('hex');
    const expired = jwt.sign({ ...claims, exp: 1 }, secret);
    const badTicket = response(); await auth.confirmSocialLink({ ...request, body: { linkToken: expired, allow: true } }, badTicket);
    assert.equal(badTicket.code, 400); assert.equal(db.links.length, 0);
    user.suspendedAt = new Date();
    const suspended = response(); await auth.confirmSocialLink({ ...request, body: { ...request.body, allow: true } }, suspended);
    assert.equal(suspended.code, 400); assert.equal(db.links.length, 0); delete user.suspendedAt;
    user.email = 'changed@example.com';
    const changed = response(); await auth.confirmSocialLink({ ...request, body: { ...request.body, allow: true } }, changed);
    assert.equal(changed.code, 400); assert.equal(db.links.length, 0); user.email = before.email;
    const confirmed = response(); await auth.confirmSocialLink({ ...request, body: { ...request.body, allow: true } }, confirmed);
    assert.ok(confirmed.body.token); assert.equal(confirmed.body.user.id, user.id); assert.equal(confirmed.body.rememberMe, true); assert.equal(db.links.length, 1); assert.deepEqual(user, before);
    assert.equal(await auth.resolveSocialUser(db, provider, profile, { mode: 'login' }), user);
    const repeated = response(); await auth.confirmSocialLink({ ...request, body: { ...request.body, allow: true } }, repeated);
    assert.equal(db.links.length, 1); assert.ok(repeated.body.token);
  }
});
