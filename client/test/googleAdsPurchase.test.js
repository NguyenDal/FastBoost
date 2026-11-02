import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleAdsPurchaseTracker } from '../src/utils/googleAdsPurchase.js';

const NOW = Date.parse('2026-11-02T01:00:00Z');
const config = { tagId: 'AW-123456789', label: 'purchase-test' };
const store = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
};
const paid = (id = 'order-one', value = 24.5, currency = 'USD') => ({ paid: true, orderId: id,
    purchaseConversion: { transaction_id: id, value, currency, paidAt: new Date(NOW).toISOString() } });
function fixture({ storage = store(), sessionStorage = store(), configured = config, processed = true, load = true } = {}) {
    const calls = [], scripts = [], timers = new Map(), handlers = {};
    let timerId = 0;
    const win = { location: new URL('https://www.fastboost.gg/checkout/order-one?token=private&email=private%40example.com&gclid=click-123'),
        gtag: (...args) => { calls.push(args); if (args[0] === 'event' && processed) queueMicrotask(args[2].event_callback); },
        setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
        addEventListener: (name, callback) => { handlers[name] = callback; } };
    const doc = { referrer: 'https://example.com/path?private=secret', cookie: '',
        createElement: () => ({ dataset: {}, remove() {} }),
        head: { appendChild: script => { scripts.push(script); if (load) queueMicrotask(() => script.onload()); } } };
    const tracker = createGoogleAdsPurchaseTracker({ win, doc, storage, sessionStorage, config: configured, now: () => NOW });
    return { tracker, calls, scripts, timers, storage, sessionStorage, handlers, win, doc,
        events: () => calls.filter(call => call[0] === 'event'), allow: () => tracker.setConsent('granted') };
}

test('absent configuration and absent consent do not load Google or send a conversion', async () => {
    const disabled = fixture({ configured: {} });
    disabled.tracker.start(); disabled.allow();
    assert.equal(disabled.tracker.enabled, false);
    assert.equal(await disabled.tracker.recordPurchase(paid(), { recentReturn: true }), false);
    assert.equal(disabled.scripts.length, 0);
    const f = fixture(); f.tracker.start();
    assert.equal(await f.tracker.recordPurchase(paid(), { recentReturn: true }), false);
    assert.equal(f.scripts.length, 0); assert.equal(f.events().length, 0);
    f.tracker.setConsent('denied'); f.allow();
    await Promise.resolve();
    assert.equal(f.events().length, 0, 'rejected pending results must be discarded');
});

test('server-confirmed purchase sends allowlisted value, currency and ID once after opt-in', async () => {
    const f = fixture(); f.allow(); f.tracker.beginCheckout('order-one');
    const response = { ...paid(), email: 'private@example.com', name: 'Private Name' };
    assert.equal(await f.tracker.recordPurchase(response), true);
    const event = f.events()[0][2];
    assert.deepEqual(Object.keys(event).sort(), ['currency', 'event_callback', 'send_to', 'transaction_id', 'value']);
    assert.equal(event.value, 24.5); assert.equal(event.currency, 'USD');
    assert.equal(event.transaction_id, 'order-one'); assert.equal(event.send_to, 'AW-123456789/purchase-test');
    assert.equal(await f.tracker.recordPurchase(response), false);
    assert.equal(f.events().length, 1);
});

test('reload deduplication preserves every distinct order, rather than one purchase per visitor', async () => {
    const first = fixture(); first.allow();
    await first.tracker.recordPurchase(paid(), { recentReturn: true });
    const reload = fixture({ storage: first.storage }); reload.tracker.start();
    assert.equal(await reload.tracker.recordPurchase(paid(), { recentReturn: true }), false);
    assert.equal(await reload.tracker.recordPurchase(paid('order-two'), { recentReturn: true }), true);
    assert.equal(reload.events().length, 1);
});

test('unpaid, missing payload, mismatched ID and cancelled responses never count', async () => {
    const f = fixture(); f.allow();
    for (const response of [{ ...paid(), paid: false }, { ...paid(), paid: 'true' }, { paid: true, orderId: 'order-one' },
        { ...paid(), orderId: 'different-order' }, { paid: false, status: 'CANCELLED' }]) {
        assert.equal(await f.tracker.recordPurchase(response, { recentReturn: true }), false);
    }
    assert.equal(f.events().length, 0);
});

test('paid receipt visits and old return URLs do not turn historic orders into purchases', async () => {
    const f = fixture(); f.allow();
    assert.equal(await f.tracker.recordPurchase(paid()), false, 'no checkout attempt or return');
    const old = paid(); old.purchaseConversion.paidAt = '2026-10-01T00:00:00Z';
    assert.equal(await f.tracker.recordPurchase(old, { recentReturn: true }), false);
    f.tracker.beginCheckout('order-one');
    assert.equal(await f.tracker.recordPurchase(old), false, 'a new attempt cannot manufacture a historic sale');
    const future = paid(); future.purchaseConversion.paidAt = '2026-12-01T00:00:00Z';
    assert.equal(await f.tracker.recordPurchase(future, { recentReturn: true }), false);
});

test('wallet/card settled value and zero cash Gold order retain backend accounting', async () => {
    const f = fixture(); f.allow();
    await f.tracker.recordPurchase(paid('split-order', 30, 'USD'), { recentReturn: true });
    await f.tracker.recordPurchase(paid('gold-order', 0, 'USD'), { recentReturn: true });
    await f.tracker.recordPurchase(paid('cad-order', 12.75, 'CAD'), { recentReturn: true });
    assert.deepEqual(f.events().map(event => [event[2].value, event[2].currency]), [[30, 'USD'], [0, 'USD'], [12.75, 'CAD']]);
});

test('malformed conversion amounts and IDs fail closed', async () => {
    const f = fixture(); f.allow();
    for (const override of [{ value: -1 }, { value: Infinity }, { value: '20' }, { value: 12.345 }, { currency: 'usd' },
        { currency: 'US Dollar' }, { transaction_id: 'user@example.com' }, { paidAt: 'invalid' }]) {
        const response = paid(); Object.assign(response.purchaseConversion, override);
        assert.equal(await f.tracker.recordPurchase(response, { recentReturn: true }), false);
    }
    assert.equal(f.events().length, 0);
});

test('blocked script is retryable and does not mark an event as sent', async () => {
    const f = fixture({ load: false }); f.allow();
    const first = f.tracker.recordPurchase(paid(), { recentReturn: true });
    f.scripts[0].onerror(); assert.equal(await first, false);
    const retry = f.tracker.recordPurchase(paid(), { recentReturn: true });
    f.scripts[1].onload(); assert.equal(await retry, true);
    assert.equal(f.events().length, 1);
});

test('silently blocked Google load times out and remains retryable', async () => {
    const f = fixture({ load: false }); f.allow();
    const first = f.tracker.recordPurchase(paid(), { recentReturn: true });
    [...f.timers.values()].forEach(callback => callback());
    assert.equal(await first, false);
    const retry = f.tracker.recordPurchase(paid(), { recentReturn: true });
    f.scripts.at(-1).onload();
    assert.equal(await retry, true);
});

test('pending dispatch is not persisted and a missing processing callback permits retry', async () => {
    const f = fixture({ processed: false }); f.allow();
    const first = f.tracker.recordPurchase(paid(), { recentReturn: true });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(await f.tracker.recordPurchase(paid(), { recentReturn: true }), false, 'same-tab in-flight guard');
    assert.equal(f.storage.values.has('fastboost:ads-purchases:v1'), false);
    [...f.timers.values()].forEach(callback => callback());
    assert.equal(await first, false);
    const retry = f.tracker.recordPurchase(paid(), { recentReturn: true });
    await Promise.resolve(); await Promise.resolve();
    f.events().at(-1)[2].event_callback();
    assert.equal(await retry, true);
});

test('Google configuration excludes private route, query and referrer data', () => {
    const f = fixture(); f.allow();
    const settings = f.calls.find(call => call[0] === 'set')[1];
    assert.equal(settings.page_location, 'https://www.fastboost.gg/?gclid=click-123');
    assert.equal(settings.page_referrer, 'https://example.com');
    assert.equal(settings.allow_ad_personalization_signals, false);
    assert.equal(f.calls.find(call => call[0] === 'config')[2].allow_enhanced_conversions, false);
});

test('revoking consent blocks purchases even while a script is loading', async () => {
    const f = fixture({ load: false }); f.allow();
    const pending = f.tracker.recordPurchase(paid(), { recentReturn: true });
    f.tracker.setConsent('denied'); f.scripts[0].onload();
    assert.equal(await pending, false); assert.equal(f.events().length, 0);
    assert.equal(await f.tracker.recordPurchase(paid('order-two'), { recentReturn: true }), false);
    f.allow();
    assert.equal(await f.tracker.recordPurchase(paid('order-two'), { recentReturn: true }), true,
        're-opt-in must reuse the loaded tag instead of caching revoked consent');
});

test('fresh checkout attempt survives reload and does not require a Stripe session for wallet or Gold', async () => {
    const f = fixture(); f.allow(); f.tracker.beginCheckout('order-one');
    const reload = fixture({ storage: f.storage, sessionStorage: f.sessionStorage });
    assert.equal(reload.tracker.hasCheckoutAttempt('order-one'), true);
    assert.equal(await reload.tracker.recordPurchase(paid()), true);
});
