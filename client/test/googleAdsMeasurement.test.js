import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createGoogleAdsMeasurement, servicePriceViewPath } from '../src/utils/googleAdsMeasurement.js';

const config = { tagId: 'AW-123456789', label: 'service-price-view' };
const services = [
    ['Rank Boost', 'league-of-legends/rank-boost'],
    ['Placement Boost', 'league-of-legends/placement-boost'],
    ['Win Boost', 'league-of-legends/win-boost'],
    ['Pro Duo', 'league-of-legends/pro-duo'],
    ['TFT Rank Boost', 'teamfight-tactics/rank-boost'],
    ['TFT Placement Boost', 'teamfight-tactics/placement-boost'],
    ['TFT Win Boost', 'teamfight-tactics/win-boost'],
].map(([title, route], index) => ({ pathname: `/order/${route}`, service: { id: `service-${index}`, title, active: true } }));
const store = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key), values };
};

function fixture({ storage = store(), configured = config, load = true } = {}) {
    const calls = [], scripts = [], timers = new Map(), handlers = {}, removedCookies = [];
    let timerId = 0;
    const win = { location: new URL('https://www.fastboost.gg/checkout/private-order?token=private&email=private%40example.com&gclid=click-123#private'),
        sessionStorage: store(), gtag: (...args) => calls.push(args),
        setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
        addEventListener: (name, callback) => { handlers[name] = callback; } };
    const doc = { referrer: 'https://example.com/path?private=secret',
        get cookie() { return '_gcl_aw=click-123; session=private'; }, set cookie(value) { removedCookies.push(value); },
        createElement: () => ({ dataset: {}, remove() {} }),
        head: { appendChild: script => { scripts.push(script); if (load) queueMicrotask(() => script.onload()); } } };
    const tracker = createGoogleAdsMeasurement({ win, doc, storage, config: configured });
    return { tracker, calls, scripts, timers, storage, handlers, win, removedCookies,
        events: () => calls.filter(call => call[0] === 'event'),
        allow: () => tracker.setConsent('granted'),
        visit: async (entry = services[0]) => { tracker.setPage(entry); return tracker.recordServiceView(entry); } };
}

test('only the seven actual service pages and verified legacy service links qualify', () => {
    for (const entry of services) {
        assert.equal(servicePriceViewPath(entry.pathname, entry.service), entry.pathname);
        assert.equal(servicePriceViewPath(`/order/${entry.service.id}`, entry.service), entry.pathname);
        assert.equal(servicePriceViewPath(entry.pathname, { ...entry.service, active: false }), null);
        assert.equal(servicePriceViewPath(entry.pathname, { ...entry.service, id: '' }), null);
    }
    for (const pathname of ['/', '/order/not-found', '/order/teamfight-tactics/pro-duo', '/order/league-of-legends/coaching',
        '/checkout/private-order', '/payment/success/service-0', '/account/orders', '/login', '/order/league-of-legends/rank-boost?email=private',
        '/order/league-of-legends/rank-boost#private', 'https://example.test/order/league-of-legends/rank-boost']) {
        assert.equal(servicePriceViewPath(pathname, services[0].service), null, pathname);
    }
    assert.equal(servicePriceViewPath(services[0].pathname, services[1].service), null, 'stale service data does not match a new route');
});

test('no consent or missing new label sends no requests or conversion events', async () => {
    for (const configured of [{}, { tagId: config.tagId }, { label: config.label }, { ...config, tagId: 'AW-invalid' }]) {
        const f = fixture({ configured }); f.tracker.start(); f.allow();
        assert.equal(await f.visit(), false);
        assert.equal(f.scripts.length, 0); assert.equal(f.events().length, 0);
    }
    const f = fixture(); f.tracker.start();
    assert.equal(await f.visit(), false);
    assert.equal(f.scripts.length, 0); assert.equal(f.calls.length, 0);
});

test('first explicit opt-in measures the rendered service page without purchase or private data', async () => {
    const f = fixture(); await f.visit(); f.allow(); await nextTurn();
    assert.equal(f.events().length, 1);
    assert.deepEqual(f.events()[0], ['event', 'conversion', {
        send_to: 'AW-123456789/service-price-view', page_location: `https://www.fastboost.gg${services[0].pathname}`,
        page_title: 'FastBoost service pricing',
    }]);
    const settings = f.calls.find(call => call[0] === 'set')[1];
    assert.equal(settings.page_location, 'https://www.fastboost.gg/?gclid=click-123');
    assert.equal(settings.page_referrer, 'https://example.com');
    assert.equal(settings.ads_data_redaction, true);
    assert.equal(settings.allow_ad_personalization_signals, false);
    assert.equal(f.calls.find(call => call[0] === 'config')[2].allow_enhanced_conversions, false);
    assert.equal(/private|transaction_id|currency|purchase/i.test(JSON.stringify(f.calls)), false);
    assert.deepEqual([...f.storage.values.keys()], ['fastboost:ad-measurement:v1']);
});

test('rerenders and StrictMode do not duplicate a view, but visiting another service or returning does', async () => {
    const f = fixture(); f.allow();
    const pending = [f.visit(), f.visit(), f.visit()];
    await Promise.all(pending);
    await f.visit({ ...services[0], search: '?price=50', hash: '#summary', key: 'query-change' });
    assert.equal(f.events().length, 1);
    await f.visit(services[1]);
    f.tracker.setPage({ pathname: '/account/orders' });
    await f.visit(services[0]);
    assert.equal(f.events().length, 3);
});

test('departure or becoming unavailable while Google loads cancels pending measurement', async () => {
    for (const depart of [true, false]) {
        const f = fixture({ load: false }); f.allow();
        const pending = f.visit();
        if (depart) f.tracker.setPage({ pathname: '/checkout/private-order' });
        else await f.tracker.recordServiceView({ ...services[0], service: null });
        f.scripts[0].onload();
        assert.equal(await pending, false); assert.equal(f.events().length, 0);
    }
});

test('first opt-in after leaving does not replay prior service visits', async () => {
    const f = fixture(); await f.visit();
    f.tracker.setPage({ pathname: '/' }); f.allow(); await nextTurn();
    assert.equal(f.events().length, 0);
    assert.equal(await f.visit(), true);
});

test('denied visits never replay on regrant and withdrawal clears ad cookies only', async () => {
    const f = fixture(); await f.visit();
    f.tracker.setConsent('denied'); f.allow(); await nextTurn();
    assert.equal(f.events().length, 0);
    assert.ok(f.removedCookies.length > 0);
    assert.ok(f.removedCookies.every(cookie => cookie.startsWith('_gcl_aw=')));
    await f.visit(services[1]); assert.equal(f.events().length, 1);
    f.tracker.setConsent('denied'); await f.visit(services[2]);
    f.allow(); await nextTurn(); assert.equal(f.events().length, 1);
    await f.visit(services[0]); assert.equal(f.events().length, 2);
});

test('withdrawal during script load blocks dispatch even if consent returns before load finishes', async () => {
    const f = fixture({ load: false }); f.allow(); const pending = f.visit();
    f.tracker.setConsent('denied'); f.allow(); f.scripts[0].onload();
    assert.equal(await pending, false); assert.equal(f.events().length, 0);
    await f.visit(services[1]); assert.equal(f.events().length, 1);
    assert.equal(f.scripts.length, 1);
});

test('failed script can retry before dispatch without generating duplicate events', async () => {
    const f = fixture({ load: false }); f.allow(); const pending = f.visit();
    f.scripts[0].onerror(); assert.equal(await pending, false);
    const retry = f.visit(); f.scripts[1].onload();
    assert.equal(await retry, true); assert.equal(await f.visit(), false);
    assert.equal(f.events().length, 1);
});

test('cross-tab withdrawal or clearing consent immediately blocks future events', async () => {
    const f = fixture(); f.tracker.start(); f.allow(); await f.visit();
    f.storage.removeItem('fastboost:ad-measurement:v1'); f.handlers.storage({ key: null });
    assert.equal(f.tracker.getConsent(), 'denied');
    await f.visit(services[1]); assert.equal(f.events().length, 1);
});

test('startup removes retired purchase identifiers without loading a disabled tag', () => {
    const f = fixture({ configured: {} });
    f.storage.setItem('fastboost:ads-purchases:v1', '{"private-order":1}');
    f.win.sessionStorage.setItem('fastboost:checkout-attempts:v1', '{"private-order":1}');
    f.tracker.start();
    assert.equal(f.storage.getItem('fastboost:ads-purchases:v1'), null);
    assert.equal(f.win.sessionStorage.getItem('fastboost:checkout-attempts:v1'), null);
    assert.equal(f.scripts.length, 0);
});
