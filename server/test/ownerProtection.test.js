const test = require('node:test');
const assert = require('node:assert/strict');
const prismaPath = require.resolve('../src/prisma');
const calls = [];
let target;
let race = false;
const db = {
    user: {
        findUnique: async () => target,
        update: async args => {
            calls.push(args);
            if (race) throw Object.assign(new Error('No editable record'), { code: 'P2025' });
            return { ...target, ...args.data };
        },
        findMany: async args => { calls.push(args); return []; },
        count: async () => 0,
    },
    notification: { create: async () => {} },
};
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: db };
const { adminUpdateUserRole, adminUpdateUserSuspension, adminListUsers } = require('../src/controllers/adminUserController');
const { ownerUpdateBoosterAccess } = require('../src/controllers/adminUserController');
const { canBoost } = require('../src/utils/boosterAccess');
function response() {
    return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
}
function request(body) { return { user: { id: 'another-admin' }, params: { userId: 'owner' }, body }; }
test('admins cannot demote, suspend or restore an owner, even with forged ownership fields', async () => {
    target = { id: 'owner', role: 'ADMIN', isOwner: true }; calls.length = 0;
    for (const [handler, body] of [
        [adminUpdateUserRole, { role: 'CUSTOMER', isOwner: false }],
        [adminUpdateUserRole, { role: 'ADMIN' }],
        [adminUpdateUserSuspension, { suspended: true, isOwner: false }],
        [adminUpdateUserSuspension, { suspended: false }],
    ]) {
        const res = response(); await handler(request(body), res);
        assert.equal(res.statusCode, 403);
    }
    assert.equal(calls.length, 0);
});
test('ordinary accounts stay editable; ownership cannot be granted by the role endpoint', async () => {
    target = { id: 'owner', role: 'CUSTOMER', isOwner: false }; calls.length = 0;
    for (const [handler, body] of [
        [adminUpdateUserRole, { role: 'ADMIN', isOwner: true }],
        [adminUpdateUserSuspension, { suspended: true }],
    ]) {
        const res = response(); await handler(request(body), res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls.at(-1).where, { id: 'owner', isOwner: false });
        assert.equal(calls.at(-1).data.isOwner, undefined);
    }
    const res = response(); await adminUpdateUserRole(request({ role: 'OWNER' }), res);
    assert.equal(res.statusCode, 400);
});
test('ownership acquired between read and write prevents mutation', async () => {
    target = { id: 'owner', role: 'ADMIN', isOwner: false }; race = true;
    try {
        for (const handler of [adminUpdateUserRole, adminUpdateUserSuspension]) {
            const res = response(); await handler(request({ role: 'CUSTOMER', suspended: true }), res);
            assert.equal(res.statusCode, 403);
        }
    } finally { race = false; }
});
test('owner filter and returned ownership flag distinguish owners from ordinary admins', async () => {
    calls.length = 0;
    await adminListUsers({ query: { role: 'OWNER' } }, response());
    assert.deepEqual(calls.at(-1).where, { isOwner: true });
    assert.equal(calls.at(-1).select.isOwner, true);
    await adminListUsers({ query: { role: 'ADMIN' } }, response());
    assert.deepEqual(calls.at(-1).where, { role: 'ADMIN', isOwner: false });
});

test('additional Booster access requires a current unsuspended owner, not a token claim', async () => {
    for (const account of [{ role: 'ADMIN', isOwner: false }, { role: 'CUSTOMER', isOwner: true }, { role: 'ADMIN', isOwner: true, suspendedAt: new Date() }]) {
        target = account; calls.length = 0;
        const req = request({ hasBoosterAccess: true }); req.user.isOwner = true;
        const res = response(); await ownerUpdateBoosterAccess(req, res);
        assert.equal(res.statusCode, 403); assert.equal(calls.length, 0);
    }
    target = { role: 'ADMIN', isOwner: true };
    for (const enabled of [true, false]) {
        const res = response(); await ownerUpdateBoosterAccess(request({ hasBoosterAccess: enabled, role: 'ADMIN', isOwner: true }), res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls.at(-1).data, { hasBoosterAccess: enabled });
    }
    const invalid = response(); await ownerUpdateBoosterAccess(request({ hasBoosterAccess: 'true' }), invalid);
    assert.equal(invalid.statusCode, 400);
});

test('Booster capability coexists with primary roles without granting admin access', () => {
    assert.equal(canBoost({ role: 'ADMIN', hasBoosterAccess: true }), true);
    assert.equal(canBoost({ role: 'ADMIN', hasBoosterAccess: false }), false);
    assert.equal(canBoost({ role: 'PROVIDER' }), true);
    assert.equal(canBoost({ role: 'CUSTOMER', hasBoosterAccess: true }), true);
    assert.equal(canBoost({ role: 'CUSTOMER' }), false);
    assert.equal(canBoost({ role: 'PROVIDER', hasBoosterAccess: true, suspendedAt: new Date() }), false);
});

test('signed-in account is pinned before pagination without duplicating it on later pages', async () => {
    const original = { ...db.user };
    const self = { id: 'self', role: 'ADMIN', isOwner: true };
    db.user.findUnique = async () => self;
    db.user.count = async ({ where }) => where.AND ? 1 : 12;
    const queries = [];
    db.user.findMany = async args => { queries.push(args); return [{ id: 'other' }]; };
    try {
        const page1 = response(); await adminListUsers({ user: { id: 'self' }, query: { page: 1, pageSize: 10 } }, page1);
        assert.equal(page1.body.items[0].id, 'self'); assert.equal(page1.body.canManageExtraRoles, true);
        assert.equal(queries[0].take, 9); assert.equal(queries[0].skip, 0);
        assert.deepEqual(queries[0].where.AND[1], { id: { not: 'self' } });
        const page2 = response(); await adminListUsers({ user: { id: 'self' }, query: { page: 2, pageSize: 10 } }, page2);
        assert.equal(page2.body.items.some(u => u.id === 'self'), false);
        assert.equal(queries[1].skip, 9); assert.equal(queries[1].take, 10);
    } finally { Object.assign(db.user, original); }
});
