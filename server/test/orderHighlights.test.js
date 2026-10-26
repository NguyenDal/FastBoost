const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { existsSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { signSessionToken } = require('../src/utils/sessionToken');
const realStorage = require('../src/utils/orderHighlightStorage');

// The route accepts a database fixture; loading it must not initialize Prisma.
const dbPath = require.resolve('../src/prisma');
const previousDb = require.cache[dbPath];
require.cache[dbPath] = { exports: {} };
const { createOrderHighlightRouter } = require('../src/routes/orderHighlightRoutes');
if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'order-highlight-route-test-secret';
test.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });

const mp4 = Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);

function fixture() {
    const state = {
        users: [
            { id: 'customer', username: 'buyer', role: 'CUSTOMER', suspendedAt: null },
            { id: 'other', username: 'stranger', role: 'CUSTOMER', suspendedAt: null },
            { id: 'booster', username: 'skilledPlayer', role: 'PROVIDER', suspendedAt: null },
            { id: 'admin', username: 'manager', role: 'ADMIN', suspendedAt: null },
        ],
        order: { id: 'order', customerId: 'customer', status: 'IN_PROGRESS', paymentStatus: 'PAID' },
        assignments: [{ id: 'assignment', orderId: 'order', boosterId: 'booster' }],
        highlights: [], uploaded: [], removed: [], signed: [], tempPaths: [],
    };
    const db = {
        user: { findUnique: async ({ where }) => state.users.find(user => user.id === where.id) || null },
        order: { findUnique: async ({ where }) => where.id === state.order.id ? state.order : null },
        orderAssignment: { findFirst: async ({ where }) => state.assignments.find(row => row.orderId === where.orderId && row.boosterId === where.boosterId) || null },
        orderHighlight: {
            findMany: async ({ where }) => state.highlights.filter(row => row.orderId === where.orderId).sort((a, b) => b.createdAt - a.createdAt),
            findFirst: async ({ where }) => state.highlights.find(row => row.id === where.id && row.orderId === where.orderId) || null,
            create: async ({ data }) => {
                if (state.failCreate) throw new Error('database unavailable');
                const row = { ...data, id: `highlight-${state.highlights.length + 1}`, createdAt: new Date('2026-10-25T20:00:00Z') };
                state.highlights.push(row);
                return row;
            },
        },
        $queryRaw: async (parts, id) => { state.locks ||= []; state.locks.push([parts.join('?'), id]); return [{ id }]; },
        $transaction: async fn => fn(db),
    };
    const storage = {
        MAX_HIGHLIGHT_BYTES: realStorage.MAX_HIGHLIGHT_BYTES,
        validateHighlightFile: realStorage.validateHighlightFile,
        uploadHighlight: async ({ orderId, file, mimeType, extension }) => {
            assert.equal(orderId, 'order');
            state.tempPaths.push(file.path);
            if (state.failUpload) throw new Error('storage unavailable');
            if (state.afterUpload) await state.afterUpload();
            const key = `order-highlights/${orderId}/clip-${state.uploaded.length + 1}.${extension}`;
            state.uploaded.push({ key, mimeType, byteSize: file.size });
            return key;
        },
        removeHighlight: async key => { state.removed.push(key); },
        createHighlightViewUrl: async ({ key, mimeType }) => {
            state.signed.push({ key, mimeType });
            return `https://assets.example.invalid/${key}?signed=1`;
        },
    };
    return { state, db, storage };
}

async function serve(t, { maxBytes } = {}) {
    const f = fixture();
    if (maxBytes) f.storage.MAX_HIGHLIGHT_BYTES = maxBytes;
    const app = express();
    app.use('/api/orders', createOrderHighlightRouter(f.db, f.storage));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    f.request = async ({ actor = 'customer', method = 'GET', path = '/order/highlights', form, body } = {}) => {
        const user = f.state.users.find(item => item.id === actor);
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/orders${path}`, {
            method,
            headers: user ? { Authorization: `Bearer ${signSessionToken(user)}` } : {},
            body: form ?? body,
        });
        return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
    };
    return f;
}

function videoForm({ content = mp4, mimeType = 'video/mp4', filename = 'match.mp4', title = 'Ace at Baron' } = {}) {
    const form = new FormData();
    form.append('title', title);
    form.append('highlight', new Blob([content], { type: mimeType }), filename);
    return form;
}
const tempHighlightNames = () => readdirSync(tmpdir()).filter(name => name.startsWith('fastboost-highlight-')).sort();

test('only owner, current assigned booster, and admin can list or request playback', async t => {
    const { state, request } = await serve(t);
    state.highlights.push({ id: 'one', orderId: 'order', uploaderName: 'skilledPlayer', title: 'Pentakill',
        mimeType: 'video/mp4', byteSize: 1100, createdAt: new Date('2026-10-25T20:00:00Z'), s3Key: 'order-highlights/order/one.mp4' });
    assert.equal((await request({ actor: null })).status, 401);
    assert.equal((await request({ actor: 'other' })).status, 404);
    for (const [actor, canUpload] of [['customer', false], ['booster', true], ['admin', true]]) {
        const result = await request({ actor });
        assert.equal(result.status, 200);
        assert.equal(result.cache, 'private, no-store');
        assert.deepEqual(result.body, { ok: true, canUpload, highlights: [{ id: 'one', title: 'Pentakill', mimeType: 'video/mp4',
            byteSize: 1100, createdAt: '2026-10-25T20:00:00.000Z', uploader: { username: 'skilledPlayer' } }] });
        const view = await request({ actor, path: '/order/highlights/one/view-url' });
        assert.equal(view.status, 200);
        assert.match(view.body.url, /signed=1$/);
        assert.equal(view.cache, 'private, no-store');
    }
    assert.equal((await request({ actor: 'other', path: '/order/highlights/one/view-url' })).status, 404);
    assert.equal((await request({ path: '/order/highlights/missing/view-url' })).status, 404);
    assert.deepEqual(state.signed, Array(3).fill({ key: 'order-highlights/order/one.mp4', mimeType: 'video/mp4' }));
    state.assignments = [];
    assert.equal((await request({ actor: 'booster', path: '/order/highlights/one/view-url' })).status, 404);
    state.users.find(user => user.id === 'admin').suspendedAt = new Date();
    assert.equal((await request({ actor: 'admin', path: '/order/highlights/one/view-url' })).status, 401);
});

test('upload accepts MP4 and WebM with private metadata, and customers cannot upload', async t => {
    const { state, request } = await serve(t);
    assert.equal((await request({ actor: 'customer', method: 'POST', form: videoForm() })).status, 403);
    for (const [actor, form, expectedMime] of [
        ['booster', videoForm(), 'video/mp4'],
        ['admin', videoForm({ content: webm, mimeType: 'video/webm', filename: 'teamfight.webm', title: 'Teamfight' }), 'video/webm'],
    ]) {
        const result = await request({ actor, method: 'POST', form });
        assert.equal(result.status, 201, JSON.stringify(result.body));
        assert.equal(result.body.highlight.mimeType, expectedMime);
        assert.equal(result.body.highlight.uploader.username, actor === 'booster' ? 'skilledPlayer' : 'manager');
        assert.equal(Object.hasOwn(result.body.highlight, 's3Key'), false);
    }
    assert.equal(state.highlights.length, 2);
    assert.deepEqual(state.uploaded.map(row => row.mimeType), ['video/mp4', 'video/webm']);
    assert.equal(state.tempPaths.every(path => !existsSync(path)), true, 'temporary uploads are removed');
    assert.equal(state.locks.length, 4, 'each saved upload locks the order and actor before a fresh authorization check');
});

test('upload rejects spoofed media, missing title, and unpaid or cancelled orders', async t => {
    const { state, request } = await serve(t);
    const before = tempHighlightNames();
    const spoofed = await request({ actor: 'booster', method: 'POST', form: videoForm({ content: webm }) });
    assert.equal(spoofed.status, 400);
    assert.equal((await request({ actor: 'booster', method: 'POST', form: videoForm({ title: '   ' }) })).status, 400);
    assert.equal((await request({ actor: 'booster', method: 'POST', form: videoForm({ filename: 'match.mov' }) })).status, 400);
    assert.equal(state.uploaded.length, 0);
    state.order.paymentStatus = 'PENDING';
    assert.equal((await request({ actor: 'booster' })).body.canUpload, false);
    assert.equal((await request({ actor: 'booster', method: 'POST', form: videoForm() })).status, 403);
    state.order.paymentStatus = 'PAID'; state.order.status = 'CANCELLED';
    assert.equal((await request({ actor: 'admin' })).body.canUpload, false);
    assert.equal((await request({ actor: 'admin', method: 'POST', form: videoForm() })).status, 403);
    assert.deepEqual(tempHighlightNames(), before, 'invalid uploads leave no temporary files');
});

test('multipart body limit and per-account upload budget are enforced', async t => {
    const limited = await serve(t, { maxBytes: 12 });
    const before = tempHighlightNames();
    assert.equal((await limited.request({ actor: 'booster', method: 'POST', form: videoForm() })).status, 413);
    assert.deepEqual(tempHighlightNames(), before, 'Multer removes an oversized partial file');
    const { state, request } = await serve(t);
    for (let i = 0; i < 6; i++) {
        const result = await request({ actor: 'booster', method: 'POST', form: videoForm() });
        assert.equal(result.status, 201, JSON.stringify(result.body));
    }
    assert.equal((await request({ actor: 'booster', method: 'POST', form: videoForm() })).status, 429);
    assert.equal(state.highlights.length, 6);
    assert.deepEqual(tempHighlightNames(), before);
});

test('rechecks assignment after storage upload and removes uncommitted object', async t => {
    const { state, request } = await serve(t);
    state.afterUpload = () => { state.assignments = []; };
    const result = await request({ actor: 'booster', method: 'POST', form: videoForm() });
    assert.equal(result.status, 409);
    assert.equal(state.highlights.length, 0);
    assert.deepEqual(state.removed, [state.uploaded[0].key]);
    assert.equal(existsSync(state.tempPaths[0]), false);
});

test('database and storage failures leave no saved highlight or temporary file', async t => {
    const { state, request } = await serve(t);
    state.failCreate = true;
    assert.equal((await request({ actor: 'admin', method: 'POST', form: videoForm() })).status, 500);
    assert.deepEqual(state.removed, [state.uploaded[0].key]);
    assert.equal(state.highlights.length, 0);
    state.failCreate = false; state.failUpload = true;
    assert.equal((await request({ actor: 'admin', method: 'POST', form: videoForm() })).status, 500);
    assert.equal(state.removed.length, 1);
    assert.equal(state.tempPaths.every(path => !existsSync(path)), true);
});
