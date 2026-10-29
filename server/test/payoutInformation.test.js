const test = require('node:test');
const assert = require('node:assert/strict');
const { createPayoutInformationService, validateDetails, summary } = require('../src/utils/payoutInformation');

const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const us = { country: 'US', legalName: 'Test Person', accountNumber: '000001234567', routingNumber: '021000021', currency: 'USD' };
const vn = { country: 'VN', legalName: 'Nguyễn Văn An', accountNumber: '0000123456789', bankName: 'Vietcombank', currency: 'VND' };
const actor = userId => ({ id: userId });
function fixture() {
    let state = { users: [
        { id: 'admin', role: 'ADMIN', username: 'Admin', suspendedAt: null },
        { id: 'provider', role: 'PROVIDER', username: 'Booster', suspendedAt: null },
        { id: 'other', role: 'PROVIDER', suspendedAt: null },
        { id: 'customer', role: 'CUSTOMER', suspendedAt: null },
        { id: 'admin-booster', role: 'ADMIN', hasBoosterAccess: true, suspendedAt: null },
    ], records: [], audit: [], notifications: [] };
    const copy = value => value == null ? value : structuredClone(value);
    const project = (row, select) => row && (select ? Object.fromEntries(Object.keys(select).map(key => [key, row[key]])) : copy(row));
    let failCas = false;
    const match = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
    const db = {
        user: {
            async findUnique({ where, select }) { return project(state.users.find(user => user.id === where.id), select); },
            async findMany({ where, select }) { return state.users.filter(user => user.role === where.role && user.suspendedAt === null && user.id !== where.id?.not).map(user => project(user, select)); },
        },
        payoutInformation: {
            async findUnique({ where, select }) { return project(state.records.find(record => match(record, where)), select); },
            async findFirst() { return copy(state.records[0] || null); },
            async findMany({ where, select }) { return state.records.filter(record => match(record, where)).map(record => project(record, select)); },
            async create({ data }) {
                if (state.records.some(record => record.id === data.id || record.boosterId === data.boosterId)) throw Object.assign(new Error('unique'), { code: 'P2002' });
                const record = { status: 'REQUESTED', revision: 0, encryptedDetails: null, currency: null, accountLast4: null, detailsRevision: null,
                    correctionReason: null, submittedAt: null, confirmedAt: null, reviewedAt: null, reviewedById: null,
                    createdAt: new Date('2026-10-29T02:00:00Z'), updatedAt: new Date('2026-10-29T02:00:00Z'), ...copy(data) };
                state.records.push(record); return copy(record);
            },
            async updateMany({ where, data }) {
                if (failCas) return { count: 0 };
                const record = state.records.find(row => match(row, where));
                if (!record) return { count: 0 };
                Object.assign(record, copy(data), { revision: data.revision?.increment ? record.revision + data.revision.increment : data.revision ?? record.revision });
                return { count: 1 };
            },
        },
        managementAuditLog: { async create({ data }) { state.audit.push(copy(data)); return data; } },
        notification: { async upsert({ where, create }) { if (!state.notifications.some(row => row.id === where.id)) state.notifications.push(copy(create)); } },
    };
    let queue = Promise.resolve();
    db.$transaction = work => {
        const result = queue.then(async () => { const before = copy(state); try { return await work(db); } catch (error) { state = before; throw error; } });
        queue = result.catch(() => {}); return result;
    };
    const vault = { configured: () => true, async encrypt(details, binding) { return { sealed: JSON.stringify(details), binding: binding.detailsRevision }; },
        async decrypt(envelope, binding) { assert.equal(envelope.binding, binding.detailsRevision); return JSON.parse(envelope.sealed); } };
    const service = createPayoutInformationService(db, vault);
    return { db, service, vault, state: () => state, casFailure: () => { failCas = true; },
        request: (boosterId = 'provider', country = 'US') => service.request(actor('admin'), boosterId, { requestId: id, country }),
        submit: (details = us, revision = 0, user = 'provider') => service.submit(actor(user), id, { revision, details, confirmed: true }) };
}

test('US and Vietnam validation uses only the requested local bank fields and preserves leading zeros', () => {
    assert.deepEqual(validateDetails(us, 'US'), us);
    assert.deepEqual(validateDetails(vn, 'VN'), vn);
    for (const change of [{ routingNumber: '021000022' }, { routingNumber: '000000000' }, { routingNumber: '999999999' },
        { accountNumber: '123' }, { accountNumber: '1'.repeat(18) }, { accountNumber: 12345678 }, { legalName: 'X' },
        { currency: 'VND' }, { bankName: 'Unrequested' }, { password: 'do not collect' }, { country: 'VN' }]) {
        assert.throws(() => validateDetails({ ...us, ...change }, 'US'), error => error.status === 400);
    }
    for (const change of [{ bankName: '' }, { routingNumber: '021000021' }, { currency: 'CAD' }, { accountNumber: '12x456' }]) {
        assert.throws(() => validateDetails({ ...vn, ...change }, 'VN'), error => error.status === 400);
    }
    assert.throws(() => validateDetails({ ...us, legalName: 'Test\nPerson' }, 'US'), /full legal name/);
});

test('admin requests once, repeat delivery retains the exact existing state and requested country can be corrected before submission', async () => {
    const f = fixture();
    assert.deepEqual(await f.request(), { ok: true, id });
    assert.deepEqual(await f.service.request(actor('admin'), 'provider', { requestId: secondId, country: 'US' }), { ok: true, id });
    assert.equal(f.state().records.length, 1); assert.equal(f.state().notifications.length, 1); assert.equal(f.state().audit.length, 1);
    await assert.rejects(f.service.request(actor('admin'), 'other', { requestId: id, country: 'US' }), error => error.status === 409);
    await assert.rejects(f.service.request(actor('admin'), 'provider', { requestId: secondId, country: 'VN' }), error => error.status === 409);
    const changed = await f.service.changeCountry(actor('admin'), id, { revision: 0, country: 'VN' });
    assert.equal(changed.request.country, 'VN'); assert.equal(changed.request.revision, 1);
    await assert.rejects(f.submit(us, 1), /bank country/);
    await f.submit(vn, 1);
    await assert.rejects(f.service.changeCountry(actor('admin'), id, { revision: 2, country: 'US' }), error => error.status === 409);
    const before = structuredClone(f.state().records[0]);
    await f.service.request(actor('admin'), 'provider', { requestId: secondId, country: 'VN' });
    assert.deepEqual(f.state().records[0], before);
});

test('submission, explicit reveal, correction and review bind to revisions and verification resets after an edit', async () => {
    const f = fixture(); await f.request();
    const submitted = await f.submit();
    assert.equal(submitted.request.status, 'SUBMITTED'); assert.equal(submitted.request.revision, 1);
    assert.equal(submitted.request.accountLast4, '4567');
    assert.deepEqual(await f.service.details(actor('admin'), id), { ok: true, details: us, revision: 1 });
    await f.service.review(actor('admin'), id, { revision: 1, decision: 'return', reason: 'ACCOUNT_DETAILS' });
    assert.equal(f.state().records[0].status, 'CHANGES_REQUESTED');
    assert.deepEqual((await f.service.details(actor('provider'), id)).details, us, 'review revision must not break the encryption binding');
    await f.submit({ ...us, accountNumber: '000009876543' }, 2);
    await assert.rejects(f.service.review(actor('admin'), id, { revision: 1, decision: 'verify' }), error => error.status === 409);
    await f.service.review(actor('admin'), id, { revision: 3, decision: 'verify' });
    assert.equal(f.state().records[0].status, 'VERIFIED');
    await f.submit(us, 4);
    assert.equal(f.state().records[0].status, 'SUBMITTED');
    assert.equal(f.state().records[0].reviewedAt, null); assert.equal(f.state().records[0].reviewedById, null);
    assert.equal(f.state().records[0].correctionReason, null);
});

test('ownership, fresh role checks and suspension protect every sensitive operation; admins cannot submit or self-review', async () => {
    const f = fixture(); await f.request();
    for (const method of ['context', 'details']) await assert.rejects(f.service[method](actor('other'), id), error => error.status === 404);
    await assert.rejects(f.submit(us, 0, 'other'), error => error.status === 404);
    await assert.rejects(f.submit(us, 0, 'admin'), error => error.status === 403);
    await assert.rejects(f.service.request(actor('provider'), 'other', { requestId: secondId, country: 'US' }), error => error.status === 403);
    await assert.rejects(f.service.list(actor('customer')), error => error.status === 403);
    await assert.rejects(f.service.details(actor('provider'), id), error => error.status === 409);
    await f.submit();
    f.state().users.find(user => user.id === 'provider').suspendedAt = new Date();
    await assert.rejects(f.service.details(actor('provider'), id), error => error.status === 403);
    f.state().users.find(user => user.id === 'admin').role = 'CUSTOMER';
    await assert.rejects(f.service.review(actor('admin'), id, { revision: 1, decision: 'verify' }), error => error.status === 403);
    const own = fixture(); await own.request('admin-booster'); await own.submit(us, 0, 'admin-booster');
    await assert.rejects(own.service.review(actor('admin-booster'), id, { revision: 1, decision: 'verify' }), error => error.status === 403);
    await own.service.review(actor('admin'), id, { revision: 1, decision: 'verify' });
});

test('lists/context/audits/notifications never include full bank details or encrypted envelopes', async () => {
    const f = fixture(); await f.request(); await f.submit(); await f.service.details(actor('admin'), id);
    const context = await f.service.context(actor('admin'), id);
    assert.equal(context.boosterName, 'Booster'); assert.equal(context.canReview, true); assert.equal(context.canSubmit, false);
    assert.deepEqual((await f.service.list(actor('other'))).requests, []);
    assert.deepEqual((await f.service.list(actor('admin-booster'), 'mine')).requests, []);
    await assert.rejects(f.service.list(actor('provider'), 'all'), error => error.status === 403);
    const output = JSON.stringify([await f.service.list(actor('admin')), await f.service.list(actor('provider')), context, f.state().audit, f.state().notifications]);
    for (const privateValue of [us.legalName, us.routingNumber, us.accountNumber, 'encryptedDetails', 'sealed', 'confirmedAt']) assert.equal(output.includes(privateValue), false, privateValue);
    assert.equal(summary(f.state().records[0]).accountLast4, '4567');
    assert.equal(f.state().notifications.every(item => item.type === 'BOOSTER_PAYOUT_INFORMATION' && item.data.targetPath === `/provider/payout-information/${id}`), true);
});

test('concurrent and stale submissions cannot overwrite accepted data; failed CAS rolls back metadata and notifications', async () => {
    const f = fixture(); await f.request();
    const outcomes = await Promise.allSettled([f.submit(), f.submit({ ...us, accountNumber: '111122223333' })]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find(result => result.status === 'rejected').reason.status, 409);
    assert.equal(f.state().records[0].revision, 1);
    const before = structuredClone(f.state()); f.casFailure();
    await assert.rejects(f.submit(us, 1), error => error.status === 409);
    assert.deepEqual(f.state(), before);
});

test('KMS or audit failure cannot save a submission and schema unavailability has a safe actionable error', async () => {
    const f = fixture(); await f.request(); const before = structuredClone(f.state());
    f.vault.encrypt = async () => { throw Object.assign(new Error('Bank details are temporarily unavailable.'), { status: 503 }); };
    await assert.rejects(f.submit(), error => error.status === 503); assert.deepEqual(f.state(), before);
    f.vault.encrypt = async () => ({ encrypted: true });
    f.db.managementAuditLog.create = async () => { throw Object.assign(new Error('missing audit table'), { code: 'P2021' }); };
    await assert.rejects(f.submit(), error => error.status === 503 && /service update/.test(error.message)); assert.deepEqual(f.state(), before);
    f.db.payoutInformation.findFirst = async () => { throw Object.assign(new Error('missing'), { code: 'P2021' }); };
    assert.equal((await f.service.readiness(actor('admin'))).configured, false);
});

test('accuracy confirmation is required; arbitrary review notes and unsupported countries are not accepted', async () => {
    const f = fixture();
    await assert.rejects(f.service.request(actor('admin'), 'provider', { requestId: id, country: 'CA' }), error => error.status === 400);
    await f.request();
    await assert.rejects(f.service.submit(actor('provider'), id, { revision: 0, details: us, confirmed: false }), error => error.status === 400);
    await f.submit();
    await assert.rejects(f.service.review(actor('admin'), id, { revision: 1, decision: 'return', reason: 'Bank account 123456789' }), error => error.status === 400);
    assert.equal(f.state().records[0].status, 'SUBMITTED');
});
