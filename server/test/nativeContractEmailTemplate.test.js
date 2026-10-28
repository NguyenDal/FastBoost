const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNativeContractEmail, nativeContractEmailEvents } = require('../src/utils/nativeContractEmailTemplate');

const contract = { id: 'd4d8b681-1533-4eec-ba38-a8dbefb4c733', signerName: 'Nguyễn Minh Anh' };
const options = { clientUrl: 'https://www.fastboost.gg', nodeEnv: 'production' };
const path = `https://www.fastboost.gg/provider/contracts/${contract.id}`;

test('all agreement updates contain the exact agreement, booster, status and authenticated route', () => {
    assert.deepEqual(Object.keys(nativeContractEmailEvents), ['ISSUED', 'READY', 'BOOSTER_SIGNED', 'COMPANY_SIGNED', 'COMPLETED']);
    for (const event of Object.keys(nativeContractEmailEvents)) {
        const mail = buildNativeContractEmail(contract, event, options);
        assert.match(mail.subject, /^FastBoost · /u);
        assert.match(mail.text, new RegExp(contract.id, 'u'));
        assert.match(mail.text, /Nguyễn Minh Anh/u);
        assert.match(mail.text, /Update:/u);
        assert.match(mail.text, new RegExp(path, 'u'));
        assert.match(mail.html, new RegExp(`href="${path}"`, 'u'));
        assert.match(mail.html, /Fast<span style="color:#cc8aff">Boost<\/span>/u);
        assert.match(mail.html, /AGREEMENT UPDATE/u);
        assert.equal(Object.hasOwn(mail, 'to'), false, 'recipient selection belongs to the outbox');
        assert.equal(Object.hasOwn(mail, 'attachments'), false, 'the outbox attaches the saved signed PDF');
    }
});

test('event copy stays truthful when delivery follows a later signing step', () => {
    const issued = buildNativeContractEmail(contract, 'ISSUED', options);
    assert.match(issued.text, /created your agreement.*latest status/u);
    assert.doesNotMatch(issued.text, /awaiting your signature|sign now/u);
    const ready = buildNativeContractEmail(contract, 'READY', options);
    assert.match(ready.text, /filled in the work and payment details.*If it is waiting for your signature/u);
    const boosterSigned = buildNativeContractEmail(contract, 'BOOSTER_SIGNED', options);
    assert.match(boosterSigned.text, /booster signed the agreement.*If FastBoost still needs to sign/u);
    const companySigned = buildNativeContractEmail(contract, 'COMPANY_SIGNED', options);
    assert.match(companySigned.text, /FastBoost completed the details and signed.*If your signature is still needed/u);
    const completed = buildNativeContractEmail(contract, 'COMPLETED', options);
    assert.match(completed.text, /signed PDF is attached/u);
    assert.match(completed.html, /signed PDF is attached/u);
    assert.match(completed.text, /Both parties signed/u);
});

test('dynamic details are escaped in HTML and unsafe links are rejected', () => {
    const unsafe = { ...contract, signerName: '<img src=x onerror=alert(1)>' };
    const mail = buildNativeContractEmail(unsafe, 'ISSUED', options);
    assert.doesNotMatch(mail.html, /<img src=x onerror/u);
    assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
    assert.throws(() => buildNativeContractEmail(contract, 'ISSUED', { clientUrl: 'http://fastboost.gg', nodeEnv: 'production' }), /HTTPS/u);
    assert.throws(() => buildNativeContractEmail(contract, 'ISSUED', { clientUrl: 'http://localhost:5173', nodeEnv: 'production' }), /HTTPS/u);
    assert.throws(() => buildNativeContractEmail(contract, 'ISSUED', { clientUrl: 'https://user:password@fastboost.gg', nodeEnv: 'production' }), /HTTPS/u);
    assert.match(buildNativeContractEmail(contract, 'ISSUED', { clientUrl: 'http://localhost:5173', nodeEnv: 'development' }).text, /http:\/\/localhost:5173\/provider\/contracts\//u);
    assert.throws(() => buildNativeContractEmail(contract, 'UNKNOWN', options), /Unknown/u);
    assert.throws(() => buildNativeContractEmail({ ...contract, id: '../other' }, 'ISSUED', options), /Agreement ID/u);
    assert.throws(() => buildNativeContractEmail({ ...contract, signerName: 'Name\r\nBcc: test@example.test' }, 'ISSUED', options), /Booster legal name/u);
});
