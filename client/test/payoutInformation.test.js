import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers';
import vm from 'node:vm';
import { transformWithOxc } from 'vite';
import { createPayoutRequest, PAYOUT_CORRECTIONS, PAYOUT_COUNTRIES, payoutPath, payoutStatus, payoutSubmission } from '../src/utils/payoutInformation.js';

const us = { country: 'US', legalName: ' Test Recipient ', accountNumber: '0012345678', routingNumber: '021000021', currency: 'USD' };
const vn = { country: 'VN', legalName: ' Nguyễn Văn Test ', accountNumber: '0012345678', bankName: 'Vietcombank', currency: 'VND' };
test('submission preserves leading zeros, uses the assigned country, and omits other-country fields', () => {
    assert.deepEqual(payoutSubmission({ ...us, bankName: 'unrelated' }, 'US'), { ...us, legalName: 'Test Recipient' });
    assert.deepEqual(payoutSubmission({ ...vn, routingNumber: '021000021' }, 'VN'), { ...vn, legalName: 'Nguyễn Văn Test' });
    assert.throws(() => payoutSubmission(us, 'CA'));
    assert.throws(() => payoutSubmission({ ...us, accountNumber: '123456789012345678' }, 'US'));
    assert.throws(() => payoutSubmission({ ...vn, bankName: '' }, 'VN'));
    assert.throws(() => payoutSubmission({ ...us, routingNumber: '123' }, 'US'));
    assert.throws(() => payoutSubmission({ ...vn, currency: '' }, 'VN'));
    assert.equal(payoutPath('id/another'), '/provider/payout-information/id%2Fanother');
});

test('private transport uses authorization and no-store, never returning data to a changed session', async () => {
    let token = 'first-session', respond, sent;
    const request = createPayoutRequest({ baseUrl: '/api', getToken: () => token,
        fetchImpl: (url, options) => { sent = { url, options }; return new Promise(resolve => { respond = resolve; }); } });
    const pending = request('/payout-information/id/details', {});
    assert.equal(sent.options.cache, 'no-store');
    assert.equal(sent.options.method, 'POST');
    assert.equal(sent.options.headers.Authorization, 'Bearer first-session');
    assert.equal(sent.url, '/api/operations/payout-information/id/details');
    token = 'another-account';
    respond({ ok: true, json: async () => ({ details: us }) });
    await assert.rejects(pending, error => error.name === 'AbortError');
    await assert.rejects(request('/payout-information/id/details', {}, { expectedToken: 'first-session' }), error => error.name === 'AbortError');
});

test('private transport refuses anonymous calls and preserves server conflict errors', async () => {
    const anonymous = createPayoutRequest({ baseUrl: '/api', getToken: () => null, fetchImpl: () => assert.fail('anonymous request must not be sent') });
    await assert.rejects(anonymous('/payout-information/id'), error => error.name === 'AbortError');
    const request = createPayoutRequest({ baseUrl: '/api', getToken: () => 'session',
        fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ message: 'This revision changed.' }) }) });
    await assert.rejects(request('/payout-information/id/review', { revision: 1, decision: 'verify' }), error => error.status === 409 && error.message === 'This revision changed.');
});

function events() {
    const listeners = new Map();
    return { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), emit: name => listeners.get(name)?.() };
}
async function fixture(name, bindings = {}, initialStates = [], file = '../src/pages/PayoutInformationPage.jsx') {
    const source = (await readFile(new URL(file, import.meta.url), 'utf8')).replace(/^import[^;]+;\r?\n/gm, '').replace(/export default function/g, 'function');
    const transformed = await transformWithOxc(source, `${name}.jsx`, { jsx: { runtime: 'automatic', development: false } });
    const states = [...initialStates], refs = [], effects = [], cleanup = [];
    let cursor = 0, refCursor = 0;
    const jsx = (type, props) => ({ type, props });
    const win = events();
    const component = vm.runInNewContext(`${transformed.code.replace(/^import[^\n]*\n/gm, '')}\n${name};`, {
        _jsx: jsx, _jsxs: jsx, _Fragment: 'fragment', AbortController,
        require: () => ({ jsx, jsxs: jsx, Fragment: 'fragment' }),
        useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
        useRef(initial) { return refs[refCursor++] ||= { current: initial }; },
        useEffect: effect => effects.push(effect), Link: 'Link', Navbar: 'Navbar', window: win, document: { ...events(), visibilityState: 'visible' },
        authStorage: { getItem: () => 'session' }, API_BASE_URL: '/api',
        createPayoutRequest: () => async () => ({}), PAYOUT_COUNTRIES, PAYOUT_CORRECTIONS, payoutStatus, payoutSubmission,
        formatLocalSignatureTime: value => value, crypto: { randomUUID: () => 'request-id' }, ...bindings,
    });
    return { render(props) { cursor = 0; refCursor = 0; return component(props); }, state: i => states[i], window: win,
        runEffects() { for (const effect of effects.splice(0)) { const dispose = effect(); if (dispose) cleanup.push(dispose); } },
        cleanup() { for (const dispose of cleanup.splice(0)) dispose(); } };
}
function find(tree, predicate) {
    if (!tree || typeof tree !== 'object') return null;
    if (!Array.isArray(tree) && predicate(tree)) return tree;
    for (const child of Array.isArray(tree) ? tree : [tree.props?.children]) { const result = find(child, predicate); if (result) return result; }
    return null;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const metadata = { ok: true, request: { id: 'request-id', boosterId: 'booster', country: 'US', status: 'SUBMITTED', revision: 2, accountLast4: '5678', currency: 'USD' }, own: false, canSubmit: false, canReview: true };

test('country-specific form only asks for the banking fields chosen by admin', async () => {
    for (const country of ['US', 'VN']) {
        const ui = await fixture('PayoutForm');
        const tree = ui.render({ country, busy: false, onSubmit() {} });
        assert.ok(find(tree, node => node.props?.name === 'legalName'));
        assert.ok(find(tree, node => node.props?.name === 'accountNumber'));
        assert.equal(Boolean(find(tree, node => node.props?.name === 'routingNumber')), country === 'US');
        assert.equal(Boolean(find(tree, node => node.props?.name === 'bankName')), country === 'VN');
        assert.equal(Boolean(find(tree, node => node.props?.name === 'currency')), country === 'VN');
        assert.equal(find(tree, node => node.props?.name === 'country'), null, 'recipient cannot change the assigned country');
        assert.equal(tree.props.autoComplete, 'off');
    }
});

test('admin cannot review unseen bank details and duplicate reveal clicks send one request', async () => {
    let resolveReveal, calls = 0;
    const ui = await fixture('PayoutWorkspace', { createPayoutRequest: () => async (path, body) => {
        if (body === undefined) return metadata;
        calls++;
        assert.match(path, /\/details$/);
        return new Promise(resolve => { resolveReveal = resolve; });
    } }, [metadata]);
    let tree = ui.render({ id: 'request-id' }); ui.runEffects(); await tick();
    assert.equal(find(tree, node => node.props?.children === 'Mark as verified'), null);
    const reveal = find(tree, node => node.props?.children === 'Show bank details');
    reveal.props.onClick(); reveal.props.onClick();
    assert.equal(calls, 1);
    resolveReveal({ ok: true, details: us, revision: 2 }); await tick();
    tree = ui.render({ id: 'request-id' });
    assert.ok(find(tree, node => node.props?.children === 'Mark as verified'));
    assert.equal(ui.state(3), us);
    ui.cleanup();
});

test('reveal responses after leaving the page or from a different revision never expose bank data', async () => {
    for (const leave of [false, true]) {
        let resolveReveal;
        const ui = await fixture('PayoutWorkspace', { createPayoutRequest: () => async (path, body) => body === undefined ? metadata : new Promise(resolve => { resolveReveal = resolve; }) }, [metadata]);
        const tree = ui.render({ id: 'request-id' }); ui.runEffects(); await tick();
        find(tree, node => node.props?.children === 'Show bank details').props.onClick();
        if (leave) ui.cleanup();
        resolveReveal({ ok: true, details: us, revision: leave ? 2 : 3 }); await tick();
        assert.equal(ui.state(3), null);
        ui.cleanup();
    }
});

test('a fresh access denial clears previously revealed bank details', async () => {
    const ui = await fixture('PayoutWorkspace', { createPayoutRequest: () => async (path, body) => {
        if (body === undefined) return metadata;
        if (path.endsWith('/details')) return { ok: true, details: us, revision: 2 };
        throw Object.assign(new Error('Access unavailable.'), { status: 403 });
    } }, [metadata]);
    let tree = ui.render({ id: 'request-id' }); ui.runEffects(); await tick();
    find(tree, node => node.props?.children === 'Show bank details').props.onClick(); await tick();
    tree = ui.render({ id: 'request-id' });
    find(tree, node => node.props?.children === 'Mark as verified').props.onClick(); await tick();
    assert.equal(ui.state(3), null);
    assert.equal(ui.state(0), null);
    assert.equal(ui.state(1), 'Access unavailable.');
    ui.cleanup();
});

test('successful review updates the single live status badge and conceals bank details', async () => {
    const ui = await fixture('PayoutWorkspace', { createPayoutRequest: () => async (path, body) => {
        if (body === undefined) return metadata;
        if (path.endsWith('/details')) return { ok: true, details: us, revision: 2 };
        return { ok: true, request: { ...metadata.request, status: 'VERIFIED', revision: 3 } };
    } }, [metadata]);
    let tree = ui.render({ id: 'request-id' }); ui.runEffects(); await tick();
    find(tree, node => node.props?.children === 'Show bank details').props.onClick(); await tick();
    tree = ui.render({ id: 'request-id' });
    find(tree, node => node.props?.children === 'Mark as verified').props.onClick(); await tick();
    tree = ui.render({ id: 'request-id' });
    const status = find(tree, node => node.props?.role === 'status');
    assert.equal(status.props.children, 'Verified by FastBoost');
    assert.equal(status.props['aria-live'], 'polite');
    assert.equal(find(tree, node => node.props?.className === 'payout-notice'), null);
    assert.equal(find(tree, node => node.props?.children === 'Mark as verified'), null);
    assert.equal(ui.state(3), null);
    ui.cleanup();
});

test('country correction follows server permission even for an admin’s own request', async () => {
    const own = { ...metadata, own: true, canSubmit: true, canReview: false, canChangeCountry: true,
        request: { ...metadata.request, status: 'REQUESTED' } };
    const ui = await fixture('PayoutWorkspace', {}, [own]);
    const tree = ui.render({ id: 'request-id' });
    assert.ok(find(tree, node => node.props?.children === 'Update country'));
    assert.equal(find(tree, node => node.props?.children === 'Mark as verified'), null);
});

test('payout requesting remains available when contract signing is not configured', async () => {
    const calls = [];
    const ui = await fixture('BoosterDocumentForm', { FormData: class { get(key) { return key === 'country' ? 'VN' : null; } }, operations: async (...args) => calls.push(args) }, ['PAYOUT_INFORMATION'], '../src/components/BoosterDocumentForm.jsx');
    const tree = ui.render({ boosterId: 'booster', configured: false, payoutConfigured: true, reload() {}, onError() {} });
    const button = find(tree, node => node.type === 'button');
    assert.equal(button.props.disabled, false);
    assert.equal(button.props.children, 'Request payout details');
    await tree.props.onSubmit({ preventDefault() {}, currentTarget: { reset() {} } });
    assert.equal(calls[0][0], '/boosters/booster/payout-information');
    assert.equal(calls[0][1].country, 'VN');
    assert.equal(Object.hasOwn(calls[0][1], 'startsAt'), false);
});
