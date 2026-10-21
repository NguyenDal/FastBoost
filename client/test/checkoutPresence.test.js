import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { checkoutPresenceController } from '../src/utils/checkoutPresence.js';

function fixture({ orderId = 'order', checkoutViewId = 'view', renew = async () => ({ ok: true }), leave = async () => ({ ok: true }) } = {}) {
    const listeners = new Map(), intervals = new Map(), deferred = [], beats = [], departures = [], lost = [], paid = [];
    let nextTimer = 0;
    const controller = checkoutPresenceController({ orderId, checkoutViewId,
        renew: (...args) => { beats.push(args); return renew(...args); }, leave: (...args) => { departures.push(args); return leave(...args); },
        onLost: failure => lost.push(failure), onPaid: result => paid.push(result), defer: callback => deferred.push(callback),
        events: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) },
        timers: { setInterval: (callback, delay) => { const id = ++nextTimer; intervals.set(id, { callback, delay }); return id; }, clearInterval: id => intervals.delete(id) },
    });
    return { controller, beats, departures, lost, paid, intervals,
        event(name, value = {}) { listeners.get(name)?.(value); }, flushLeave() { for (const callback of deferred.splice(0)) callback(); } };
}

test('presence starts after registration, renews every30seconds and real unmount leaves only its own view', async () => {
    const current = fixture(); const unmount = current.controller.mount(); await nextTurn();
    assert.equal(current.beats.length, 0, 'unregistered initial checkout cannot be mistaken for an expired hold');
    current.controller.setReady(true); await nextTurn();
    assert.equal(current.beats.length, 1); assert.equal([...current.intervals.values()][0].delay, 30000);
    [...current.intervals.values()][0].callback(); await nextTurn();
    assert.equal(current.beats.length, 2);
    unmount(); assert.equal(current.departures.length, 0);
    current.flushLeave();
    assert.deepEqual(current.departures, [['order', 'view', { paymentInProgress: false }]]);
    assert.equal(current.intervals.size, 0);
});

test('React Strict Mode cleanup is cancelled by immediate setup but actual departure still leaves once', async () => {
    const current = fixture(); current.controller.setReady(true);
    const first = current.controller.mount(); first();
    const second = current.controller.mount(); current.flushLeave();
    assert.deepEqual(current.departures, []);
    second(); current.flushLeave(); current.flushLeave();
    assert.deepEqual(current.departures, [['order', 'view', { paymentInProgress: false }]]);
    await nextTurn(); assert.deepEqual(current.lost, []);
});

test('pagehide sends prompt leave and protects 3DS while a confirmation heartbeat is awaiting its response', async () => {
    let respond;
    const current = fixture({ renew: () => new Promise(resolve => { respond = resolve; }) });
    current.controller.setReady(true); const unmount = current.controller.mount();
    const protecting = current.controller.protect(); await nextTurn();
    assert.equal(current.beats[0][2].paymentInProgress, false);
    current.event('pagehide');
    assert.deepEqual(current.departures, [['order', 'view', { paymentInProgress: true }]]);
    unmount(); current.flushLeave(); assert.equal(current.departures.length, 1);
    respond({ ok: true }); await assert.rejects(protecting, failure => failure.name === 'AbortError');
    assert.deepEqual(current.paid, []); assert.deepEqual(current.lost, []);
});

test('definitive decline clears protection but an ambiguous payment keeps a protected departure', async () => {
    for (const definitive of [false, true]) {
        const current = fixture(); current.controller.setReady(true); const unmount = current.controller.mount();
        assert.equal(await current.controller.protect(), true);
        if (definitive) await current.controller.clearProtection();
        current.event('pagehide'); unmount(); current.flushLeave();
        assert.equal(current.departures[0][2].paymentInProgress, !definitive);
        assert.equal(current.beats.at(-1)[2].paymentInProgress, !definitive);
    }
});

test('a lost definitive-failure acknowledgement preserves protection and never rejects over the original decline', async () => {
    const current = fixture({ renew: async (order, view, options) => {
        if (!options.paymentInProgress) throw new TypeError('Offline while clearing protection');
        return { ok: true };
    } });
    current.controller.setReady(true); current.controller.mount();
    await current.controller.protect(); await current.controller.clearProtection();
    current.event('pagehide');
    assert.equal(current.departures[0][2].paymentInProgress, true);
    assert.deepEqual(current.paid, []);
});

test('a lease lost while mounted requests a new view/quote and cannot confirm the stale session', async () => {
    for (const response of [{ ok: true, released: true }, 'WALLET_VIEW_CLOSED', 'WALLET_VIEW_EXPIRED', 'WALLET_VIEW_MISSING']) {
        const current = fixture({ renew: async () => {
            if (typeof response === 'string') throw Object.assign(new Error('View is no longer active'), { code: response, status: 409 });
            return response;
        } });
        current.controller.setReady(true); const unmount = current.controller.mount(); await nextTurn();
        assert.equal(current.lost.length, 1); assert.equal(current.intervals.size, 0);
        await assert.rejects(current.controller.protect());
        assert.equal(current.lost.length, 1); assert.deepEqual(current.paid, []);
        unmount(); current.flushLeave();
    }
});

test('BFCache restore asks for a fresh view instead of reviving a tombstoned identity', () => {
    const current = fixture(); current.controller.mount();
    current.event('pagehide'); current.event('pageshow', { persisted: true });
    assert.equal(current.departures.length, 1); assert.equal(current.lost[0].code, 'WALLET_VIEW_CLOSED');
});

test('reconnecting a previously departed effect asks for a fresh identity instead of renewing its tombstone', () => {
    const current = fixture(); const unmount = current.controller.mount(); unmount(); current.flushLeave();
    current.controller.mount();
    assert.equal(current.lost[0].code, 'WALLET_VIEW_CLOSED'); assert.equal(current.departures.length, 1);
});

test('a late heartbeat for another order cannot update the new checkout or leave its view', async () => {
    let respond;
    const old = fixture({ orderId: 'old-order', checkoutViewId: 'old-view', renew: () => new Promise(resolve => { respond = resolve; }) });
    old.controller.setReady(true); const unmount = old.controller.mount(); await nextTurn(); unmount(); old.flushLeave();
    const current = fixture({ orderId: 'new-order', checkoutViewId: 'new-view' }); current.controller.setReady(true); current.controller.mount(); await nextTurn();
    respond({ ok: true, paid: true, orderId: 'old-order' }); await nextTurn();
    assert.deepEqual(old.paid, []); assert.deepEqual(current.paid, []); assert.deepEqual(current.departures, []);
    assert.equal(old.departures[0][0], 'old-order'); assert.equal(old.departures[0][1], 'old-view');
});

test('a confirmed paid presence result verifies that order rather than reporting an expired view', async () => {
    const current = fixture({ renew: async () => ({ ok: true, paid: true, released: true, orderId: 'order' }) });
    current.controller.setReady(true); const unmount = current.controller.mount(); await nextTurn();
    assert.equal(current.paid.length, 1); assert.deepEqual(current.lost, []);
    current.controller.setReady(false); unmount(); current.flushLeave();
});

test('unload API carries authenticated view identity with keepalive and no deadline timer', async () => {
    const source = await readFile(new URL('../src/api/orders.js', import.meta.url), 'utf8');
    const requests = [];
    const leave = vm.runInNewContext(`${source.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')}\nleaveCheckoutPresence;`, {
        API_BASE_URL: 'https://synthetic.invalid/api', authStorage: { getItem: () => 'synthetic-token' },
        setTimeout: () => assert.fail('page departure cannot depend on a deadline timer'),
        fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ ok: true }) }; },
    });
    await leave('order', 'view', { paymentInProgress: true });
    assert.equal(requests[0].options.keepalive, true);
    assert.equal(requests[0].options.headers.Authorization, 'Bearer synthetic-token');
    assert.deepEqual(JSON.parse(requests[0].options.body), { orderId: 'order', checkoutViewId: 'view', paymentInProgress: true });
});

test('departure broadcasts a wallet refresh only after confirmed release or paid settlement', async () => {
    const source = await readFile(new URL('../src/api/orders.js', import.meta.url), 'utf8');
    for (const sample of [{ data: { ok: true, released: true }, events: 1 }, { data: { ok: true, paid: true, released: false }, events: 1 },
        { data: { ok: true, pending: true, released: false }, events: 0 }, { data: { ok: true, released: false }, events: 0 },
        { data: { ok: false, code: 'WALLET_VIEW_CLOSED' }, error: true, events: 0 }, { networkError: true, error: true, events: 0 }]) {
        const events = [];
        let resolve;
        const response = new Promise(done => { resolve = done; });
        const leave = vm.runInNewContext(`${source.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')}\nleaveCheckoutPresence;`, {
            API_BASE_URL: 'https://synthetic.invalid/api', authStorage: { getItem: () => 'synthetic-token' }, Event,
            window: { dispatchEvent: event => events.push(event.type) },
            fetch: async () => { await response; if (sample.networkError) throw new TypeError('Offline');
                return { ok: !sample.error, status: sample.error ? 409 : 200, json: async () => sample.data }; },
        });
        const request = leave('order', 'view');
        assert.equal(events.length, 0, 'sending departure is not proof that the balance was released');
        resolve();
        if (sample.error) await assert.rejects(request); else await request;
        assert.deepEqual(events, sample.events ? ['wallet:updated'] : []);
    }
});
