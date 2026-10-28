import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { transformWithOxc } from 'vite';
import * as walletUtils from '../src/utils/wallet.js';

const offer = { id: 'usd-25', packageId: 'usd-25', currency: 'usd', amountCents: 2500,
    bonusPercent: 12, bonusCents: 300, creditCents: 2800 };
const checkout = { topUpId: 'wte_synthetic', sessionId: 'cs_test_topup', clientSecret: 'cs_test_topup_secret_synthetic',
    uiMode: 'elements', status: 'pending', summary: offer };
const snapshot = { currency: 'usd', balanceCents: 0, purchasedBalanceCents: 0, promotionalBalanceCents: 0,
    frozen: false, packages: [offer], transactions: [] };

function findElement(tree, predicate) {
    if (!tree || typeof tree !== 'object') return null;
    if (!Array.isArray(tree) && predicate(tree)) return tree;
    for (const child of Array.isArray(tree) ? tree : [tree.props?.children]) {
        const found = findElement(child, predicate);
        if (found) return found;
    }
    return null;
}

// Like browserSessionSecurity.test.js, execute the real component and its handlers
// with the installed JSX transformer and memory-only browser/payment substitutes.
// Dependency-aware hooks let the tests exercise close/reopen and reload recovery.
async function walletFixture({ prepare = async () => checkout, verify = async () => ({ ...snapshot, paid: false, status: 'pending' }),
    cancel = async () => ({ ...snapshot, cancelled: true, status: 'cancelled' }),
    query = '', saved = new Map(), walletSnapshot = snapshot, readWallet = async () => walletSnapshot } = {}) {
    const source = await readFile(new URL('../src/pages/WalletPage.jsx', import.meta.url), 'utf8');
    const transformed = await transformWithOxc(source.replace(/^import[\s\S]*?;\r?\n/gm, '')
        .replace(/import\.meta\.env\.DEV/g, 'false')
        .replace(/import\.meta\.env\.STRIPE_PUBLISHABLE_KEY/g, "'pk_test_synthetic'")
        .replace(/\bexport default\s+(?=function)/g, '').replace(/^export /gm, ''), 'WalletPage.jsx',
    { jsx: { runtime: 'automatic', development: false } });
    const hooks = [], scheduled = [], events = [], mutations = [], cancellations = [], reads = [], walletReads = [], listeners = new Map(), intervals = new Map();
    const documentState = { hidden: false };
    let nextTimer = 0;
    const setInterval = (callback, delay) => { const id = ++nextTimer; intervals.set(id, { callback, delay }); return id; };
    const clearInterval = id => intervals.delete(id);
    let cursor = 0, dirty = false, tree, params = new URLSearchParams(query), unmounted = false, lateStateUpdates = 0;
    const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), removeItem: key => saved.delete(key) };
    const element = (type, props) => ({ type, props });
    const memo = (compute, deps) => {
        const index = cursor++, old = hooks[index];
        if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps?.[i]))) hooks[index] = { value: compute(), deps };
        return hooks[index].value;
    };
    const effect = (callback, deps) => {
        const index = cursor++, old = hooks[index];
        if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps?.[i]))) {
            hooks[index] = { deps, cleanup: old?.cleanup };
            scheduled.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = callback(); });
        }
    };
    const setParams = update => { params = typeof update === 'function' ? update(params) : new URLSearchParams(update); dirty = true; };
    const context = {
        ...walletUtils, URLSearchParams, AbortController, DOMException, Event, setTimeout, clearTimeout, setInterval, clearInterval,
        _jsx: element, _jsxs: element, _Fragment: 'fragment',
        require: () => ({ jsx: element, jsxs: element, Fragment: 'fragment' }),
        useState(initial) {
            const index = cursor++;
            if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
            return [hooks[index].value, update => {
                if (unmounted) lateStateUpdates++;
                const value = typeof update === 'function' ? update(hooks[index].value) : update;
                if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; dirty = true; }
            }];
        },
        useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial }; },
        useEffect: effect, useLayoutEffect: effect, useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
        useSearchParams: () => [params, setParams], useNavigate: () => () => {},
        Link: 'link', LegalAgreement: 'agreement', Skeleton: 'skeleton', ArrowUpRightIcon: 'arrow-up-right-icon', WalletTopUpCheckout: 'wallet-topup-checkout', WalletActivity: 'wallet-activity', WalletTopUpResult: 'wallet-topup-result',
        sessionStorage: storage, localStorage: storage,
        getStoredUser: () => ({ id: 'synthetic-customer', email: 'customer@example.test' }),
        authStorage: { getItem: key => key === 'user' ? JSON.stringify({ id: 'synthetic-customer', email: 'customer@example.test' }) : 'synthetic-token' },
        loadStripe: () => Promise.resolve(null),
        document: documentState,
        window: {
            addEventListener: (name, callback) => listeners.set(name, callback),
            removeEventListener: name => listeners.delete(name),
            dispatchEvent: event => { events.push(event.type); listeners.get(event.type)?.(event); },
            setInterval, clearInterval,
            location: { assign: () => assert.fail('top-up preparation must open the wallet checkout page') },
        },
        getWallet: async options => { walletReads.push(options); return readWallet(options); },
        createWalletTopUp: async (...args) => { mutations.push(args); return prepare(...args); },
        cancelWalletTopUp: async id => { cancellations.push(id); return cancel(id); },
        verifyWalletTopUp: async args => { reads.push(args.sessionId); return verify(args); },
        pollWalletTopUp: options => walletUtils.pollWalletTopUp({ ...options, wait: async () => {} }),
    };
    const WalletPage = vm.runInNewContext(`${transformed.code.replace(/^import[^\n]*\n/gm, '')}\nWalletPage;`, context);
    const render = () => {
        assert.equal(unmounted, false);
        cursor = 0; dirty = false; tree = WalletPage();
        for (const run of scheduled.splice(0)) run();
        return tree;
    };
    const flush = async () => {
        for (let turns = 0; turns < 20; turns++) {
            await nextTurn();
            if (!dirty) return tree;
            render();
        }
        assert.fail('wallet component did not settle');
    };
    render(); await flush();
    return {
        mutations, cancellations, reads, walletReads, intervals, events, saved, render, flush,
        tree: () => tree, params: () => params,
        topUp: () => findElement(tree, node => node.props?.className === 'wallet-primary'),
        payment: () => findElement(tree, node => node.type === 'wallet-topup-checkout'),
        result: () => findElement(tree, node => node.type === 'wallet-topup-result'),
        navigateQuery(value) { params = new URLSearchParams(value); dirty = true; },
        focus() { listeners.get('focus')?.(new Event('focus')); },
        walletUpdated() { listeners.get('wallet:updated')?.(new Event('wallet:updated')); },
        hidden(value) { documentState.hidden = value; },
        tick() { for (const timer of [...intervals.values()]) timer.callback(); },
        balance: () => findElement(tree, node => node.props?.className === 'wallet-total')?.props.children,
        refreshing: () => findElement(tree, node => node.type === 'wallet-activity')?.props.loading,
        lateStateUpdates: () => lateStateUpdates,
        checkAgain: () => findElement(tree, node => node.type === 'button' && node.props?.children === 'Check payment again'),
        unmount() { for (const hook of hooks) hook?.cleanup?.(); unmounted = true; },
    };
}

async function cardFormFixture(confirm) {
    const source = await readFile(new URL('../src/components/CheckoutPaymentForm.jsx', import.meta.url), 'utf8');
    const transformed = await transformWithOxc(source.replace(/^import[\s\S]*?;\r?\n/gm, '')
        .replace(/import\.meta\.env\.DEV/g, 'false').replace(/\bexport default\s+(?=function)/g, '').replace(/^export /gm, ''),
    'CheckoutPaymentForm.jsx', { jsx: { runtime: 'automatic', development: false } });
    const failures = [], verifications = [], layouts = [];
    const session = { id: checkout.sessionId, confirm, total: { total: { amount: '$25.00' } } };
    const states = [{ sessionId: checkout.sessionId, state: { type: 'success', checkout: session }, currencySelectorStatus: 'not-needed' },
        true, false, '', false, 'Synthetic Customer', 'CA'];
    const refs = [checkout.sessionId, { stripe: { createPaymentMethod: async () => ({ paymentMethod: { id: 'synthetic-method' } }) }, number: {} },
        null, null, null, { validity: { valid: true } }, false].map(current => ({ current }));
    let stateCursor = 0, refCursor = 0;
    const element = (type, props) => ({ type, props });
    const CheckoutPaymentForm = vm.runInNewContext(`${transformed.code.replace(/^import[^\n]*\n/gm, '')}\nCheckoutPaymentForm;`, {
        _jsx: element, _jsxs: element, _Fragment: 'fragment',
        require: () => ({ jsx: element, jsxs: element, Fragment: 'fragment' }),
        useState: () => { const index = stateCursor++; return [states[index], value => { states[index] = value; }]; },
        useRef: () => refs[refCursor++], useEffect() {}, useLayoutEffect: callback => layouts.push(callback), useCallback: callback => callback,
        COUNTRIES: [], PaymentErrorDialog: 'payment-error', LegalAgreement: 'agreement', CheckoutSessionTransition: 'checkout-transition',
        paymentErrorMessage: () => 'Please review your payment.',
    });
    const tree = CheckoutPaymentForm({ email: 'customer@example.test', onEmailChange() {}, sessionId: checkout.sessionId,
        clientSecret: checkout.clientSecret, stripePromise: Promise.resolve(null),
        onDefinitiveFailure: id => failures.push(id), onSuccess: value => verifications.push(value) });
    for (const effect of layouts) effect();
    return { failures, verifications,
        submit: findElement(tree, node => node.type === 'checkout-transition').props.onConfirm };
}

test('opening the wallet payment page serializes double clicks without redirecting or granting credit', async () => {
    let release;
    const fixture = await walletFixture({ prepare: () => new Promise(resolve => { release = resolve; }) });
    const button = fixture.topUp();
    const first = button.props.onClick(), duplicate = button.props.onClick();
    await duplicate; await fixture.flush();
    assert.equal(fixture.mutations.length, 1);
    assert.equal(fixture.mutations[0][0], 'usd-25');
    assert.equal(fixture.mutations[0][1].uiMode, 'elements');
    assert.ok(fixture.payment(), 'payment page opens while Stripe checkout is being prepared');
    release(checkout); await first; await fixture.flush();
    assert.equal(fixture.payment().props.checkout.sessionId, checkout.sessionId);
    assert.equal(fixture.reads.length, 0, 'opening a popup does not start payment verification');
    assert.equal(fixture.events.includes('wallet:updated'), false);
});

test('confirmed cancellation discards the old checkout and reopening prepares a fresh session', async () => {
    let sequence = 0;
    const fixture = await walletFixture({ prepare: async () => {
        const sessionId = `cs_test_topup_${++sequence}`;
        return { ...checkout, sessionId, clientSecret: `${sessionId}_secret_synthetic` };
    } });
    await fixture.topUp().props.onClick(); await fixture.flush();
    const initial = fixture.payment().props.checkout;
    await fixture.payment().props.onClose(); await fixture.flush();
    assert.equal(fixture.payment(), null);
    assert.deepEqual(fixture.cancellations, [initial.sessionId]);
    assert.equal(fixture.result().props.status, 'cancelled');
    fixture.result().props.onClose(); await fixture.flush();
    await fixture.topUp().props.onClick(); await fixture.flush();
    assert.equal(fixture.mutations.length, 2);
    assert.notEqual(fixture.payment().props.checkout.sessionId, initial.sessionId);
    assert.equal(fixture.payment().props.offer.amountCents, 2500);
});

test('uncertain confirmation only verifies the original session and blocks another top-up while pending', async () => {
    const fixture = await walletFixture();
    await fixture.topUp().props.onClick(); await fixture.flush();
    const popup = fixture.payment();
    popup.props.onBeforeConfirm();
    assert.equal(fixture.reads.length, 0, 'saving recovery does not prematurely poll an unpaid form');
    popup.props.onSuccess({ session_id: checkout.sessionId }); await fixture.flush();
    assert.equal(fixture.params().get('wallet_session_id'), checkout.sessionId);
    assert.equal(fixture.params().get('top_up'), null, 'verification leaves the editable checkout page');
    assert.ok(fixture.reads.length > 0);
    assert.ok(fixture.reads.every(id => id === checkout.sessionId));
    await fixture.topUp().props.onClick(); await fixture.flush();
    assert.equal(fixture.mutations.length, 1);
    assert.equal(fixture.events.includes('wallet:updated'), false);
    const beforeRetry = fixture.reads.length;
    fixture.checkAgain().props.onClick(); await fixture.flush();
    assert.ok(fixture.reads.length > beforeRetry);
    assert.equal(fixture.mutations.length, 1, 'checking again is read-only');
});

test('leaving during top-up preparation ignores its late result without redirecting or verifying', async () => {
    let release;
    const fixture = await walletFixture({ prepare: () => new Promise(resolve => { release = resolve; }) });
    const opening = fixture.topUp().props.onClick();
    fixture.unmount();
    release(checkout); await opening; await nextTurn();
    assert.equal(fixture.mutations.length, 1);
    assert.equal(fixture.reads.length, 0);
    assert.equal(fixture.params().get('wallet_session_id'), null);
    assert.equal(fixture.events.includes('wallet:updated'), false);
});

test('the payment page cannot be left while confirmation is busy', async () => {
    const fixture = await walletFixture();
    await fixture.topUp().props.onClick(); await fixture.flush();
    fixture.payment().props.onBusyChange(true); await fixture.flush();
    fixture.payment().props.onClose(); await fixture.flush();
    assert.ok(fixture.payment());
    assert.equal(fixture.payment().props.busy, true);
    fixture.payment().props.onBusyChange(false); await fixture.flush();
    fixture.payment().props.onClose(); await fixture.flush();
    assert.equal(fixture.payment(), null);
    assert.equal(fixture.reads.length, 0);
});

test('reload after a redirect or lost confirmation response verifies the saved session without creating a top-up', async () => {
    const original = await walletFixture();
    await original.topUp().props.onClick(); await original.flush();
    original.payment().props.onBeforeConfirm();
    original.unmount();
    const restored = await walletFixture({ saved: original.saved,
        verify: async () => ({ ...snapshot, balanceCents: 2800, purchasedBalanceCents: 2500, promotionalBalanceCents: 300, paid: true, status: 'paid' }) });
    assert.deepEqual(restored.reads, [checkout.sessionId]);
    assert.equal(restored.mutations.length, 0);
    assert.equal(restored.payment(), null);
    assert.equal(restored.events.includes('wallet:updated'), true);
    assert.equal(restored.result().props.status, 'paid');
    assert.equal([...restored.saved.values()].includes(checkout.sessionId), false, 'verified completion clears only its saved recovery marker');
});

test('a definitive decline clears recovery so reloading can reopen the same unpaid checkout', async () => {
    const original = await walletFixture();
    await original.topUp().props.onClick(); await original.flush();
    original.payment().props.onBeforeConfirm();
    assert.ok([...original.saved.values()].includes(checkout.sessionId));
    original.payment().props.onDefinitiveFailure(checkout.sessionId);
    assert.equal([...original.saved.values()].includes(checkout.sessionId), false);
    original.unmount();
    const restored = await walletFixture({ saved: original.saved });
    assert.equal(restored.reads.length, 0, 'a rejected charge must not become a permanently pending confirmation on reload');
    await restored.topUp().props.onClick(); await restored.flush();
    assert.equal(restored.payment().props.checkout.sessionId, checkout.sessionId);
    assert.equal(restored.mutations.length, 1, 'the idempotent prepare API resumes the same saved unpaid intent');
    assert.equal(restored.events.includes('wallet:updated'), false);
});

test('an old decline cannot clear recovery belonging to a different payment session', async () => {
    const fixture = await walletFixture();
    await fixture.topUp().props.onClick(); await fixture.flush();
    fixture.payment().props.onBeforeConfirm();
    const key = [...fixture.saved.entries()].find(([, value]) => value === checkout.sessionId)[0];
    fixture.saved.set(key, 'cs_test_different');
    fixture.payment().props.onDefinitiveFailure(checkout.sessionId);
    assert.equal(fixture.saved.get(key), 'cs_test_different');
});

test('the shared card form distinguishes definitive rejection from an ambiguous confirmation outcome', async () => {
    for (const type of ['card_error', 'validation_error']) {
        const rejected = await cardFormFixture(async () => ({ type: 'error', error: { type, code: 'card_declined' } }));
        await rejected.submit();
        assert.deepEqual(rejected.failures, [checkout.sessionId]);
        assert.equal(rejected.verifications.length, 0);
    }
    const uncertain = await cardFormFixture(async () => { throw new TypeError('Connection lost after submitting confirmation'); });
    await uncertain.submit();
    assert.equal(uncertain.failures.length, 0, 'uncertain payment recovery must remain available');
    assert.equal(uncertain.verifications.length, 1);
    assert.equal(uncertain.verifications[0].session_id, checkout.sessionId);
});

test('reloading a top_up URL restores its package and resumes the server-owned checkout', async () => {
    const chosen = { id: 'usd-50', packageId: 'usd-50', currency: 'usd', amountCents: 5000,
        bonusPercent: 13, bonusCents: 650, creditCents: 5650 };
    const fixture = await walletFixture({ query: 'top_up=usd-50&returnTo=%2Fcheckout%2Forder-123',
        walletSnapshot: { ...snapshot, packages: [offer, chosen] },
        prepare: async () => ({ ...checkout, summary: chosen }) });
    assert.equal(fixture.mutations.length, 1);
    assert.equal(fixture.mutations[0][0], 'usd-50');
    assert.ok(fixture.payment());
    assert.equal(fixture.payment().props.offer.amountCents, 5000);
    assert.equal(fixture.payment().props.checkout.sessionId, checkout.sessionId);
    assert.equal(fixture.reads.length, 0, 'an editable restored checkout has not submitted payment');
    fixture.payment().props.onClose(); await fixture.flush();
    assert.equal(fixture.params().get('top_up'), null);
    assert.equal(fixture.params().get('returnTo'), '/checkout/order-123');
    assert.equal(fixture.payment(), null);
});

test('browser Back clears the payment page without another top-up request', async () => {
    const fixture = await walletFixture();
    await fixture.topUp().props.onClick(); await fixture.flush();
    assert.equal(fixture.params().get('top_up'), 'usd-25');
    assert.ok(fixture.payment());
    fixture.navigateQuery(''); await fixture.flush();
    assert.equal(fixture.payment(), null);
    assert.equal(fixture.mutations.length, 1);
    assert.equal(fixture.reads.length, 0);
    assert.deepEqual(fixture.cancellations, [checkout.sessionId]);
    assert.equal(fixture.result().props.status, 'cancelled');
});

test('browser Back during confirmation recovers and checks the same session before allowing another payment', async () => {
    const fixture = await walletFixture();
    await fixture.topUp().props.onClick(); await fixture.flush();
    const payment = fixture.payment();
    payment.props.onBeforeConfirm();
    payment.props.onBusyChange(true); await fixture.flush();
    fixture.navigateQuery(''); await fixture.flush();
    assert.equal(fixture.payment(), null);
    assert.ok(fixture.reads.length > 0);
    assert.ok(fixture.reads.every(id => id === checkout.sessionId));
    payment.props.onBusyChange(false); await fixture.flush();
    assert.equal(fixture.topUp().props.disabled, true);
    await fixture.topUp().props.onClick(); await fixture.flush();
    assert.equal(fixture.mutations.length, 1, 'an uncertain existing charge blocks creation of a second checkout');
    assert.equal(fixture.events.includes('wallet:updated'), false);
    assert.equal(fixture.cancellations.length, 0, 'Back during confirmation verifies instead of assuming the charge can be cancelled');
});

test('browser Forward cannot reopen editable card checkout while that session is awaiting verification', async () => {
    const fixture = await walletFixture();
    await fixture.topUp().props.onClick(); await fixture.flush();
    const payment = fixture.payment();
    payment.props.onBeforeConfirm();
    payment.props.onBusyChange(true); await fixture.flush();
    fixture.navigateQuery(''); await fixture.flush();
    payment.props.onBusyChange(false); await fixture.flush();
    fixture.navigateQuery('top_up=usd-25'); await fixture.flush();
    const reopened = fixture.payment();
    assert.ok(!reopened || !reopened.props.checkout || reopened.props.busy,
        'an unresolved confirmation must not expose an enabled form with the old secret');
    assert.equal(fixture.mutations.length, 1);
    assert.ok(fixture.reads.every(id => id === checkout.sessionId));
});

test('cancel result waits for verified expiration and repeated Back clicks send one cancellation', async () => {
    let release;
    const fixture = await walletFixture({ cancel: () => new Promise(resolve => { release = resolve; }) });
    await fixture.topUp().props.onClick(); await fixture.flush();
    const back = fixture.payment().props.onClose;
    const first = back(); await back(); await fixture.flush();
    assert.deepEqual(fixture.cancellations, [checkout.sessionId]);
    assert.equal(fixture.result(), null, 'an in-flight cancellation must not claim that payment was cancelled');
    release({ cancelled: true, status: 'cancelled' }); await first; await fixture.flush();
    assert.equal(fixture.result().props.status, 'cancelled');
    assert.equal(fixture.reads.length, 0);
    assert.equal(fixture.events.includes('wallet:updated'), false);
});

test('payment winning the cancellation race shows a verified paid result instead of a cancelled result', async () => {
    const paid = { ...snapshot, balanceCents: 2800, paid: true, status: 'paid' };
    const fixture = await walletFixture({ cancel: async () => ({ ...paid, cancelled: false }), verify: async () => paid });
    await fixture.topUp().props.onClick(); await fixture.flush();
    await fixture.payment().props.onClose(); await fixture.flush();
    assert.deepEqual(fixture.cancellations, [checkout.sessionId]);
    assert.deepEqual(fixture.reads, [checkout.sessionId]);
    assert.equal(fixture.result().props.status, 'paid');
    assert.equal(fixture.events.includes('wallet:updated'), true);
    assert.equal(fixture.mutations.length, 1);
});

test('a lost cancellation reply checks the same payment and never replays cancellation or claims success', async () => {
    const fixture = await walletFixture({ cancel: async () => { throw new TypeError('Cancellation response lost'); } });
    await fixture.topUp().props.onClick(); await fixture.flush();
    await fixture.payment().props.onClose(); await fixture.flush();
    assert.equal(fixture.result(), null);
    assert.deepEqual(fixture.cancellations, [checkout.sessionId]);
    assert.ok(fixture.reads.length > 0 && fixture.reads.every(id => id === checkout.sessionId));
    assert.equal(fixture.topUp().props.disabled, true);
    fixture.checkAgain().props.onClick(); await fixture.flush();
    assert.equal(fixture.cancellations.length, 1);
    assert.equal(fixture.mutations.length, 1);
    assert.equal(fixture.events.includes('wallet:updated'), false);
});

test('Back during preparation cancels its eventual session without reopening checkout', async () => {
    let release;
    const fixture = await walletFixture({ prepare: () => new Promise(resolve => { release = resolve; }) });
    const preparing = fixture.topUp().props.onClick(); await fixture.flush();
    fixture.navigateQuery(''); await fixture.flush();
    assert.equal(fixture.payment(), null);
    release(checkout); await preparing; await fixture.flush();
    assert.equal(fixture.payment(), null);
    assert.deepEqual(fixture.cancellations, [checkout.sessionId]);
    assert.equal(fixture.result().props.status, 'cancelled');
    assert.equal(fixture.mutations.length, 1);
    assert.equal(fixture.reads.length, 0);
});

test('a lost preparation reply cannot be called cancelled without confirmation from the server', async () => {
    const fixture = await walletFixture({ prepare: async () => { throw new TypeError('Top-up response lost after Stripe accepted it'); } });
    await fixture.topUp().props.onClick(); await fixture.flush();
    assert.ok(fixture.payment().props.error);
    await fixture.payment().props.onClose(); await fixture.flush();
    assert.ok(fixture.result()?.props.status !== 'cancelled' || fixture.cancellations.length > 0,
        'an unknown session may still be payable until the server confirms its expiration');
    assert.equal(fixture.events.includes('wallet:updated'), false);
});

test('Back recovers a lost preparation reply before asking the server to cancel that same intent', async () => {
    let starts = 0;
    const fixture = await walletFixture({ prepare: async () => {
        if (++starts === 1) throw new TypeError('First preparation response lost');
        return checkout;
    } });
    await fixture.topUp().props.onClick(); await fixture.flush();
    await fixture.payment().props.onClose(); await fixture.flush();
    assert.equal(fixture.mutations.length, 2);
    assert.ok(fixture.mutations.every(([packageId]) => packageId === offer.id), 'recovery never changes the requested package');
    assert.deepEqual(fixture.cancellations, [checkout.sessionId]);
    assert.equal(fixture.result().props.status, 'cancelled');
    assert.equal(fixture.reads.length, 0);
});

test('dismissing verified payment success stays dismissed through wallet refresh and rerenders', async () => {
    const fixture = await walletFixture({ verify: async () => ({ ...snapshot, balanceCents: 2800, paid: true, status: 'paid' }) });
    await fixture.topUp().props.onClick(); await fixture.flush();
    const payment = fixture.payment();
    payment.props.onBeforeConfirm();
    payment.props.onSuccess({ session_id: checkout.sessionId }); await fixture.flush();
    assert.equal(fixture.result().props.status, 'paid');
    fixture.result().props.onClose(); await fixture.flush();
    assert.equal(fixture.result(), null);
    fixture.focus(); await fixture.flush();
    fixture.render(); await fixture.flush();
    assert.equal(fixture.result(), null);
    assert.equal(fixture.params().get('wallet_session_id'), null);
    assert.equal(fixture.params().get('top_up'), null);
    assert.deepEqual(fixture.reads, [checkout.sessionId], 'refresh must not restart a settled top-up verification');
});

const heldSnapshot = { ...snapshot, balanceCents: 1000, availableBalanceCents: 600, reservedBalanceCents: 400 };
const releasedSnapshot = { ...heldSnapshot, availableBalanceCents: 1000, reservedBalanceCents: 0 };

test('quiet reserved-balance polling observes a committed departure release and stops without loading UI', async () => {
    let released = false;
    const fixture = await walletFixture({ readWallet: async () => released ? releasedSnapshot : heldSnapshot });
    assert.equal(fixture.balance(), '$6.00'); assert.equal(fixture.refreshing(), false);
    assert.equal([...fixture.intervals.values()][0].delay, 2000);
    released = true; fixture.tick(); await fixture.flush();
    assert.equal(fixture.balance(), '$10.00'); assert.equal(fixture.refreshing(), false);
    assert.equal(fixture.intervals.size, 0);
    const reads = fixture.walletReads.length; fixture.tick(); await fixture.flush(); assert.equal(fixture.walletReads.length, reads);
    fixture.unmount();
});

test('quiet polling skips hidden pages and never overlaps a pending balance request', async () => {
    let pending = false, respond;
    const fixture = await walletFixture({ readWallet: async () => pending ? new Promise(resolve => { respond = resolve; }) : heldSnapshot });
    const initialReads = fixture.walletReads.length;
    fixture.hidden(true); fixture.tick(); await fixture.flush(); assert.equal(fixture.walletReads.length, initialReads);
    fixture.hidden(false); pending = true; fixture.tick(); await fixture.flush();
    assert.equal(fixture.walletReads.length, initialReads + 1);
    assert.equal(fixture.refreshing(), false); assert.equal(fixture.balance(), '$6.00');
    fixture.tick(); fixture.tick(); await fixture.flush(); assert.equal(fixture.walletReads.length, initialReads + 1);
    respond(releasedSnapshot); await fixture.flush(); assert.equal(fixture.balance(), '$10.00');
    fixture.unmount();
});

test('confirmed wallet updates refresh quietly even when no reserved-balance interval is needed', async () => {
    let respond, pending = false;
    const fixture = await walletFixture({ readWallet: async () => pending ? new Promise(resolve => { respond = resolve; }) : releasedSnapshot });
    assert.equal(fixture.intervals.size, 0);
    pending = true; fixture.walletUpdated(); await fixture.flush();
    assert.equal(fixture.refreshing(), false); assert.equal(fixture.balance(), '$10.00');
    respond({ ...releasedSnapshot, balanceCents: 1500, availableBalanceCents: 1500 }); await fixture.flush();
    assert.equal(fixture.balance(), '$15.00'); assert.equal(fixture.refreshing(), false);
    fixture.unmount();
});

test('wallet events during a stale quiet read queue exactly one follow-up even when no reserved funds remain', async () => {
    let respond, pauseNext = false, changed = false;
    const fixture = await walletFixture({ readWallet: async () => {
        if (pauseNext) { pauseNext = false; return new Promise(resolve => { respond = resolve; }); }
        return changed ? { ...releasedSnapshot, balanceCents: 1500, availableBalanceCents: 1500 } : releasedSnapshot;
    } });
    assert.equal(fixture.intervals.size, 0);
    pauseNext = true; fixture.focus(); await fixture.flush();
    const reads = fixture.walletReads.length;
    changed = true; fixture.walletUpdated(); fixture.focus(); fixture.walletUpdated(); await fixture.flush();
    assert.equal(fixture.walletReads.length, reads, 'an event burst cannot overlap the pending GET');
    assert.equal(fixture.refreshing(), false); assert.equal(fixture.balance(), '$10.00');
    respond(releasedSnapshot); await fixture.flush();
    assert.equal(fixture.walletReads.length, reads + 1, 'the burst schedules one follow-up after the stale response');
    assert.equal(fixture.balance(), '$15.00'); assert.equal(fixture.refreshing(), false);
    assert.equal(fixture.intervals.size, 0);
    fixture.unmount();
});

test('unmount aborts quiet balance polling and ignores a late response', async () => {
    let respond, pending = false;
    const fixture = await walletFixture({ readWallet: async () => pending ? new Promise(resolve => { respond = resolve; }) : heldSnapshot });
    pending = true; fixture.tick(); await fixture.flush();
    const signal = fixture.walletReads.at(-1).signal;
    fixture.unmount(); assert.equal(signal.aborted, true); assert.equal(fixture.intervals.size, 0);
    respond(releasedSnapshot); await nextTurn();
    assert.equal(fixture.lateStateUpdates(), 0); assert.equal(fixture.balance(), '$6.00');
});

test('a late quiet snapshot cannot overwrite a newer verified top-up balance', async () => {
    let respond, pending = false, verified = false;
    const paidSnapshot = { ...snapshot, balanceCents: 2800, availableBalanceCents: 2800, reservedBalanceCents: 0, paid: true, status: 'paid' };
    const fixture = await walletFixture({
        readWallet: async () => {
            if (pending) { pending = false; return new Promise(resolve => { respond = resolve; }); }
            return verified ? paidSnapshot : heldSnapshot;
        },
        verify: async () => paidSnapshot,
    });
    pending = true; fixture.tick(); await fixture.flush();
    const signal = fixture.walletReads.at(-1).signal;
    verified = true; fixture.navigateQuery(`wallet_session_id=${checkout.sessionId}`); await fixture.flush();
    assert.equal(fixture.balance(), '$28.00'); assert.equal(fixture.result().props.status, 'paid');
    assert.equal(signal.aborted, true);
    respond(heldSnapshot); await fixture.flush();
    assert.equal(fixture.balance(), '$28.00'); assert.equal(fixture.intervals.size, 0);
    fixture.unmount();
});
