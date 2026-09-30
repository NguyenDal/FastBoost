const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHmac } = require('node:crypto');
const { createRelay, WEBHOOK_PATH, MAX_BYTES } = require('../scripts/docusign-local-relay');

test('local relay only forwards intact, signed JSON callbacks to the fixed API route', async t => {
    const oldKey = process.env.DOCUSIGN_CONNECT_HMAC_KEYS;
    process.env.DOCUSIGN_CONNECT_HMAC_KEYS = 'local-relay-test-only';
    const received = [];
    const api = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => { received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(202); res.end('private upstream response'); });
    });
    const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await listen(api);
    const relay = createRelay({ apiPort: api.address().port });
    await listen(relay);
    t.after(() => {
        for (const server of [relay, api]) { server.close(); server.closeAllConnections(); }
        if (oldKey === undefined) delete process.env.DOCUSIGN_CONNECT_HMAC_KEYS;
        else process.env.DOCUSIGN_CONNECT_HMAC_KEYS = oldKey;
    });
    const base = `http://127.0.0.1:${relay.address().port}`;
    const body = '{ "data": { "envelopeId": "sandbox-test" } }';
    const signature = createHmac('sha256', process.env.DOCUSIGN_CONNECT_HMAC_KEYS).update(body).digest('base64');
    const headers = { 'Content-Type': 'application/json', 'X-DocuSign-Signature-1': signature };
    assert.equal((await fetch(base + '/api/users', { method: 'POST', headers, body })).status, 404);
    assert.equal((await fetch(base + WEBHOOK_PATH)).status, 404);
    assert.equal((await fetch(base + WEBHOOK_PATH + '?bypass=1', { method: 'POST', headers, body })).status, 404);
    assert.equal((await fetch(base + WEBHOOK_PATH, { method: 'POST', headers, body: body + ' ' })).status, 401);
    assert.equal((await fetch(base + WEBHOOK_PATH, { method: 'POST', headers: { ...headers, 'Content-Encoding': 'gzip' }, body })).status, 415);
    assert.equal((await fetch(base + WEBHOOK_PATH, { method: 'POST', headers, body: 'x'.repeat(MAX_BYTES + 1) })).status, 413);
    assert.equal(received.length, 0);
    const result = await fetch(base + WEBHOOK_PATH, { method: 'POST', headers: { ...headers, Cookie: 'do-not-forward', Authorization: 'do-not-forward' }, body });
    assert.equal(result.status, 202);
    assert.deepEqual(await result.json(), { ok: true });
    assert.equal(received.length, 1);
    assert.equal(received[0].path, WEBHOOK_PATH);
    assert.equal(received[0].body.toString(), body);
    assert.equal(received[0].headers['x-docusign-signature-1'], signature);
    assert.equal(received[0].headers.cookie, undefined);
    assert.equal(received[0].headers.authorization, undefined);
});
