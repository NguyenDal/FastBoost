const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const agreement = require('../src/utils/nativeAgreement');
const { queueNativeContractEmail, relevant, completedAttachment, deliverPendingNativeContractEmails } = require('../src/utils/nativeContractEmail');

const digest = value => createHash('sha256').update(value).digest('hex');
const id = '00000000-0000-4000-8000-000000000088';
const pdf = Buffer.from('%PDF-1.7\ncompleted agreement');
const displayPdf = Buffer.from('%PDF-1.7\nmodern signature presentation without completion appendix');
const snapshot = { version: 'FB-BSA-2.2', values: { WorkLocation: 'Original location' }, documentBase64: 'retained base PDF', fields: [] };
const contract = {
    id, title: 'Booster Service Agreement', signingProvider: 'FASTBOOST',
    signerName: 'Jordan Example', signerEmail: 'booster@example.test',
    companySignerName: 'Alex Example', companySignerEmail: 'owner@example.test',
    startsAt: new Date('2026-10-24T00:00:00Z'),
    boosterSignedAt: new Date('2026-10-24T01:00:00Z'),
    companySignedAt: new Date('2026-10-24T02:00:00Z'),
    signedAt: new Date('2026-10-24T02:00:00Z'), nativeCompletedAt: new Date('2026-10-24T02:00:00Z'),
    nativePdf: pdf, nativePdfHash: digest(pdf), status: 'completed',
    nativeSnapshot: snapshot, nativeDocumentHash: agreement.snapshotHash(snapshot), nativePreparedAt: new Date('2026-10-24T00:30:00Z'),
};
contract.nativeSignatures = ['BOOSTER', 'COMPANY'].map(role => ({
    contractId: id, role, documentHash: contract.nativeDocumentHash,
    signedAt: role === 'COMPANY' ? contract.companySignedAt : contract.boosterSignedAt,
    legalName: role === 'COMPANY' ? contract.companySignerName : contract.signerName, signature: { type: 'typed', style: 1 },
}));
const readyContract = {
    ...contract, nativeSnapshot: { version: 'FB-BSA-2.4' }, nativePreparedAt: new Date('2026-10-24T00:30:00Z'),
    nativeDocumentHash: 'a'.repeat(64), status: 'sent', boosterSignedAt: null, signedAt: null, nativeCompletedAt: null,
};

function stubPresentation(t) {
    const original = agreement.renderPresentationPdf;
    const calls = [];
    agreement.renderPresentationPdf = async (...args) => { calls.push(args); return displayPdf; };
    t.after(() => { if (original === undefined) delete agreement.renderPresentationPdf; else agreement.renderPresentationPdf = original; });
    return calls;
}

test('agreement email events use one stable outbox identity per recipient', async () => {
    const writes = [];
    const tx = { nativeContractEmail: { createMany: async input => { writes.push(input); return { count: input.data.length }; } } };
    await queueNativeContractEmail(tx, id, 'BOOSTER_SIGNED');
    await queueNativeContractEmail(tx, id, 'COMPANY_SIGNED');
    await queueNativeContractEmail(tx, id, 'COMPLETED');
    assert.deepEqual(writes.map(write => write.data.map(row => row.recipientRole)), [['COMPANY'], ['BOOSTER'], ['BOOSTER', 'COMPANY']]);
    assert.equal(new Set(writes.flatMap(write => write.data.map(row => row.id))).size, 4);
    assert.ok(writes.every(write => write.skipDuplicates));
    await assert.rejects(queueNativeContractEmail(tx, id, 'UNKNOWN'), /Unknown/);
    await assert.rejects(queueNativeContractEmail(tx, id, 'ISSUED'), /Unknown/);
    await assert.rejects(queueNativeContractEmail(tx, id, 'READY'), /Unknown/);
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

test('only real event transitions are deliverable and presentation attachments verify original evidence', async t => {
    const renders = stubPresentation(t);
    assert.equal(relevant({ event: 'ISSUED', recipientRole: 'BOOSTER' }, contract), false);
    assert.equal(relevant({ event: 'READY', recipientRole: 'BOOSTER' }, { ...contract, nativePreparedAt: new Date() }), false);
    assert.equal(relevant({ event: 'READY', recipientRole: 'BOOSTER' }, { ...contract, nativePreparedAt: null }), false);
    assert.equal(relevant({ event: 'BOOSTER_SIGNED', recipientRole: 'COMPANY' }, contract), true);
    const ownerFirst = { ...readyContract, nativeSnapshot: { version: 'FB-BSA-2.3' } };
    assert.equal(relevant({ event: 'COMPANY_SIGNED', recipientRole: 'BOOSTER' }, ownerFirst), true);
    assert.equal(relevant({ event: 'COMPANY_SIGNED', recipientRole: 'BOOSTER' }, { ...ownerFirst, nativeSnapshot: { version: 'FB-BSA-2.4' } }), true);
    assert.equal(relevant({ event: 'COMPANY_SIGNED', recipientRole: 'BOOSTER' }, { ...ownerFirst, companySignedAt: null }), false);
    assert.equal(relevant({ event: 'COMPANY_SIGNED', recipientRole: 'BOOSTER' }, { ...ownerFirst, nativeSnapshot: { version: 'FB-BSA-2.2' } }), false);
    assert.equal(relevant({ event: 'COMPANY_SIGNED', recipientRole: 'COMPANY' }, ownerFirst), false);
    assert.equal(relevant({ event: 'COMPLETED', recipientRole: 'BOOSTER' }, contract), true);
    assert.equal(relevant({ event: 'COMPLETED', recipientRole: 'COMPANY' }, { ...contract, companySignedAt: null }), false);
    assert.equal(relevant({ event: 'ISSUED', recipientRole: 'BOOSTER' }, { ...contract, revokedAt: new Date() }), false);
    const attachment = (await completedAttachment(contract))[0];
    assert.equal(attachment.contentType, 'application/pdf');
    assert.deepEqual(attachment.content, displayPdf);
    assert.deepEqual(renders[0], [snapshot, contract.nativeSignatures, { completed: true }]);
    assert.deepEqual(contract.nativePdf, pdf, 'delivery never replaces the retained PDF');
    await assert.rejects(completedAttachment({ ...contract, nativePdfHash: '0'.repeat(64) }), /verified/);
    assert.equal(renders.length, 1, 'bad original evidence cannot be rendered');
});

test('booster invitations require a prepared company-signed agreement still awaiting the booster', () => {
    const invitation = { event: 'COMPANY_SIGNED', recipientRole: 'BOOSTER' };
    assert.equal(relevant(invitation, readyContract), true);
    for (const event of ['ISSUED', 'READY']) {
        for (const state of [readyContract, contract, { ...readyContract, companySignedAt: null }]) {
            assert.equal(relevant({ event, recipientRole: 'BOOSTER' }, state), false, `${event} stays retired at every stage`);
        }
    }
    for (const [key, value] of [
        ['nativePreparedAt', null], ['nativeDocumentHash', null], ['nativePdf', null], ['nativePdfHash', null],
        ['companySignedAt', null], ['boosterSignedAt', new Date()], ['signedAt', new Date()], ['nativeCompletedAt', new Date()],
        ['revokedAt', new Date()], ['archivedAt', new Date()], ['status', 'completed'], ['status', 'voided'],
        ['status', 'declined'], ['status', 'replaced'], ['signingProvider', 'DOCUSIGN'],
        ['nativeSnapshot', { version: 'FB-BSA-2.2' }],
    ]) assert.equal(relevant(invitation, { ...readyContract, [key]: value }), false, `${key}: ${value}`);
});

function invitationOutbox(events, readContract) {
    const now = new Date('2026-10-24T03:00:00Z');
    const rows = events.map(event => ({ id: `${id}:${event}:BOOSTER`, contractId: id, event, recipientRole: 'BOOSTER',
        attempts: 0, nextAttemptAt: now, sentAt: null, skippedAt: null, claim: null }));
    const sent = [];
    const db = { nativeContractEmail: {
        findMany: async () => rows.filter(row => !row.sentAt && !row.skippedAt && row.nextAttemptAt <= now).map(row => ({ ...row })),
        updateMany: async ({ where, data }) => {
            const row = rows.find(candidate => candidate.id === where.id);
            if (!row || row.sentAt || row.skippedAt || (where.claim && row.claim !== where.claim)) return { count: 0 };
            const attempts = row.attempts + (data.attempts?.increment || 0);
            Object.assign(row, data, { attempts });
            return { count: 1 };
        },
        findUnique: async ({ where }) => ({ ...rows.find(row => row.id === where.id), contract: readContract() }),
    } };
    return { rows, sent, db, now, transport: { sendMail: async mail => { sent.push(mail); return { accepted: [mail.to.address] }; } } };
}

test('queued creation/preparation notices are discarded and only the ready invitation is sent once', async t => {
    const oldUrl = process.env.CLIENT_URL;
    process.env.CLIENT_URL = 'https://fastboost.gg';
    t.after(() => { if (oldUrl === undefined) delete process.env.CLIENT_URL; else process.env.CLIENT_URL = oldUrl; });
    const f = invitationOutbox(['ISSUED', 'READY', 'COMPANY_SIGNED'], () => readyContract);
    await deliverPendingNativeContractEmails(f.db, f.transport, () => f.now);
    await deliverPendingNativeContractEmails(f.db, f.transport, () => f.now);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].to.address, 'booster@example.test');
    assert.equal(f.sent[0].subject, 'FastBoost · Your agreement is ready to sign');
    assert.match(f.sent[0].text, new RegExp(`/provider/contracts/${id}/sign`));
    assert.doesNotMatch(f.sent[0].text, /FastBoost signed/);
    assert.equal(f.sent[0].attachments, undefined);
    assert.ok(f.rows.find(row => row.event === 'COMPANY_SIGNED').sentAt);
    assert.ok(f.rows.filter(row => row.event !== 'COMPANY_SIGNED').every(row => row.skippedAt && row.lastError === 'EVENT_SUPERSEDED'));
});

test('delivery rechecks the agreement and skips an invitation after the booster has signed', async () => {
    let current = readyContract;
    const f = invitationOutbox(['COMPANY_SIGNED'], () => current);
    const findMany = f.db.nativeContractEmail.findMany;
    f.db.nativeContractEmail.findMany = async () => {
        const rows = await findMany();
        current = { ...readyContract, boosterSignedAt: new Date() };
        return rows;
    };
    await deliverPendingNativeContractEmails(f.db, f.transport, () => f.now);
    assert.equal(f.sent.length, 0);
    assert.ok(f.rows[0].skippedAt);
    assert.equal(f.rows[0].lastError, 'EVENT_SUPERSEDED');
});

test('completion mail sends modern copies to both accounts without replacing the saved PDF or resending sent mail', async t => {
    const renders = stubPresentation(t);
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
            findUnique: async ({ where, include }) => {
                assert.deepEqual(include.contract.include.nativeSignatures.orderBy, [{ signedAt: 'asc' }, { role: 'asc' }]);
                return { ...rows.find(row => row.id === where.id), contract };
            },
        } };
        const transport = { sendMail: async mail => { emails.push(mail); return { accepted: [mail.to.address] }; } };
        await deliverPendingNativeContractEmails(db, transport, () => now);
        assert.deepEqual(emails.map(mail => mail.to.address).sort(), ['booster@example.test', 'owner@example.test']);
        assert.equal(marked.length, 2);
        for (const mail of emails) {
            assert.match(mail.html, new RegExp(`/provider/contracts/${id}`));
            assert.equal(mail.attachments.length, 1);
            assert.deepEqual(mail.attachments[0].content, displayPdf);
            assert.equal(mail.disableFileAccess, true);
        }
        assert.equal(renders.length, 2);
        assert.deepEqual(contract.nativePdf, pdf);
        assert.equal(contract.nativePdfHash, digest(pdf));
        await deliverPendingNativeContractEmails(db, transport, () => now);
        assert.equal(emails.length, 2, 'an already-sent completion notice is never sent again for a new presentation');
    } finally {
        if (oldUrl === undefined) delete process.env.CLIENT_URL;
        else process.env.CLIENT_URL = oldUrl;
    }
});

test('completion delivery fails closed when signature rows are missing or no longer match the retained snapshot', async t => {
    const renders = stubPresentation(t);
    t.mock.method(console, 'error', () => {});
    const oldUrl = process.env.CLIENT_URL;
    process.env.CLIENT_URL = 'https://fastboost.gg';
    t.after(() => { if (oldUrl === undefined) delete process.env.CLIENT_URL; else process.env.CLIENT_URL = oldUrl; });
    for (const nativeSignatures of [undefined, [], [{ ...contract.nativeSignatures[0], documentHash: '0'.repeat(64) }, contract.nativeSignatures[1]]]) {
        const f = invitationOutbox(['COMPLETED'], () => ({ ...contract, nativeSignatures }));
        await deliverPendingNativeContractEmails(f.db, f.transport, () => f.now);
        assert.equal(f.sent.length, 0);
        assert.equal(f.rows[0].sentAt, null);
        assert.equal(f.rows[0].lastError, 'DELIVERY_FAILED');
    }
    assert.equal(renders.length, 0);
});
