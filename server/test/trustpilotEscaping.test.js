const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

test('Trustpilot escapes HTML fields and safely embeds a lossless JSON payload', async t => {
    const previous = { ...process.env };
    Object.assign(process.env, { TRUSTPILOT_AFS_EMAIL: 'afs@example.test', SMTP_HOST: 'offline', SMTP_USER: 'offline', SMTP_PASS: 'offline' });
    t.after(() => { for (const key of ['TRUSTPILOT_AFS_EMAIL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
        if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    } });
    let mail;
    t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async options => { mail = options; } }));
    const name = '</p><a href="https://example.invalid">click</a><script>bad</script>';
    const { sendTrustpilotReviewInvite } = require('../src/utils/trustpilotEmail');
    await sendTrustpilotReviewInvite({ id: 'one', orderNumber: 'TEST-1', totalPrice: 10, customer: { username: name, email: 'customer@example.test' }, service: { title: '<b>Service</b>' } });
    assert.doesNotMatch(mail.html, /<a href=|<b>Service|<script>bad/);
    assert.match(mail.html, /&lt;\/p&gt;&lt;a/);
    const json = mail.html.match(/<script type="application\/json\+trustpilot">\s*([\s\S]*?)\s*<\/script>/)[1];
    assert.doesNotMatch(json, /</);
    assert.equal(JSON.parse(json).recipientName, name);
});
