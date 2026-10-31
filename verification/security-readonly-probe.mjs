// Read-only production smoke checks. This script never authenticates or writes data.
const web = 'https://www.fastboost.gg';
const api = 'https://fastboost-api.onrender.com';
const routes = [
  ['web', web, '/'],
  ['api', api, '/api/health'],
  ['api', api, '/api/auth/social/providers'],
  ['api', api, '/api/user/me'],
  ['api', api, '/api/orders/my'],
  ['api', api, '/api/orders/admin'],
  ['api', api, '/api/notifications'],
  ['api', api, '/api/support/threads'],
  ['api', api, '/api/operations/earnings'],
  ['api', api, '/api/operations/contracts/not-a-contract'],
  ['api', api, '/api/operations/payout-information'],
  ['api', api, '/api/admin/activity-logs'],
  ['api', api, '/api/wallet'],
  ['api', api, '/api/orders/not-an-order/highlights'],
  ['api', api, '/api/payments/verify-checkout-session?session_id=invalid'],
  ['web', web, '/.env'],
  ['api', api, '/.env'],
];
let deployedScriptPath;
const forbidden = [
  'authorization', 'set-cookie', 'access-control-allow-credentials',
];
const headersOfInterest = [
  'content-type', 'cache-control', 'content-security-policy',
  'strict-transport-security', 'x-frame-options', 'x-content-type-options',
  'referrer-policy', 'access-control-allow-origin', 'access-control-allow-credentials',
  'permissions-policy',
];
async function probe(label, url, options = {}) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
    ...options,
  });
  const body = await response.text();
  if (url === `${web}/`) deployedScriptPath = body.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  const headers = Object.fromEntries(headersOfInterest.filter(key => response.headers.has(key))
    .map(key => [key, response.headers.get(key)]));
  const result = { label, url, status: response.status, headers, bytes: body.length };
  if (url.endsWith('/.env')) result.exposedEnv = /(?:JWT_SECRET|DATABASE_URL|STRIPE_SECRET_KEY)\s*=/.test(body);
  if (url.endsWith('.js.map')) result.sourceMap = response.headers.get('content-type')?.includes('json') && body.includes('sources');
  console.log(JSON.stringify(result));
  if (forbidden.some(key => response.headers.has(key))) {
    // Report header names only; never log a credential or cookie value.
    console.error(JSON.stringify({ label, sensitiveHeaderNames: forbidden.filter(key => response.headers.has(key)) }));
  }
}
for (const [label, origin, path] of routes) {
  try { await probe(label, origin + path); }
  catch (error) { console.error(JSON.stringify({ label, path, error: String(error) })); }
}
if (deployedScriptPath) {
  try { await probe('web-source-map', web + deployedScriptPath + '.map'); }
  catch (error) { console.error(JSON.stringify({ label: 'web-source-map', error: String(error) })); }
}
const invalidTokens = [
  'invalid',
  `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"userId":"admin","exp":4102444800}').toString('base64url')}.`,
];
for (const [index, token] of invalidTokens.entries()) {
  try { await probe(`invalid-token-${index + 1}`, api + '/api/user/me', { headers: { Authorization: `Bearer ${token}` } }); }
  catch (error) { console.error(JSON.stringify({ label: `invalid-token-${index + 1}`, error: String(error) })); }
}
try {
  await probe('foreign-origin-preflight', api + '/api/user/me', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://security-check.invalid',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization',
    },
  });
} catch (error) { console.error(JSON.stringify({ label: 'foreign-origin-preflight', error: String(error) })); }
