const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, createHmac } = require('node:crypto');
const jwt = require('jsonwebtoken');

test('DocuSign JWT, template sends, retry recovery, verified completion and HMAC', async () => {
    const oldFetch = global.fetch;
    const vars = ['DOCUSIGN_ENVIRONMENT', 'DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_USER_ID', 'DOCUSIGN_ACCOUNT_ID', 'DOCUSIGN_TEMPLATE_ID', 'DOCUSIGN_PRIVATE_KEY', 'DOCUSIGN_RETURN_ORIGIN', 'DOCUSIGN_CONNECT_HMAC_KEYS', 'DOCUSIGN_COMPANY_SIGNER_NAME', 'DOCUSIGN_COMPANY_SIGNER_EMAIL'];
    const saved = vars.map(key => [key, process.env[key]]);
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    Object.assign(process.env, { DOCUSIGN_ENVIRONMENT: 'demo', DOCUSIGN_INTEGRATION_KEY: 'integration', DOCUSIGN_USER_ID: 'sender', DOCUSIGN_ACCOUNT_ID: 'account', DOCUSIGN_TEMPLATE_ID: 'template',
        DOCUSIGN_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), DOCUSIGN_RETURN_ORIGIN: 'http://localhost:5173', DOCUSIGN_CONNECT_HMAC_KEYS: 'rotation-key,test-hmac', DOCUSIGN_COMPANY_SIGNER_NAME: 'Test Owner', DOCUSIGN_COMPANY_SIGNER_EMAIL: 'owner@example.test' });
    const calls = []; let complete = false, wrongSigner = false, companyComplete = false, wrongCompany = false, invalidTemplate = false, missingFields = false;
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
        if (url.includes('/templates/template/recipients')) return Response.json({ signers: [
            { roleName: 'FastBoost', routingOrder: '1', tabs: { signHereTabs: invalidTemplate ? [] : [{}], dateSignedTabs: [{}], textTabs: (missingFields ? [] : ['ProviderLegalName', 'ProviderEmail', 'ProviderAccountId', 'AgreementId', 'EffectiveDate']).map(tabLabel => ({ tabLabel })) } },
            { roleName: 'Booster', routingOrder: '2', tabs: { signHereTabs: [{}], dateSignedTabs: [{}] } },
        ] });
        if (url.endsWith('/envelopes')) return Response.json({ envelopeId: 'envelope' });
        if (url.endsWith('/views/recipient')) return Response.json({ url: 'https://demo.docusign.net/signing/test' });
        if (url.endsWith('/recipients')) return Response.json({ signers: [
            { clientUserId: wrongSigner ? 'foreign' : 'booster', email: 'booster@example.test', status: complete ? 'completed' : 'sent', signedDateTime: complete ? '2026-09-30T12:00:00Z' : undefined, name: 'Test Booster' },
            { clientUserId: 'fastboost:request-uuid', email: wrongCompany ? 'other@example.test' : 'owner@example.test', status: companyComplete ? 'completed' : 'sent', signedDateTime: companyComplete ? '2026-09-30T11:00:00Z' : undefined, name: 'Test Owner' },
        ] });
        if (url.endsWith('/envelopes/envelope')) return Response.json({ status: complete ? 'completed' : 'sent' });
        throw Error(`Unexpected request ${url}`);
    };
    const path = require.resolve('../src/utils/docusign'); delete require.cache[path];
    const ds = require(path);
    const contract = { id: 'request-uuid', boosterId: 'booster', signerName: 'Test Booster', signerEmail: 'booster@example.test', title: 'Agreement', templateId: 'template', accountId: 'account', environment: 'demo', envelopeId: 'envelope', startsAt: new Date('2026-09-30'), companySignerName: 'Test Owner', companySignerEmail: 'owner@example.test' };
    try {
        assert.equal(await ds.sendContract(contract), 'envelope');
        const body = JSON.parse(calls.find(c => c.url.endsWith('/envelopes')).options.body);
        assert.equal(body.transactionId, contract.id);
        assert.equal(body.templateRoles[0].clientUserId, 'booster');
        assert.equal(body.templateRoles[0].roleName, 'Booster');
        assert.equal(body.templateRoles[1].roleName, 'FastBoost');
        assert.equal(body.templateRoles[1].clientUserId, 'fastboost:request-uuid');
        assert.equal(body.templateRoles[1].email, 'owner@example.test');
        assert.equal(body.templateRoles[0].tabs, undefined);
        assert.equal(body.templateRoles[1].tabs.textTabs.find(t => t.tabLabel === 'ProviderLegalName').value, 'Test Booster');
        assert.equal(body.templateRoles[1].tabs.textTabs.find(t => t.tabLabel === 'EffectiveDate').value, '2026-09-30');
        assert.ok(body.templateRoles[1].tabs.textTabs.every(t => t.locked === 'true'));
        assert.equal(ds.readiness().configured, true);
        delete process.env.DOCUSIGN_COMPANY_SIGNER_EMAIL;
        assert.equal(ds.readiness().configured, false);
        process.env.DOCUSIGN_COMPANY_SIGNER_EMAIL = 'replacement@example.test';
        // Issued contracts retain their original recipient even when settings change.
        const sendsBefore = calls.filter(c => c.url.endsWith('/envelopes')).length;
        assert.equal(await ds.sendContract({ ...contract, sendAttemptAt: new Date() }), 'recovered');
        assert.equal(calls.filter(c => c.url.endsWith('/envelopes')).length, sendsBefore);
        await assert.rejects(ds.sendContract({ ...contract, sendAttemptAt: new Date(Date.now() - 8 * 86400000) }), /recovery window/);
        await ds.signingView(contract);
        const view = JSON.parse(calls.find(c => c.url.endsWith('/views/recipient')).options.body);
        assert.equal(view.returnUrl, 'http://localhost:5173/provider/contracts/request-uuid?signingReturn=1');
        await ds.signingView(contract, true);
        const companyView = JSON.parse(calls.filter(c => c.url.endsWith('/views/recipient')).at(-1).options.body);
        assert.equal(companyView.email, 'owner@example.test');
        assert.equal(companyView.clientUserId, 'fastboost:request-uuid');
        assert.deepEqual(await ds.getStatus(contract), { status: 'sent' });
        companyComplete = true;
        const partial = await ds.getStatus(contract);
        assert.ok(partial.companySignedAt);
        assert.equal(partial.signedAt, undefined);
        assert.equal(partial.boosterSignedAt, undefined);
        complete = true;
        assert.equal((await ds.getStatus(contract)).signedName, 'Test Booster');
        assert.equal((await ds.getStatus(contract)).signedAt.toISOString(), '2026-09-30T12:00:00.000Z');
        wrongCompany = true;
        await assert.rejects(ds.getStatus(contract), /every required signer/);
        wrongCompany = false; companyComplete = false;
        await assert.rejects(ds.getStatus(contract), /every required signer/);
        companyComplete = true;
        assert.equal((await ds.getStatus({ ...contract, companySignerEmail: null })).signedName, 'Test Booster');
        wrongSigner = true;
        await assert.rejects(ds.getStatus(contract), /could not be verified/);
        await assert.rejects(ds.sendContract({ ...contract, companySignerEmail: null }), /no FastBoost countersigner/);
        invalidTemplate = true;
        const sendsBeforeInvalid = calls.filter(c => c.url.endsWith('/envelopes')).length;
        await assert.rejects(ds.sendContract(contract), /two-signer template/);
        assert.equal(calls.filter(c => c.url.endsWith('/envelopes')).length, sendsBeforeInvalid);
        invalidTemplate = false; missingFields = true;
        await assert.rejects(ds.sendContract(contract), /missing required provider identity/);
        assert.equal(calls.filter(c => c.url.endsWith('/envelopes')).length, sendsBeforeInvalid);
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
