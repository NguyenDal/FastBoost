const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { queueNativeContractEmail, relevant, completedAttachment, deliverPendingNativeContractEmails } = require('../src/utils/nativeContractEmail');

const digest = value => createHash('sha256').update(value).digest('hex');
const id = '00000000-0000-4000-8000-000000000088';
const pdf = Buffer.from('%PDF-1.7\ncompleted agreement');
const contract = {
    id, title: 'Booster Service Agreement', signingProvider: 'FASTBOOST',
    signerName: 'Jordan Example', signerEmail: 'booster@example.test',
    companySignerName: 'Alex Example', companySignerEmail: 'owner@example.test',
    startsAt: new Date('2026-10-24T00:00:00Z'),
    boosterSignedAt: new Date('2026-10-24T01:00:00Z'),
    companySignedAt: new Date('2026-10-24T02:00:00Z'),
    signedAt: new Date('2026-10-24T02:00:00Z'), nativeCompletedAt: new Date('2026-10-24T02:00:00Z'),
    nativePdf: pdf, nativePdfHash: digest(pdf), status: 'completed',
};

test('agreement email events use one stable outbox identity per recipient', async () => {
    const writes = [];
    const tx = { nativeContractEmail: { createMany: async input => { writes.push(input); return { count: input.data.length }; } } };
    await queueNativeContractEmail(tx, id, 'ISSUED');
    await queueNativeContractEmail(tx, id, 'READY');
    await queueNativeContractEmail(tx, id, 'BOOSTER_SIGNED');
    await queueNativeContractEmail(tx, id, 'COMPANY_SIGNED');
    await queueNativeContractEmail(tx, id, 'COMPLETED');
    assert.deepEqual(writes.map(write => write.data.map(row => row.recipientRole)), [['BOOSTER'], ['BOOSTER'], ['COMPANY'], ['BOOSTER'], ['BOOSTER', 'COMPANY']]);
    assert.equal(new Set(writes.flatMap(write => write.data.map(row => row.id))).size, 6);
    assert.ok(writes.every(write => write.skipDuplicates));
    await assert.rejects(queueNativeContractEmail(tx, id, 'UNKNOWN'), /Unknown/);
});

test('a missing agreement email table returns an actionable unavailable error without hiding unrelated failures', async () => {
    const missing = [
        { code: 'P2021', meta: { table: 'public.NativeContractEmail' } },
        { code: 'P2021', meta: { table: '"public"."NativeContractEmail"' } },
        { code: '42P01', message: 'relation "NativeContractEmail" does not exist' },
        { code: 'P2010', meta: { code: '42P01', message: 'relation "public.NativeContractEmail" does not exist' } },
        { code: 'P2021', meta: { driverAdapterError: { cause: { kind: 'TableDoesNotExist', table: 'public.NativeContractEmail' } } } },
        { cause: { originalCode: '42P01', originalMessage: 'relation "NativeContractEmail" does not exist' } },
    ];
    for (const failure of missing) {
        const tx = { nativeContractEmail: { createMany: async () => { throw failure; } } };
        await assert.rejects(queueNativeContractEmail(tx, id, 'COMPANY_SIGNED'), error => {
            assert.equal(error.status, 503);
            assert.match(error.message, /contact FastBoost support.*then retry/);
            assert.equal(error.cause, failure);
            return true;
        });
    }
    for (const failure of [
        { code: 'P2021', meta: { table: 'public.User', modelName: 'NativeContractEmail' } },
        { code: '42P01', message: 'relation "NativeContractEmailSecret" does not exist' },
        { code: 'P1001', message: 'Cannot reach the database' },
    ]) {
        const tx = { nativeContractEmail: { createMany: async () => { throw failure; } } };
        await assert.rejects(queueNativeContractEmail(tx, id, 'COMPANY_SIGNED'), error => error === failure);
    }
});

test('only real event transitions are deliverable and the final PDF hash must match', () => {
    assert.equal(relevant({ event: 'ISSUED', recipientRole: 'BOOSTER' }, contract), true);
    assert.equal(relevant({ event: 'READY', recipientRole: 'BOOSTER' }, { ...contract, nativePreparedAt: new Date() }), true);
    assert.equal(relevant({ event: 'READY', recipientRole: 'BOOSTER' }, { ...contract, nativePreparedAt: null }), false);
    assert.equal(relevant({ event: 'BOOSTER_SIGNED', recipientRole: 'COMPANY' }, contract), true);
    const ownerFirst = { ...contract, nativeSnapshot: { version: 'FB-BSA-2.3' }, nativePreparedAt: new Date() };
    assert.equal(relevant({ event: 'COMPANY_SIGNED', recipientRole: 'BOOSTER' }, ownerFirst), true);
    assert.equal(relevant({ event: 'COMPANY_SIGNED', recipientRole: 'BOOSTER' }, { ...ownerFirst, nativeSnapshot: { version: 'FB-BSA-2.4' } }), true);
    assert.equal(relevant({ event: 'COMPANY_SIGNED', recipientRole: 'BOOSTER' }, { ...ownerFirst, companySignedAt: null }), false);
    assert.equal(relevant({ event: 'COMPANY_SIGNED', recipientRole: 'BOOSTER' }, { ...ownerFirst, nativeSnapshot: { version: 'FB-BSA-2.2' } }), false);
    assert.equal(relevant({ event: 'COMPANY_SIGNED', recipientRole: 'COMPANY' }, ownerFirst), false);
    assert.equal(relevant({ event: 'COMPLETED', recipientRole: 'BOOSTER' }, contract), true);
    assert.equal(relevant({ event: 'COMPLETED', recipientRole: 'COMPANY' }, { ...contract, companySignedAt: null }), false);
    assert.equal(relevant({ event: 'ISSUED', recipientRole: 'BOOSTER' }, { ...contract, revokedAt: new Date() }), false);
    const attachment = completedAttachment(contract)[0];
    assert.equal(attachment.contentType, 'application/pdf');
    assert.deepEqual(attachment.content, pdf);
    assert.throws(() => completedAttachment({ ...contract, nativePdfHash: '0'.repeat(64) }), /verified/);
});

test('completion mail goes to both accounts with the same saved PDF and authenticated agreement link', async () => {
    const oldUrl = process.env.CLIENT_URL;
    process.env.CLIENT_URL = 'https://fastboost.gg';
    try {
        const now = new Date('2026-10-24T03:00:00Z');
        const rows = ['BOOSTER', 'COMPANY'].map(recipientRole => ({ id: `${id}:COMPLETED:${recipientRole}`, contractId: id,
            event: 'COMPLETED', recipientRole, attempts: 0, nextAttemptAt: now, sentAt: null, skippedAt: null, claim: null }));
        const emails = [];
        const marked = [];
        const db = { nativeContractEmail: {
            findMany: async () => rows,
            updateMany: async ({ where, data }) => {
                const row = rows.find(candidate => candidate.id === where.id);
                if (!row) return { count: 0 };
                Object.assign(row, data);
                if (data.sentAt) marked.push(row.id);
                return { count: 1 };
            },
            findUnique: async ({ where }) => ({ ...rows.find(row => row.id === where.id), contract }),
        } };
        const transport = { sendMail: async mail => { emails.push(mail); return { accepted: [mail.to.address] }; } };
        await deliverPendingNativeContractEmails(db, transport, () => now);
        assert.deepEqual(emails.map(mail => mail.to.address).sort(), ['booster@example.test', 'owner@example.test']);
        assert.equal(marked.length, 2);
        for (const mail of emails) {
            assert.match(mail.html, new RegExp(`/provider/contracts/${id}`));
            assert.equal(mail.attachments.length, 1);
            assert.deepEqual(mail.attachments[0].content, pdf);
            assert.equal(mail.disableFileAccess, true);
        }
    } finally {
        if (oldUrl === undefined) delete process.env.CLIENT_URL;
        else process.env.CLIENT_URL = oldUrl;
    }
});
