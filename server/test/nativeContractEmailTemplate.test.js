const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNativeContractEmail, nativeContractEmailEvents } = require('../src/utils/nativeContractEmailTemplate');

const contract = { id: 'd4d8b681-1533-4eec-ba38-a8dbefb4c733', signerName: 'Nguyễn Minh Anh' };
const options = { clientUrl: 'https://www.fastboost.gg', nodeEnv: 'production' };
const path = `https://www.fastboost.gg/provider/contracts/${contract.id}`;

test('all agreement updates contain the exact agreement, booster, status and authenticated route', () => {
    assert.deepEqual(Object.keys(nativeContractEmailEvents), ['BOOSTER_SIGNED', 'COMPANY_SIGNED', 'COMPLETED']);
    for (const event of Object.keys(nativeContractEmailEvents)) {
        const mail = buildNativeContractEmail(contract, event, options);
        assert.match(mail.subject, /^FastBoost · /u);
        assert.match(mail.text, new RegExp(contract.id, 'u'));
        assert.match(mail.text, /Nguyễn Minh Anh/u);
        assert.match(mail.text, /Update:/u);
        assert.match(mail.text, new RegExp(path, 'u'));
        assert.match(mail.html, new RegExp(`href="${path}${event === 'COMPANY_SIGNED' ? '/sign' : ''}"`, 'u'));
        assert.match(mail.html, /Fast<span style="color:#cc8aff">Boost<\/span>/u);
        assert.match(mail.html, /AGREEMENT UPDATE/u);
        assert.equal(Object.hasOwn(mail, 'to'), false, 'recipient selection belongs to the outbox');
        assert.equal(Object.hasOwn(mail, 'attachments'), false, 'the outbox attaches the saved signed PDF');
    }
});

test('invitation copy says ready to sign without announcing the company signature', () => {
    const boosterSigned = buildNativeContractEmail(contract, 'BOOSTER_SIGNED', options);
    assert.match(boosterSigned.text, /booster signed the agreement.*If FastBoost still needs to sign/u);
    const companySigned = buildNativeContractEmail(contract, 'COMPANY_SIGNED', options);
    assert.equal(companySigned.subject, 'FastBoost · Your agreement is ready to sign');
    assert.match(companySigned.text, /Your Booster Service Agreement is ready for your signature/u);
    assert.match(companySigned.text, /Update: Ready to sign/u);
    assert.match(companySigned.html, />Your agreement is ready to sign<\/h1>/u);
    assert.match(companySigned.html, /Review &amp; sign/u);
    assert.doesNotMatch(companySigned.text + companySigned.html, /FastBoost signed|FASTBOOST SIGNED|FastBoost completed|If your signature is still needed/u);
    assert.match(companySigned.html, new RegExp(`href="${path}/sign"`, 'u'));
    const completed = buildNativeContractEmail(contract, 'COMPLETED', options);
    assert.match(completed.text, /signed PDF is attached/u);
    assert.match(completed.html, /signed PDF is attached/u);
    assert.match(completed.text, /Both parties signed/u);
    assert.throws(() => buildNativeContractEmail(contract, 'ISSUED', options), /Unknown/u);
    assert.throws(() => buildNativeContractEmail(contract, 'READY', options), /Unknown/u);
});

test('development agreement emails use a public logo while retaining their direct local review link', () => {
    const mail = buildNativeContractEmail(contract, 'COMPANY_SIGNED', { clientUrl: 'http://localhost:5173', nodeEnv: 'development' });
    assert.match(mail.html, /src="https:\/\/www\.fastboost\.gg\/assets\/logos\/fastboost-logo\.png"/u);
    assert.doesNotMatch(mail.html, /src="http:\/\/localhost/u);
    assert.match(mail.html, new RegExp(`href="http://localhost:5173/provider/contracts/${contract.id}/sign"`, 'u'));
    assert.match(mail.text, new RegExp(`http://localhost:5173/provider/contracts/${contract.id}/sign`, 'u'));
});

test('dynamic details are escaped in HTML and unsafe links are rejected', () => {
    const unsafe = { ...contract, signerName: '<img src=x onerror=alert(1)>' };
    const mail = buildNativeContractEmail(unsafe, 'COMPANY_SIGNED', options);
    assert.doesNotMatch(mail.html, /<img src=x onerror/u);
    assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
    assert.throws(() => buildNativeContractEmail(contract, 'COMPANY_SIGNED', { clientUrl: 'http://fastboost.gg', nodeEnv: 'production' }), /HTTPS/u);
    assert.throws(() => buildNativeContractEmail(contract, 'COMPANY_SIGNED', { clientUrl: 'http://localhost:5173', nodeEnv: 'production' }), /HTTPS/u);
    assert.throws(() => buildNativeContractEmail(contract, 'COMPANY_SIGNED', { clientUrl: 'https://user:password@fastboost.gg', nodeEnv: 'production' }), /HTTPS/u);
    assert.match(buildNativeContractEmail(contract, 'COMPANY_SIGNED', { clientUrl: 'http://localhost:5173', nodeEnv: 'development' }).text, /http:\/\/localhost:5173\/provider\/contracts\//u);
    assert.throws(() => buildNativeContractEmail(contract, 'UNKNOWN', options), /Unknown/u);
    assert.throws(() => buildNativeContractEmail({ ...contract, id: '../other' }, 'COMPANY_SIGNED', options), /Agreement ID/u);
    assert.throws(() => buildNativeContractEmail({ ...contract, signerName: 'Name\r\nBcc: test@example.test' }, 'COMPANY_SIGNED', options), /Booster legal name/u);
});
