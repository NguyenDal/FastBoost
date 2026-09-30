const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, createHmac } = require('node:crypto');
const jwt = require('jsonwebtoken');

test('DocuSign JWT, template sends, retry recovery, verified completion and HMAC', async () => {
    const oldFetch = global.fetch;
    const vars = ['DOCUSIGN_ENVIRONMENT', 'DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_USER_ID', 'DOCUSIGN_ACCOUNT_ID', 'DOCUSIGN_TEMPLATE_ID', 'DOCUSIGN_PRIVATE_KEY', 'DOCUSIGN_RETURN_ORIGIN', 'DOCUSIGN_CONNECT_HMAC_KEYS'];
    const saved = vars.map(key => [key, process.env[key]]);
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    Object.assign(process.env, { DOCUSIGN_ENVIRONMENT: 'demo', DOCUSIGN_INTEGRATION_KEY: 'integration', DOCUSIGN_USER_ID: 'sender', DOCUSIGN_ACCOUNT_ID: 'account', DOCUSIGN_TEMPLATE_ID: 'template',
        DOCUSIGN_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), DOCUSIGN_RETURN_ORIGIN: 'http://localhost:5173', DOCUSIGN_CONNECT_HMAC_KEYS: 'rotation-key,test-hmac' });
    const calls = []; let complete = false, wrongSigner = false;
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/oauth/token')) {
            const assertion = new URLSearchParams(options.body).get('assertion');
            const claims = jwt.verify(assertion, publicKey, { algorithms: ['RS256'], audience: 'account-d.docusign.com', issuer: 'integration', subject: 'sender' });
            assert.equal(claims.scope, 'signature impersonation');
            return Response.json({ access_token: 'private-access-token', expires_in: 3600 });
        }
        if (url.endsWith('/oauth/userinfo')) return Response.json({ accounts: [{ account_id: 'account', base_uri: 'https://demo.docusign.net' }] });
        if (url.includes('/envelopes/status')) return Response.json({ envelopes: [{ envelopeId: 'recovered' }] });
        if (url.endsWith('/envelopes')) return Response.json({ envelopeId: 'envelope' });
        if (url.endsWith('/views/recipient')) return Response.json({ url: 'https://demo.docusign.net/signing/test' });
        if (url.endsWith('/recipients')) return Response.json({ signers: [{ clientUserId: wrongSigner ? 'foreign' : 'booster', email: 'booster@example.test', status: 'completed', signedDateTime: '2026-09-30T12:00:00Z', name: 'Test Booster' }] });
        if (url.endsWith('/envelopes/envelope')) return Response.json({ status: complete ? 'completed' : 'sent' });
        throw Error(`Unexpected request ${url}`);
    };
    const path = require.resolve('../src/utils/docusign'); delete require.cache[path];
    const ds = require(path);
    const contract = { id: 'request-uuid', boosterId: 'booster', signerName: 'Test Booster', signerEmail: 'booster@example.test', title: 'Agreement', templateId: 'template', accountId: 'account', environment: 'demo', envelopeId: 'envelope' };
    try {
        assert.equal(await ds.sendContract(contract), 'envelope');
        const body = JSON.parse(calls.find(c => c.url.endsWith('/envelopes')).options.body);
        assert.equal(body.transactionId, contract.id);
        assert.equal(body.templateRoles[0].clientUserId, 'booster');
        assert.equal(body.templateRoles[0].roleName, 'Booster');
        const sendsBefore = calls.filter(c => c.url.endsWith('/envelopes')).length;
        assert.equal(await ds.sendContract({ ...contract, sendAttemptAt: new Date() }), 'recovered');
        assert.equal(calls.filter(c => c.url.endsWith('/envelopes')).length, sendsBefore);
        await assert.rejects(ds.sendContract({ ...contract, sendAttemptAt: new Date(Date.now() - 8 * 86400000) }), /recovery window/);
        await ds.signingView(contract);
        const view = JSON.parse(calls.find(c => c.url.endsWith('/views/recipient')).options.body);
        assert.equal(view.returnUrl, 'http://localhost:5173/provider/contracts/request-uuid?signingReturn=1');
        assert.deepEqual(await ds.getStatus(contract), { status: 'sent' });
        complete = true;
        assert.equal((await ds.getStatus(contract)).signedName, 'Test Booster');
        wrongSigner = true;
        await assert.rejects(ds.getStatus(contract), /could not be verified/);
        await assert.rejects(ds.getStatus({ ...contract, accountId: 'other-account' }), /another DocuSign/);
        const bytes = Buffer.from('{"data":{"envelopeId":"envelope"}}');
        const sig = createHmac('sha256', 'test-hmac').update(bytes).digest('base64');
        assert.equal(ds.validWebhook(bytes, { 'x-docusign-signature-2': sig }), true);
        assert.equal(ds.validWebhook(Buffer.from('{}'), { 'x-docusign-signature-2': sig }), false);
        assert.equal(ds.validWebhook(bytes, {}), false);
        assert.equal(ds.validWebhook(bytes, { 'x-docusign-signature-1': 'garbage' }), false);
    } finally {
        global.fetch = oldFetch; delete require.cache[path];
        for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
});
