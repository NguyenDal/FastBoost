const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { signSessionToken } = require('../src/utils/sessionToken');

// Native WebSocket speaks the minimal Socket.IO framing needed by this test.
// This exercises the real room adapter/fetchSockets/emit path without importing
// application startup, reading .env, or connecting any external services.
async function socketClient(url, token) {
    const ws = new WebSocket(url);
    const received = [];
    const pending = new Map();
    const waiting = [];
    let sequence = 0;
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    ws.addEventListener('error', readyReject);
    ws.addEventListener('message', event => {
        const packet = String(event.data);
        if (packet.startsWith('0')) ws.send('40' + JSON.stringify({ token }));
        else if (packet === '2') ws.send('3');
        else if (packet.startsWith('40')) readyResolve();
        else if (packet.startsWith('44')) readyReject(new Error(packet));
        else if (packet.startsWith('43')) {
            const match = /^43(\d+)(.*)$/.exec(packet);
            pending.get(Number(match[1]))?.(JSON.parse(match[2])[0]);
        } else if (packet.startsWith('42')) {
            const event = JSON.parse(packet.slice(2)); received.push(event);
            for (const waiter of waiting) if (waiter.name === event[0]) waiter.resolve(event);
        }
    });
    await ready;
    return { received, close: () => ws.close(), waitFor(name) {
        const existing = received.find(event => event[0] === name);
        return existing ? Promise.resolve(existing) : new Promise(resolve => waiting.push({ name, resolve }));
    }, event(name, data) {
        const id = ++sequence;
        return new Promise(resolve => { pending.set(id, resolve); ws.send('42' + id + JSON.stringify([name, data])); });
    } };
}

test('real Socket.IO rooms stop private delivery when an assigned booster is removed', { timeout: 10000 }, async t => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'offline-real-socket-regression-secret';
    t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
    let assigned = true;
    const users = new Map(['customer', 'booster'].map(id => [id, { id, role: id === 'booster' ? 'PROVIDER' : 'CUSTOMER', passwordHash: 'synthetic-hash', suspendedAt: null }]));
    const db = {
        user: { findUnique: async ({ where }) => users.get(where.id) },
        order: { findUnique: async () => ({ customerId: 'customer' }) },
        orderAssignment: { findFirst: async () => assigned ? { boosterId: 'booster' } : null },
        conversation: { upsert: async () => ({ id: 'chat', orderId: 'order' }), findUnique: async () => ({ id: 'chat', orderId: 'order' }), update: async () => ({}) },
        conversationParticipant: { upsert: async () => ({}) },
        message: { count: async () => 0, findMany: async () => [], create: async ({ data }) => ({ id: 'message', createdAt: new Date(), ...data }) },
        $queryRaw: async () => [], $transaction: callback => callback(db),
    };
    const paths = ['../src/socket', '../src/utils/orderChat', '../src/prisma', '../src/utils/chatNotifications'].map(require.resolve);
    const previous = new Map(paths.map(path => [path, require.cache[path]]));
    require.cache[paths[2]] = { exports: db, loaded: true };
    require.cache[paths[3]] = { exports: { createChatMessageNotifications: async () => {} }, loaded: true };
    delete require.cache[paths[0]]; delete require.cache[paths[1]];
    t.after(() => { for (const [path, value] of previous) { if (value) require.cache[path] = value; else delete require.cache[path]; } });
    const server = http.createServer();
    const io = require(paths[0]).initSocket(server);
    t.after(() => new Promise(resolve => io.close(resolve)));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `ws://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=websocket`;
    const booster = await socketClient(url, signSessionToken(users.get('booster')));
    const customer = await socketClient(url, signSessionToken(users.get('customer')));
    t.after(() => { booster.close(); customer.close(); });
    assert.equal((await booster.event('chat:join', { orderId: 'order' })).ok, true);
    assert.equal((await customer.event('chat:join', { orderId: 'order' })).ok, true);
    assert.equal((await customer.event('chat:message', { conversationId: 'chat', content: 'authorized delivery' })).ok, true);
    await booster.waitFor('chat:message');
    assert.equal(booster.received.filter(event => event[0] === 'chat:message').length, 1);
    assigned = false;
    assert.equal((await customer.event('chat:message', { conversationId: 'chat', content: 'private after removal' })).ok, true);
    assert.equal((await booster.event('chat:join', { orderId: 'order' })).ok, false);
    assert.equal(booster.received.filter(event => event[0] === 'chat:message').length, 1);
    const members = await io.in('conv:chat').fetchSockets();
    assert.equal(members.length, 1);
    assert.equal(members[0].user.userId, 'customer');
});
