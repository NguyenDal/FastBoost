import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { transformWithOxc } from 'vite';
import { walletCardQuote, walletCheckoutAmounts, walletInputCents, walletQuoteMatches } from '../src/utils/walletCheckout.js';
import { walletMoney } from '../src/utils/wallet.js';
import { checkoutPresenceLost } from '../src/utils/checkoutPresence.js';
const checkoutPresence = { checkoutViewId: 'synthetic-view', protect: async () => true, clearProtection() {}, recover() {} };

const wallet = { currency: 'usd', balanceCents: 600, frozen: false };
const quote = (applied = 0, changes = {}) => ({ sessionId: `cs_wallet_${applied}`, clientSecret: `secret_${applied}`,
    summary: { serviceId: 'service', currency: 'usd', email: 'customer@example.test', goldRedeemed: 100,
        goldDiscountCents: 1000, totalCents: 1500 - applied, cardAmountCents: 1500 - applied, orderTotalCents: 1500,
        walletAppliedCents: applied, walletAvailableCents: 600,
        priceSummary: { currency: 'usd', subtotalCents: 2500, totalCents: 1500, goldDiscountCents: 1000,
            walletAppliedCents: applied, cardAmountCents: 1500 - applied }, ...changes } });

function find(tree, predicate) {
    if (!tree || typeof tree !== 'object') return null;
    if (!Array.isArray(tree) && predicate(tree)) return tree;
    for (const child of Array.isArray(tree) ? tree : [tree.props?.children]) {
        const found = find(child, predicate); if (found) return found;
    }
    return null;
}

// Execute the actual checkout handlers with the installed JSX transformer and
// memory-only APIs. No Stripe, wallet or order mutation reaches a real service.
async function fixture(file, entry, bindings = {}, initial = []) {
    const source = await readFile(new URL(`../src/${file}.jsx`, import.meta.url), 'utf8');
    const transformed = await transformWithOxc(source.replace(/^import[\s\S]*?;\r?\n/gm, '')
        .replace(/import\.meta\.env\.STRIPE_PUBLISHABLE_KEY/g, "'pk_test_synthetic'")
        .replace(/\bexport default\s+(?=function)/g, '').replace(/^export /gm, ''), `${entry}.jsx`,
    { jsx: { runtime: 'automatic', development: false } });
    const states = [...initial], refs = [], effects = [], cleanups = [];
    let cursor = 0, refCursor = 0, tree;
    const element = (type, props) => ({ type, props });
    const Component = vm.runInNewContext(`${transformed.code.replace(/^import[^\n]*\n/gm, '')}\n${entry};`, {
        _jsx: element, _jsxs: element, _Fragment: 'fragment', URLSearchParams, AbortController, DOMException, Event,
        require: () => ({ jsx: element, jsxs: element, Fragment: 'fragment' }),
        useState(value) { const index = cursor++; if (!(index in states)) states[index] = typeof value === 'function' ? value() : value;
            return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
        useRef(value) { return refs[refCursor++] ||= { current: value }; }, useCallback: callback => callback,
        useEffect: callback => effects.push(callback), useLayoutEffect: callback => { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); },
        loadStripe: () => Promise.resolve(null), walletMoney, walletInputCents, walletCheckoutAmounts, walletQuoteMatches, walletCardQuote,
        checkoutPresenceLost, useCheckoutPresence: () => checkoutPresence,
        Link: 'link', Skeleton: 'skeleton', ...bindings,
    });
    return { render(props) { cursor = refCursor = 0; tree = Component(props); return tree; }, tree: () => tree,
        state: index => states[index], effect(text) { const effect = effects.find(callback => callback.toString().includes(text)); assert.ok(effect); return effect(); },
        unmount() { for (const cleanup of cleanups) cleanup(); } };
}

async function orderFixture(createCheckoutSession, { data = quote(), search = 'gold=100', displaySession = null, overrides = {} } = {}) {
    const requests = [], events = [];
    let params = new URLSearchParams(search);
    const states = [data, displaySession, '', false, null, false, 0, false, wallet, false, false, null, '', 0, false, null, null, '', null, null];
    const current = await fixture('pages/CheckoutPage', 'OrderCheckout', {
        useSearchParams: () => [params, update => { params = typeof update === 'function' ? update(params) : update; }],
        useNavigate: () => () => {}, checkoutPriceDisplay: () => null,
        Navbar: 'navbar', CheckoutPaymentForm: 'card', CheckoutSkeleton: 'skeleton', PaymentFormSkeleton: 'payment-skeleton',
        WalletCheckoutOption: 'wallet-option', CheckoutIcon: 'icon', PaymentResultPage: 'verification', PaymentErrorDialog: 'payment-error', LiveSaleFooter: 'sale',
        document: { hidden: false }, window: { addEventListener() {}, removeEventListener() {}, dispatchEvent: event => events.push(event.type), scrollTo() {} },
        getWallet: async () => wallet, paymentErrorMessage: () => 'Payment was rejected.',
        createCheckoutSession: (...args) => { requests.push(args); return createCheckoutSession(...args); }, ...overrides,
    }, states);
    const render = () => current.render({ orderId: 'order' }); render();
    return { ...current, render, requests, events, params: () => params,
        option: () => find(current.tree(), node => node.type === 'card')?.props.walletContent || find(current.tree(), node => node.type === 'wallet-option'),
        summary: () => find(current.tree(), node => node.type?.name === 'OrderSummary'),
        card: () => find(current.tree(), node => node.type === 'card') };
}

test('wallet amounts accept cents precisely and support a partial balance without inventing a larger balance', () => {
    assert.equal(walletInputCents('12.34'), 1234);
    assert.equal(walletInputCents('0'), 0);
    assert.equal(walletInputCents('1.'), 100);
    for (const input of ['-1', '1.001', '1e2', '', 'Infinity', '9007199254740992']) assert.equal(walletInputCents(input), null);
    assert.deepEqual(walletCheckoutAmounts(wallet, quote(400).summary), { applied: 400, available: 600, unreservedAvailable: 200, order: 1500, maximum: 600, full: false, usable: true });
    assert.equal(walletCheckoutAmounts({ ...wallet, frozen: true }, quote().summary).usable, false);
    assert.equal(walletCheckoutAmounts(wallet, { ...quote().summary, currency: 'eur' }).maximum, 0);
    assert.equal(walletCheckoutAmounts({ ...wallet, availableBalanceCents: 200 }, { currency: 'usd', totalCents: 1500 }).maximum, 200);
    assert.equal(walletCheckoutAmounts({ ...wallet, availableBalanceCents: 200 }, quote().summary).maximum, 600, 'the current quote includes its own reserved funds');
});

test('confirmed wallet holds reduce the header immediately and removal restores it without reducing Max', async () => {
    const current = await fixture('components/WalletCheckoutOption', 'WalletCheckoutOption');
    const props = { wallet, orderId: 'order', loading: false, busy: false };
    let tree = current.render({ ...props, summary: quote(400).summary });
    assert.equal(find(tree, node => node.props?.className === 'checkout-wallet-available').props.children, `${walletMoney(200)} available`);
    assert.equal(find(tree, node => node.props?.className === 'checkout-wallet-held'), null);
    find(tree, node => node.type === 'button' && node.props.children === 'Max').props.onClick();
    tree = current.render({ ...props, summary: quote(400).summary });
    assert.equal(find(tree, node => node.type === 'input').props.value, '6.00');
    tree = current.render({ ...props, summary: quote(400).summary, applying: true });
    assert.equal(find(tree, node => node.props?.role === 'status'), null);
    const applying = find(tree, node => node.type === 'button' && node.props.type === 'submit');
    assert.equal(applying.props['aria-busy'], true);
    assert.equal(applying.props['aria-label'], 'Applying wallet balance');
    assert.ok(find(applying, node => node.type === 'svg'));
    assert.equal(find(tree, node => node.props?.className === 'checkout-wallet-available').props.children, `${walletMoney(200)} available`, 'a pending request does not invent a new debit');
    tree = current.render({ ...props, summary: quote(0).summary });
    assert.equal(find(tree, node => node.props?.className === 'checkout-wallet-available').props.children, `${walletMoney(600)} available`);
    assert.equal(find(tree, node => node.props?.className === 'checkout-wallet-held'), null);
    const fallback = walletCheckoutAmounts({ ...wallet, availableBalanceCents: 200 }, { ...quote(400).summary, walletAvailableCents: undefined });
    assert.equal(fallback.unreservedAvailable, 200, 'a wallet snapshot has already excluded the hold');
    assert.equal(fallback.available, 600, 'the checkout may edit its own reserved amount');
});

test('Max only fills the selector; Apply requests the chosen amount and invalid values cannot apply', async () => {
    const applied = [];
    const props = { wallet, summary: quote().summary, orderId: 'order', loading: false, busy: false, onApply: value => applied.push(value) };
    const current = await fixture('components/WalletCheckoutOption', 'WalletCheckoutOption');
    let tree = current.render(props);
    find(tree, node => node.type === 'button' && node.props.children === 'Max').props.onClick();
    assert.deepEqual(applied, []);
    tree = current.render(props);
    assert.equal(find(tree, node => node.type === 'input').props.value, '6.00');
    find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.deepEqual(applied, [600]);
    find(tree, node => node.type === 'input').props.onChange({ target: { value: '6.01' } });
    tree = current.render(props);
    assert.equal(find(tree, node => node.type === 'button' && node.props.type === 'submit').props.disabled, true);
    find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.deepEqual(applied, [600]);
    assert.ok(find(tree, node => node.type === 'svg'));
});

test('partial Apply serializes quote changes and displays only the server returned wallet amount', async () => {
    let respond;
    const current = await orderFixture(() => new Promise(resolve => { respond = resolve; }));
    const apply = current.option().props.onApply;
    const first = apply(600); apply(600);
    assert.equal(current.requests.length, 1);
    assert.equal(current.requests[0][1], 100);
    assert.equal(current.requests[0][5].walletToUseCents, 600);
    current.render(); assert.equal(current.card().props.updatingPrice, true);
    respond(quote(550)); await first;
    current.render();
    assert.equal(current.option().props.summary.walletAppliedCents, 550);
    assert.equal(current.params().get('wallet'), '550');
    assert.equal(current.card().props.allowAdaptivePricing, false);
    assert.equal(current.state(3), false); assert.equal(current.state(4), null);
});

test('wallet input leaves Stripe’s minimum card amount while allowing full-wallet Max', async () => {
    const applied = [], fullSelections = [];
    const props = { wallet: { ...wallet, balanceCents: 1500 }, summary: quote(0, { walletAvailableCents: 1500 }).summary,
        orderId: 'order', loading: false, busy: false, onApply: value => applied.push(value), onMax: value => fullSelections.push(value) };
    const current = await fixture('components/WalletCheckoutOption', 'WalletCheckoutOption');
    let tree = current.render(props);
    find(tree, node => node.type === 'input').props.onChange({ target: { value: '14.51' } });
    tree = current.render(props);
    assert.match(find(tree, node => node.props?.id === 'checkout-wallet-error').props.children, /at least US\$0\.50/);
    assert.equal(find(tree, node => node.type === 'button' && node.props.type === 'submit').props.disabled, true);
    find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.deepEqual(applied, []);
    find(tree, node => node.type === 'input').props.onChange({ target: { value: '14.50' } });
    tree = current.render(props);
    find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.deepEqual(applied, [1450]);
    find(tree, node => node.type === 'button' && node.props.children === 'Max').props.onClick();
    assert.deepEqual(fullSelections, [1500], 'full-wallet Max opens confirmation immediately without paying');
    tree = current.render(props);
    assert.equal(find(tree, node => node.props?.id === 'checkout-wallet-error'), null);
    find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.deepEqual(applied, [1450, 1500]);
});

test('coupon and Gold refreshes preserve the applied wallet quote, while Remove explicitly requests zero', async () => {
    const current = await orderFixture(async (...args) => quote(args[5].walletToUseCents), { data: quote(400) });
    await current.summary().props.onApplyCoupon('SAVE');
    assert.equal(current.requests[0][4], 'SAVE'); assert.equal(current.requests[0][5].walletToUseCents, 400);
    current.render(); await current.summary().props.onApplyGold(110);
    assert.equal(current.requests[1][1], 110); assert.equal(current.requests[1][5].walletToUseCents, 400);
    current.render(); await current.summary().props.onRemoveWallet();
    assert.equal(current.requests[2][5].walletToUseCents, 0);
    current.render(); assert.equal(current.card().props.allowAdaptivePricing, true);
});

test('an uncertain quote blocks payment and Retry repeats the selected quote without any wallet debit', async () => {
    let fail = true;
    const current = await orderFixture(async () => { if (fail) throw new TypeError('Response lost'); return quote(500); });
    await current.option().props.onApply(500); current.render();
    assert.equal(current.card().props.paymentBlocked, true);
    assert.equal(current.state(4), null); assert.equal(current.state(3), false);
    fail = false; await current.summary().props.onRetryPrice(); current.render();
    assert.equal(current.requests.length, 2);
    assert.equal(current.requests[1][5].walletToUseCents, 500);
    assert.equal(current.card().props.paymentBlocked, false);
    assert.equal(current.state(4), null); assert.deepEqual(current.events, []);
});

test('full wallet Max and typed Apply open confirmation while preserving the card form until explicit payment', async () => {
    const full = { ...quote(1500, { walletAvailableCents: 1800 }), clientSecret: undefined, sessionId: undefined, walletOnlyReady: true };
    for (const action of ['onMax', 'onApply']) {
        const payments = [], previous = quote(400);
        const current = await orderFixture(async () => full, { data: previous, overrides: {
            payOrderWithWallet: async (...args) => { payments.push(args); return { paidWithWallet: true, orderId: 'order', summary: full.summary }; },
        } });
        await current.option().props[action](1500); current.render();
        assert.equal(current.state(0), previous, 'selecting the full wallet does not replace card checkout with a zero-total view');
        assert.equal(current.card().props.clientSecret, previous.clientSecret);
        assert.equal(current.card().props.paymentBlocked, false);
        assert.equal(current.card().props.updatingPrice, false);
        assert.equal(current.card().props.suspended, true);
        assert.equal(current.state(3), false); assert.deepEqual(payments, []);
        let confirmation = find(current.tree(), node => node.type?.name === 'WalletConfirmation');
        assert.equal(confirmation.props.totalCents, 1500); assert.equal(confirmation.props.ready, true);
        await assert.rejects(current.card().props.onBeforeConfirm(), failure => failure.name === 'AbortError');
        await confirmation.props.onConfirm(); current.render();
        assert.deepEqual(JSON.parse(JSON.stringify(payments)), [['order', 'customer@example.test', 1500, { checkoutViewId: 'synthetic-view' }]]);
        assert.equal(current.state(4).wallet, '1');
        confirmation = find(current.tree(), node => node.type?.name === 'WalletConfirmation');
        assert.equal(confirmation, null);
    }
});

test('Back from full wallet waits for a valid restored partial quote and serializes repeated clicks', async () => {
    const full = { ...quote(1500), clientSecret: undefined, sessionId: undefined, walletOnlyReady: true };
    let respond;
    const previous = quote(400);
    const current = await orderFixture(async (...args) => args[5].walletToUseCents === 1500 ? full : new Promise(resolve => { respond = resolve; }), { data: previous });
    await current.option().props.onMax(1500); current.render();
    const back = find(current.tree(), node => node.type?.name === 'WalletConfirmation').props.onBack;
    const restoring = back(); await back(); current.render();
    assert.equal(current.requests.length, 2);
    assert.equal(current.requests[1][5].walletToUseCents, 400);
    assert.equal(find(current.tree(), node => node.type?.name === 'WalletConfirmation').props.busy, true);
    assert.equal(current.card().props.clientSecret, previous.clientSecret);
    const restored = { ...quote(400), sessionId: 'cs_restored', clientSecret: 'cs_restored_secret' };
    respond(restored); await restoring; current.render();
    assert.equal(find(current.tree(), node => node.type?.name === 'WalletConfirmation'), null);
    assert.equal(current.card().props.clientSecret, restored.clientSecret); assert.equal(current.card().props.suspended, false);
    assert.equal(current.params().get('wallet'), '400'); assert.equal(current.state(4), null);
});

test('a lost restoration reply keeps confirmation open and Retry restores again instead of reusing the full-wallet quote', async () => {
    const full = { ...quote(1500), clientSecret: undefined, sessionId: undefined, walletOnlyReady: true };
    let fail = true;
    const current = await orderFixture(async (...args) => {
        if (args[5].walletToUseCents === 1500) return full;
        if (fail) throw new TypeError('Reply lost after restoration');
        return quote(400);
    }, { data: quote(400) });
    await current.option().props.onMax(1500); current.render();
    await find(current.tree(), node => node.type?.name === 'WalletConfirmation').props.onBack(); current.render();
    let confirmation = find(current.tree(), node => node.type?.name === 'WalletConfirmation');
    assert.equal(confirmation.props.ready, false); assert.match(confirmation.props.error, /restore/);
    assert.equal(current.card().props.suspended, true); assert.equal(current.state(4), null);
    fail = false; await confirmation.props.onRetry(); current.render();
    assert.equal(current.requests[2][5].walletToUseCents, 400);
    confirmation = find(current.tree(), node => node.type?.name === 'WalletConfirmation');
    assert.equal(confirmation, null); assert.equal(current.state(3), false);
});

test('lost full-hold preparation is retryable without changing card UI or claiming a cancelled or paid payment', async () => {
    let fail = true;
    const full = { ...quote(1500), clientSecret: undefined, sessionId: undefined, walletOnlyReady: true };
    const previous = quote();
    const current = await orderFixture(async () => { if (fail) throw new TypeError('Preparation reply lost'); return full; }, { data: previous });
    await current.option().props.onMax(1500); current.render();
    let confirmation = find(current.tree(), node => node.type?.name === 'WalletConfirmation');
    assert.equal(confirmation.props.ready, false); assert.equal(current.state(0), previous);
    assert.equal(current.state(4), null); assert.equal(current.state(3), false);
    fail = false; await confirmation.props.onRetry(); current.render();
    confirmation = find(current.tree(), node => node.type?.name === 'WalletConfirmation');
    assert.equal(confirmation.props.ready, true); assert.equal(current.requests.length, 2);
    assert.equal(current.requests[1][5].walletToUseCents, 1500);
});

test('restoration rejects stale/zero-total secrets and a concurrent paid result enters verification', async () => {
    const full = { ...quote(1500), clientSecret: undefined, sessionId: undefined, walletOnlyReady: true };
    let restore = full;
    const current = await orderFixture(async (...args) => args[5].walletToUseCents === 1500 ? full : restore);
    await current.option().props.onMax(1500); current.render();
    await find(current.tree(), node => node.type?.name === 'WalletConfirmation').props.onBack(); current.render();
    assert.equal(find(current.tree(), node => node.type?.name === 'WalletConfirmation').props.ready, false);
    restore = { completed: true, sessionId: 'cs_paid_during_restore', orderId: 'order' };
    await find(current.tree(), node => node.type?.name === 'WalletConfirmation').props.onRetry(); current.render();
    assert.equal(current.state(4).session_id, 'cs_paid_during_restore');
    assert.equal(find(current.tree(), node => node.type?.name === 'WalletConfirmation'), null);
    assert.equal(current.state(3), false);
});

test('a full-wallet URL reload recreates card context before preparing the confirmation hold', async () => {
    const full = { ...quote(1500), clientSecret: undefined, sessionId: undefined, walletOnlyReady: true };
    const current = await orderFixture(async (...args) => args[5].walletToUseCents === 0 ? quote() : full,
        { data: null, search: 'gold=100&wallet=1500' });
    current.effect('createCheckoutSession'); await nextTurn(); current.render();
    assert.deepEqual(current.requests.map(args => args[5].walletToUseCents), [1500, 0, 1500]);
    assert.ok(current.requests.every(args => args[5].checkoutViewId === 'synthetic-view'));
    assert.ok(current.card()); assert.equal(current.card().props.clientSecret, quote().clientSecret);
    assert.equal(find(current.tree(), node => node.type?.name === 'WalletConfirmation').props.ready, true);
    assert.equal(current.state(4), null); assert.equal(current.state(3), false);
});

test('reload sends the selected wallet amount with Gold and ignores a late quote after leaving checkout', async () => {
    let respond;
    const current = await orderFixture(() => new Promise(resolve => { respond = resolve; }), { data: null, search: 'gold=100&wallet=400' });
    current.effect('createCheckoutSession');
    assert.equal(current.requests[0][1], 100); assert.equal(current.requests[0][5].walletToUseCents, 400);
    current.unmount(); respond(quote(400)); await nextTurn();
    assert.equal(current.state(0), null); assert.equal(current.state(4), null);
});

test('checkout summary shows the applied wallet deduction before the remaining card amount', async () => {
    let removed = 0;
    const current = await fixture('components/OrderPriceSummary', 'OrderPriceSummary');
    const tree = current.render({ summary: quote(400).summary.priceSummary, variant: 'checkout', onRemoveWallet: () => removed++ });
    const row = find(tree, node => node.props?.className === 'checkout-wallet-deduction');
    assert.equal(find(row, node => node.type === 'dd').props.children.join(''), '−$4.00');
    find(row, node => node.type === 'button').props.onClick(); assert.equal(removed, 1);
    const total = find(tree, node => node.props?.className === 'checkout-total');
    assert.equal(find(total, node => node.type === 'dt').props.children, 'Left to pay');
    assert.equal(find(total, node => node.type === 'dd').props.children, '$11.00');
});

test('a paid receipt retains the economic total and separates wallet/card tenders without a remaining payment', async () => {
    const current = await fixture('components/OrderPriceSummary', 'OrderPriceSummary');
    let tree = current.render({ summary: quote(400).summary.priceSummary, variant: 'checkout', settled: true });
    assert.equal(find(tree, node => node.props?.className === 'checkout-wallet-deduction'), null);
    const total = find(tree, node => node.props?.className === 'checkout-total');
    assert.equal(find(total, node => node.type === 'dt').props.children, 'Total');
    assert.equal(find(total, node => node.type === 'dd').props.children, '$15.00');
    assert.ok(find(tree, node => node.type === 'dt' && node.props.children === 'Paid by wallet'));
    assert.ok(find(tree, node => node.type === 'dt' && node.props.children === 'Paid by card'));
    tree = current.render({ summary: quote(1500).summary.priceSummary, variant: 'checkout', settled: true });
    assert.ok(find(tree, node => node.type === 'dt' && node.props.children === 'Paid by wallet'));
    assert.equal(find(tree, node => node.type === 'dt' && node.props.children === 'Paid by card'), null);
});

test('partial wallet confirmation requires the current USD Stripe session and exact card remainder', async () => {
    const data = quote(400);
    const display = { sessionId: data.sessionId, state: { type: 'success', checkout: { id: data.sessionId,
        currency: 'usd', minorUnitsAmountDivisor: 100, total: { total: { minorUnitsAmount: 1100 } } } } };
    assert.equal(walletQuoteMatches(data.summary, data.sessionId, display), true);
    for (const changed of [null, { ...display, sessionId: 'old' },
        { ...display, state: { ...display.state, checkout: { ...display.state.checkout, currency: 'cad' } } },
        { ...display, state: { ...display.state, checkout: { ...display.state.checkout, total: { total: { minorUnitsAmount: 1500 } } } } }]) {
        let checked = 0;
        const current = await orderFixture(async () => assert.fail('guard cannot create or debit payment'), { data, displaySession: changed,
            overrides: { checkServiceAvailability: async () => checked++ } });
        await assert.rejects(current.card().props.onBeforeConfirm(), failure => failure.code === 'WALLET_QUOTE_CHANGED');
        current.render(); assert.equal(current.card().props.paymentBlocked, true);
        assert.equal(checked, 0); assert.equal(current.state(4), null);
    }
    let checked = 0;
    const current = await orderFixture(async () => {}, { data, displaySession: display, overrides: { checkServiceAvailability: async () => checked++ } });
    await current.card().props.onBeforeConfirm(); assert.equal(checked, 1);
});

test('Gold limits use the complete order amount before wallet tender', async () => {
    const current = await fixture('pages/CheckoutPage', 'GoldRedemption');
    const props = { summary: { ...quote(1000).summary, availableGold: 1000 }, onApply() {}, disabled: false };
    let tree = current.render(props);
    find(tree, node => node.type === 'button' && node.props.children === 'Max').props.onClick();
    tree = current.render(props);
    assert.equal(find(tree, node => node.type === 'input').props.value, '250');
});
