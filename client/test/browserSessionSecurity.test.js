import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { transformWithOxc } from 'vite';
import { authStorage, storeAuthSession, replaceAuthToken } from '../src/utils/authStorage.js';
import { pollPaymentVerification } from '../src/utils/paymentVerification.js';

const storage = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
};
function browserStorage(t) {
    const previous = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
    globalThis.localStorage = storage(); globalThis.sessionStorage = storage();
    t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
        }
    });
}

// Execute the actual component handlers/effects with memory-only hooks and APIs.
// Vite's installed JSX transformer avoids adding a DOM or test dependency.
async function componentFixture(name, bindings, initialStates = [], directory = 'pages', settings = {}) {
    const source = await readFile(new URL(`../src/${directory}/${name}.jsx`, import.meta.url), 'utf8');
    const transformed = await transformWithOxc(source
        .replace(/^import[\s\S]*?;\r?\n/gm, '')
        .replace(/import\.meta\.env\.DEV/g, 'false')
        .replace(/import\.meta\.env\.STRIPE_PUBLISHABLE_KEY/g, "'pk_test_synthetic'")
        .replace(/\bexport default\s+(?=function)/g, '')
        .replace(/^export default \w+;?\s*$/gm, '')
        .replace(/^export /gm, ''), `${name}.jsx`, { jsx: { runtime: 'automatic', development: false } });
    const states = [...initialStates], effects = [], layouts = [], cleanups = [], refs = (settings.refs || []).map(current => ({ current }));
    let cursor = 0, refCursor = 0;
    const element = (type, props) => ({ type, props });
    const Component = vm.runInNewContext(`${transformed.code.replace(/^import[^\n]*\n/gm, '')}\n${settings.entry || name};`, {
        _jsx: element, _jsxs: element, _Fragment: 'fragment', URLSearchParams,
        require(module) {
            assert.equal(module, 'react/jsx-runtime');
            return { jsx: element, jsxs: element, Fragment: 'fragment' };
        },
        useState(initial) {
            const index = cursor++;
            if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
            return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
        },
        useMemo: compute => compute(), useCallback: callback => callback, useEffect: effect => effects.push(effect),
        useLayoutEffect: effect => layouts.push(effect),
        useRef(initial) { const index = refCursor++; return refs[index] ||= { current: initial }; },
        OrderPage: 'OrderPage', setTimeout() {}, window: { setTimeout() {}, clearTimeout() {} },
        ...bindings,
    });
    return {
        render(props = {}) {
            cursor = 0; refCursor = 0;
            const tree = Component(props);
            for (const effect of layouts.splice(0)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
            return tree;
        },
        state(index) { return states[index]; },
        unmount() { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); },
        runEffect(index) { return effects[index](); },
        async runEffects() { for (const effect of effects.splice(0)) effect(); await Promise.resolve(); },
    };
}
function findElement(tree, predicate) {
    if (!tree || typeof tree !== 'object') return null;
    if (!Array.isArray(tree) && predicate(tree)) return tree;
    const children = Array.isArray(tree) ? tree : [tree.props?.children];
    for (const child of children) { const found = findElement(child, predicate); if (found) return found; }
    return null;
}

test('password rotation preserves persistence and cannot restore or replace another session', t => {
    browserStorage(t);
    for (const rememberMe of [false, true]) {
        storeAuthSession('originating-token', { id: 'customer' }, rememberMe);
        assert.equal(replaceAuthToken('originating-token', 'replacement-token'), true);
        assert.equal((rememberMe ? localStorage : sessionStorage).getItem('token'), 'replacement-token');
        assert.equal((rememberMe ? sessionStorage : localStorage).getItem('token'), null);
        assert.equal(JSON.parse(authStorage.getItem('user')).id, 'customer');
        authStorage.removeItem('token');
        assert.equal(replaceAuthToken('originating-token', 'late-response'), false);
        assert.equal(authStorage.getItem('token'), null);
        storeAuthSession('different-account', { id: 'different' }, rememberMe);
        assert.equal(replaceAuthToken('originating-token', 'late-response'), false);
        assert.equal(authStorage.getItem('token'), 'different-account');
        assert.equal(replaceAuthToken('different-account', undefined), false);
    }
});

test('password recovery creates a tab session even when an older account was remembered', async t => {
    browserStorage(t);
    storeAuthSession('old-remembered-token', { id: 'old' }, true);
    const notifications = [], requests = [];
    const fixture = await componentFixture('ResetPasswordPage', {
        useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams('token=synthetic-reset')],
        API_BASE_URL: 'https://synthetic.invalid/api', storeAuthSession,
        notifyAuthChanged: detail => notifications.push(detail),
        fetch: async (url, options) => {
            requests.push({ url, body: JSON.parse(options.body) });
            return { ok: true, json: async () => ({ token: 'recovered-token', user: { id: 'recovered' } }) };
        },
    }, [{ password: 'StrongPassword!123', confirmPassword: 'StrongPassword!123' }]);
    const form = findElement(fixture.render(), node => node.type === 'form');
    await form.props.onSubmit({ preventDefault() {} });
    assert.equal(requests[0].body.token, 'synthetic-reset');
    assert.equal(localStorage.getItem('token'), null);
    assert.equal(localStorage.getItem('user'), null);
    assert.equal(sessionStorage.getItem('token'), 'recovered-token');
    assert.equal(JSON.parse(sessionStorage.getItem('user')).id, 'recovered');
    assert.equal(notifications[0].loggedIn, true);
});

test('password change stores its replacement token and ignores an account switch during the request', async t => {
    browserStorage(t);
    for (const switchAccount of [false, true]) {
        storeAuthSession('originating-token', { id: 'customer' }, true);
        const events = [];
        const fixture = await componentFixture('ChangePasswordPage', {
            useNavigate: () => () => {}, hasValidSession: () => true, authStorage, replaceAuthToken, Event,
            window: { dispatchEvent: event => events.push(event.type) },
            changeMyPassword: async () => {
                if (switchAccount) storeAuthSession('different-account', { id: 'different' }, false);
                return { token: 'replacement-token' };
            },
        }, [true, { currentPassword: 'OldPassword!123', newPassword: 'StrongPassword!123', confirmPassword: 'StrongPassword!123' }]);
        await findElement(fixture.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} });
        assert.equal(authStorage.getItem('token'), switchAccount ? 'different-account' : 'replacement-token');
        assert.deepEqual(events, switchAccount ? [] : ['auth:refreshed']);
    }
});

test('a forged cancellation URL cannot delete a checkout before the customer acts', async () => {
    const deletions = [], navigations = [];
    const fixture = await componentFixture('PaymentResultPage', {
        useLocation: () => ({ pathname: '/payment/cancelled/service-123', search: '?orderId=target-checkout' }),
        useNavigate: () => (...args) => navigations.push(args),
        deleteUnpaidCheckoutOrder: async id => { deletions.push(id); },
    });
    fixture.render({ type: 'cancelled' }); await fixture.runEffects();
    assert.deepEqual(deletions, [], 'URL navigation must be read-only');
    const button = findElement(fixture.render({ type: 'cancelled' }), node => node.props?.className === 'payment-result-primary');
    await button.props.onClick();
    assert.deepEqual(deletions, ['target-checkout']);
    assert.equal(navigations[0][0], '/order/service-123');
});

test('a refused checkout cancellation stays visible instead of starting a second order', async () => {
    const navigations = [];
    const fixture = await componentFixture('PaymentResultPage', {
        useLocation: () => ({ pathname: '/payment/cancelled/service-123', search: '?orderId=already-paid' }),
        useNavigate: () => (...args) => navigations.push(args),
        deleteUnpaidCheckoutOrder: async () => { throw new Error('Paid orders cannot be removed.'); },
    });
    fixture.render({ type: 'cancelled' }); await fixture.runEffects();
    await findElement(fixture.render({ type: 'cancelled' }), node => node.props?.className === 'payment-result-primary').props.onClick();
    assert.deepEqual(navigations, []);
    const message = findElement(fixture.render({ type: 'cancelled' }), node => node.props?.id === 'payment-result-description');
    assert.equal(message.props.children, 'Paid orders cannot be removed.');
});

test('checkout cleanup rejects URL path traversal before sending an authenticated request', async () => {
    const requests = [];
    const source = await readFile(new URL('../src/api/orders.js', import.meta.url), 'utf8');
    const removeCheckout = vm.runInNewContext(`${source.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')}\ndeleteUnpaidCheckoutOrder;`, {
        API_BASE_URL: 'https://synthetic.invalid/api', authStorage: { getItem: () => 'synthetic-token' },
        fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ ok: true }) }; },
    });
    for (const id of ['.', '..', '../../orders/other/provider-leave', 'order/extra', 'order\\extra', 'order?other=value', 'order#fragment', '%2e%2e', 'order\n', '', null, 'x'.repeat(129)]) {
        await assert.rejects(removeCheckout(id), /checkout link is invalid/);
    }
    assert.deepEqual(requests, []);
    await removeCheckout('order-_123');
    assert.equal(requests[0].url, 'https://synthetic.invalid/api/orders/unpaid-checkout/order-_123');
    assert.equal(requests[0].options.method, 'DELETE');
});

test('late navbar account checks cannot log out refreshed sessions or replace another account', async t => {
    browserStorage(t);
    for (const status of [401, 200]) {
        storeAuthSession('originating-token', { id: 'original', role: 'CUSTOMER' }, false);
        let respond;
        let cleared = 0;
        const response = new Promise(resolve => { respond = resolve; });
        const fixture = await componentFixture('Navbar', {
            authStorage, localStorage, hasValidSession: () => Boolean(authStorage.getItem('token')),
            getStoredUser: () => JSON.parse(authStorage.getItem('user') || 'null'),
            scheduleSessionExpiryCheck: () => null,
            clearExpiredSession: () => { cleared++; authStorage.removeItem('token'); },
            useLocation: () => ({ pathname: '/' }), useNavigate: () => () => {},
            window: { addEventListener() {}, removeEventListener() {}, clearTimeout() {} },
            document: {}, API_BASE_URL: 'https://synthetic.invalid/api',
            CleanIcon: 'img', Link: 'a', ActivityClearRow: 'div', BinIcon: 'span',
            fetch: async () => response,
        }, [], 'components');
        fixture.render();
        const cleanup = fixture.runEffect(0);
        storeAuthSession('different-token', { id: 'different', role: 'CUSTOMER' }, false);
        respond({ status, ok: status === 200, json: async () => ({ user: { id: 'original' } }) });
        await response; await Promise.resolve(); await Promise.resolve();
        assert.equal(cleared, 0);
        assert.equal(authStorage.getItem('token'), 'different-token');
        assert.equal(JSON.parse(authStorage.getItem('user')).id, 'different');
        cleanup();
    }
});

async function cardPaymentFixture(confirm, createPaymentMethod = async () => ({ paymentMethod: { id: 'synthetic-method' } })) {
    const verifications = [];
    const props = { email: 'customer@example.test', onEmailChange() {}, sessionId: 'synthetic-session', clientSecret: 'synthetic-secret', stripePromise: Promise.resolve(null), onSuccess: query => verifications.push(query), onBeforeConfirm: async () => {} };
    const checkout = { id: props.sessionId, confirm, total: { total: { amount: 'US$10.00' } } };
    const fixture = await componentFixture('CheckoutPaymentForm', {
        COUNTRIES: [], PaymentErrorDialog: 'payment-error', LegalAgreement: 'legal', CheckoutElementsProvider: 'stripe-provider',
        paymentErrorMessage: error => error?.code === 'card_declined' ? 'Your card was declined.' : 'Unable to complete payment.',
    }, [{ sessionId: props.sessionId, state: { type: 'success', checkout }, currencySelectorStatus: 'not-needed' }, true, false, '', false, 'Preview Customer', 'CA'], 'components', {
        refs: [props.sessionId, { stripe: { createPaymentMethod }, number: {} }, null, null, null, { validity: { valid: true } }, false],
    });
    const submit = findElement(fixture.render(props), node => node.type?.name === 'CheckoutSession').props.onConfirm;
    return { fixture, props, submit, verifications };
}

test('lost Stripe confirmation responses verify the existing session while definitive declines remain editable', async () => {
    const uncertain = await cardPaymentFixture(async () => { throw new TypeError('Wi-Fi disconnected after submission'); });
    await uncertain.submit();
    assert.equal(uncertain.verifications.length, 1);
    assert.equal(uncertain.verifications[0].session_id, 'synthetic-session');
    assert.equal(uncertain.fixture.state(3), '', 'an unknown charge outcome must not suggest paying again');
    const declined = await cardPaymentFixture(async () => ({ type: 'error', error: { type: 'card_error', code: 'card_declined' } }));
    await declined.submit();
    assert.equal(declined.verifications.length, 0);
    assert.equal(declined.fixture.state(3), 'Your card was declined.');
});

test('repeated card submission is serialized and a replaced session cannot confirm after card-method creation', async () => {
    let release, methods = 0, confirmations = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const current = await cardPaymentFixture(async () => { confirmations++; return { type: 'success' }; }, () => { methods++; return pending; });
    const first = current.submit();
    await current.submit();
    assert.equal(methods, 1);
    release({ paymentMethod: { id: 'synthetic-method' } }); await first;
    assert.equal(confirmations, 1);
    assert.equal(current.verifications.length, 1);

    let finishMethod;
    const retired = await cardPaymentFixture(async () => { confirmations++; return { type: 'success' }; }, () => new Promise(resolve => { finishMethod = resolve; }));
    const oldAttempt = retired.submit();
    retired.fixture.render({ ...retired.props, sessionId: 'replacement-session' });
    finishMethod({ paymentMethod: { id: 'retired-method' } }); await oldAttempt;
    assert.equal(confirmations, 1, 'the retired checkout was never submitted');
    assert.equal(retired.verifications.length, 0);
});

test('an outage during the service check never submits a charge, and unmounted confirmations cannot update another page', async () => {
    let confirmations = 0;
    const blocked = await cardPaymentFixture(async () => { confirmations++; return { type: 'success' }; });
    const tree = blocked.fixture.render({ ...blocked.props, onBeforeConfirm: async () => { throw new TypeError('Offline before submission'); } });
    await findElement(tree, node => node.type?.name === 'CheckoutSession').props.onConfirm();
    assert.equal(confirmations, 0); assert.equal(blocked.verifications.length, 0);
    let finish;
    const waiting = await cardPaymentFixture(() => new Promise(resolve => { finish = resolve; }));
    const attempt = waiting.submit(); await nextTurn();
    waiting.fixture.unmount(); finish({ type: 'success' }); await attempt;
    assert.equal(waiting.verifications.length, 0);
});

async function checkoutViewFixture(createCheckoutSession, initialStates = [], search = 'gold=100') {
    const fixture = await componentFixture('CheckoutPage', {
        loadStripe: () => Promise.resolve(null), useSearchParams: () => [new URLSearchParams(search), () => {}], useNavigate: () => () => {},
        checkoutPriceDisplay: () => null, createCheckoutSession, paymentErrorMessage: () => 'Payment request was rejected.',
        Navbar: 'navbar', CheckoutPaymentForm: 'payment-form', CheckoutSkeleton: 'skeleton', PaymentFormSkeleton: 'payment-skeleton',
        PaymentResultPage: 'verification', PaymentErrorDialog: 'payment-error', LiveSaleFooter: 'sale',
    }, initialStates, 'pages', { entry: 'OrderCheckout' });
    return fixture;
}

async function goldPaymentFixture(createCheckoutSession) {
    const fixture = await checkoutViewFixture(createCheckoutSession,
        [{ sessionId: 'synthetic-session', clientSecret: 'synthetic-secret', summary: { serviceId: 'synthetic-service', email: 'customer@example.test', priceSummary: { goldRedeemed: 0, totalCents: 1000 } } }, null, '', false, null, false, 0, false, false, null, 100, '', null, null]);
    const submit = findElement(fixture.render({ orderId: 'synthetic-order' }), node => node.type?.name === 'GoldConfirmation').props.onConfirm;
    return { fixture, submit };
}

test('lost Gold settlement response verifies the same order and explicit server rejections stay failures', async () => {
    const uncertain = await goldPaymentFixture(async () => { throw new TypeError('Response lost after Gold commit'); });
    await uncertain.submit();
    assert.equal(uncertain.fixture.state(4).orderId, 'synthetic-order');
    assert.equal(uncertain.fixture.state(4).gold, '1');
    assert.equal(uncertain.fixture.state(11), '');
    assert.equal(uncertain.fixture.state(0).summary.priceSummary, undefined, 'a lost Gold receipt cannot display the old cash quote as its paid receipt');
    const rejected = await goldPaymentFixture(async () => { throw Object.assign(new Error('Balance changed'), { status: 409 }); });
    await rejected.submit();
    assert.equal(rejected.fixture.state(4), null);
    assert.equal(rejected.fixture.state(11), 'Payment request was rejected.');
});

test('double-clicking Gold confirmation sends one request and a late response after unmount is ignored', async () => {
    let respond, writes = 0;
    const current = await goldPaymentFixture(() => { writes++; return new Promise(resolve => { respond = resolve; }); });
    const first = current.submit(); await current.submit();
    assert.equal(writes, 1);
    respond({ paidWithGoldOnly: true, orderId: 'synthetic-order' }); await first;
    assert.equal(current.fixture.state(4).orderId, 'synthetic-order');
    let late;
    const retired = await goldPaymentFixture(() => new Promise(resolve => { late = resolve; }));
    const attempt = retired.submit(); retired.fixture.unmount();
    late({ paidWithGoldOnly: true, orderId: 'synthetic-order' }); await attempt;
    assert.equal(retired.fixture.state(4), null);
});

test('reload after a power interruption restores the same paid order or verifies its completed Stripe session', async () => {
    for (const alreadyPaid of [true, false]) {
        const reads = [];
        const fixture = await checkoutViewFixture(async (orderId, gold) => {
            reads.push({ orderId, gold });
            return { ...(alreadyPaid ? { paid: true } : { completed: true, sessionId: 'existing-session' }), orderId,
                summary: { serviceId: 'synthetic-service', email: 'customer@example.test' } };
        });
        fixture.render({ orderId: 'existing-order' });
        await fixture.runEffects(); await nextTurn();
        assert.equal(reads.length, 1);
        assert.equal(reads[0].orderId, 'existing-order');
        assert.equal(fixture.state(3), alreadyPaid);
        if (!alreadyPaid) assert.equal(fixture.state(4).session_id, 'existing-session');
    }
});

test('Strict Mode remounting reuses an in-flight checkout request instead of creating another session', async () => {
    let respond, reads = 0;
    const response = new Promise(resolve => { respond = resolve; });
    const fixture = await checkoutViewFixture(() => { reads++; return response; });
    fixture.render({ orderId: 'existing-order' });
    const cleanup = fixture.runEffect(0); cleanup();
    fixture.runEffect(0);
    assert.equal(reads, 1);
    respond({ paid: true, orderId: 'existing-order', summary: { serviceId: 'synthetic-service' } });
    await response; await nextTurn();
    assert.equal(fixture.state(3), true);
});

test('payment result remains unconfirmed while offline and its retry only reads the same payment', async () => {
    const reads = []; let settled = false, confirmed = 0;
    const props = { type: 'success', verification: { session_id: 'existing-session', orderId: 'existing-order' }, onVerified: () => { confirmed++; } };
    const fixture = await componentFixture('PaymentResultPage', {
        useLocation: () => ({ pathname: '/checkout/existing-order', search: '' }), useNavigate: () => () => assert.fail('must not navigate to a new order'),
        deleteUnpaidCheckoutOrder: () => assert.fail('must not cancel an uncertain payment'),
        pollPaymentVerification: options => pollPaymentVerification({ ...options, wait: async () => {} }),
        verifyCheckoutSession: async query => {
            reads.push(query);
            if (!settled) throw new TypeError('Offline');
            return { paid: true, orderId: 'existing-order' };
        },
    });
    fixture.render(props); await fixture.runEffects(); await nextTurn();
    assert.equal(confirmed, 0);
    const tree = fixture.render(props);
    assert.equal(findElement(tree, node => node.props?.className === 'payment-result-primary').props.children, 'Check Payment Again');
    assert.match(findElement(tree, node => node.props?.id === 'payment-result-description').props.children, /couldn’t confirm/);
    settled = true;
    await findElement(tree, node => node.props?.className === 'payment-result-primary').props.onClick();
    await fixture.runEffects(); await nextTurn();
    assert.equal(confirmed, 1);
    assert.ok(reads.every(query => query.sessionId === 'existing-session' && query.orderId === 'existing-order'));
});

async function paymentApiFixture(fetch) {
    const timers = [];
    const source = await readFile(new URL('../src/api/orders.js', import.meta.url), 'utf8');
    const api = vm.runInNewContext(`${source.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')}\n({createCheckoutSession,verifyCheckoutSession});`, {
        API_BASE_URL: 'https://synthetic.invalid/api', authStorage: { getItem: () => 'synthetic-token' }, URLSearchParams,
        AbortController, DOMException, fetch,
        setTimeout(callback, delay) { const timer = { callback, delay, active: true }; timers.push(timer); return timer; },
        clearTimeout(timer) { timer.active = false; },
    });
    return { api, timers };
}

test('payment API deadlines abort stalled verification and the entire response body without retrying a mutation', async () => {
    let requests = 0;
    const pending = await paymentApiFixture((url, { signal }) => {
        requests++;
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const read = pending.api.verifyCheckoutSession({ orderId: 'existing-order' });
    assert.equal(pending.timers[0].delay, 15000);
    pending.timers[0].callback(); await assert.rejects(read, /timed out/);
    assert.equal(pending.timers[0].active, false);
    assert.equal(requests, 1);

    const body = await paymentApiFixture(async (url, { signal }) => ({ ok: true, status: 200,
        json: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    }));
    const mutation = body.api.createCheckoutSession('existing-order', 100, false, 'customer@example.test');
    await nextTurn();
    assert.equal(body.timers[0].delay, 20000);
    body.timers[0].callback(); await assert.rejects(mutation, /timed out/);
    assert.equal(body.timers[0].active, false);
});

test('caller cancellation reaches the payment fetch and clears its deadline/listener on failure or success', async () => {
    const listeners = new Set();
    const incoming = { aborted: false, reason: new DOMException('User cancelled', 'AbortError'),
        addEventListener(type, listener) { assert.equal(type, 'abort'); listeners.add(listener); },
        removeEventListener(type, listener) { assert.equal(type, 'abort'); listeners.delete(listener); },
    };
    let requests = 0;
    const pending = await paymentApiFixture((url, { signal }) => {
        requests++;
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const read = pending.api.verifyCheckoutSession({ orderId: 'existing-order', signal: incoming });
    assert.equal(listeners.size, 1);
    for (const listener of listeners) listener();
    await assert.rejects(read, /User cancelled/);
    assert.equal(listeners.size, 0); assert.equal(pending.timers[0].active, false);
    await assert.rejects(pending.api.createCheckoutSession('existing-order', 0, true, undefined, undefined, { signal: { ...incoming, aborted: true } }), /User cancelled/);
    assert.equal(requests, 1, 'an already-cancelled caller cannot start a request');
    const success = await paymentApiFixture(async () => ({ ok: true, json: async () => ({ ok: true, paid: false }) }));
    await success.api.verifyCheckoutSession({ orderId: 'existing-order', signal: incoming });
    assert.equal(listeners.size, 0); assert.equal(success.timers[0].active, false);
});

test('a timed-out Gold request enters same-order verification and never resends settlement automatically', async () => {
    let writes = 0;
    const payment = await paymentApiFixture((url, { signal }) => {
        writes++;
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const current = await goldPaymentFixture((...args) => payment.api.createCheckoutSession(...args));
    const attempt = current.submit();
    payment.timers[0].callback(); await attempt;
    assert.equal(writes, 1);
    assert.equal(current.fixture.state(4).orderId, 'synthetic-order');
    assert.equal(current.fixture.state(4).gold, '1');
});
