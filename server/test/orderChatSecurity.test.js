const test = require('node:test');
const assert = require('node:assert/strict');

function fixture(t) {
    const state = { messages: [], assigned: true, actor: { id: 'booster', role: 'PROVIDER', suspendedAt: null }, locks: [] };
    let tail = Promise.resolve();
    const db = {
        user: { findUnique: async () => state.actor },
        order: { findUnique: async () => ({ customerId: 'customer' }) },
        orderAssignment: { findFirst: async () => state.assigned ? { boosterId: 'booster' } : null },
        conversation: { findUnique: async () => ({ id: 'chat', orderId: 'order' }), update: async () => ({}) },
        conversationParticipant: { upsert: async () => ({}) },
        message: {
            count: async () => state.messages.length,
            create: async ({ data, include }) => {
                assert.equal(include.sender.select.email, undefined);
                assert.equal(include.sender.select.profile.select.birthday, undefined);
                const message = { id: `message-${state.messages.length}`, createdAt: new Date(), ...data };
                state.messages.push(message); return message;
            },
        },
        $queryRaw: async strings => { state.locks.push(strings.join('?')); return []; },
        $transaction: callback => { const result = tail.then(() => callback(db)); tail = result.catch(() => {}); return result; },
    };
    const files = ['../src/controllers/chatController', '../src/utils/orderChat'].map(require.resolve);
    const replacements = new Map([
        [require.resolve('../src/prisma'), db], [require.resolve('../src/utils/s3Upload'), {}],
        [require.resolve('../src/utils/chatNotifications'), { createChatMessageNotifications: async () => {} }],
    ]);
    const previous = new Map(files.map(path => [path, require.cache[path]]));
    for (const [path, exports] of replacements) { previous.set(path, require.cache[path]); require.cache[path] = { exports, loaded: true }; }
    files.forEach(path => { delete require.cache[path]; });
    const controller = require(files[0]);
    const helper = require(files[1]);
    t.after(() => { for (const [path, value] of previous) { if (value) require.cache[path] = value; else delete require.cache[path]; } });
    return { state, db, helper, async post(content) {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await controller.postMessage({ user: state.actor, params: { conversationId: 'chat' }, body: { content } }, res);
        return res;
    } };
}

test('match chat rejects malformed and oversized messages before database writes', async t => {
    const f = fixture(t);
    for (const content of [true, {}, [], '', ' ', 'a'.repeat(4001)]) assert.equal((await f.post(content)).code, 400);
    assert.equal(f.state.messages.length, 0);
    assert.equal((await f.post('valid message')).code, 201);
});

test('concurrent sends across match-chat transports share the same database budget', async t => {
    const f = fixture(t);
    const results = await Promise.all(Array.from({ length: 25 }, (_, index) => index % 2
        ? f.post('HTTP message').then(res => res.code)
        : f.helper.saveOrderChatMessage(f.db, { conversationId: 'chat', senderId: 'booster', content: 'Socket message' }).then(() => 201, error => error.status)));
    assert.equal(results.filter(code => code === 201).length, 20);
    assert.equal(results.filter(code => code === 429).length, 5);
    assert.equal(f.state.messages.length, 20);
    assert.match(f.state.locks[0], /User.*FOR UPDATE/);
    assert.match(f.state.locks[1], /Order.*FOR UPDATE/);
});

test('retained chat participation cannot restore suspended, revoked or removed booster access', async t => {
    const f = fixture(t);
    for (const change of [{ role: 'CUSTOMER' }, { suspendedAt: new Date() }]) {
        Object.assign(f.state.actor, { role: 'PROVIDER', suspendedAt: null }, change);
        assert.equal((await f.post('forbidden')).code, 403);
    }
    Object.assign(f.state.actor, { role: 'PROVIDER', suspendedAt: null });
    f.state.assigned = false;
    assert.equal((await f.post('forbidden')).code, 403);
    assert.equal(f.state.messages.length, 0);
});

test('send authorization is rechecked after locks instead of trusting an earlier HTTP check', async t => {
    const f = fixture(t);
    f.db.$queryRaw = async strings => {
        if (strings.join('?').includes('"Order"')) f.state.assigned = false;
        return [];
    };
    assert.equal((await f.post('removed during send')).code, 403);
    assert.equal(f.state.messages.length, 0);
});
