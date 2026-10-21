import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transformWithOxc } from 'vite';

function all(tree, predicate, found = []) {
    if (!tree || typeof tree !== 'object') return found;
    if (!Array.isArray(tree) && predicate(tree)) found.push(tree);
    for (const child of Array.isArray(tree) ? tree : [tree.props?.children]) all(child, predicate, found);
    return found;
}

// Exercise the real transition components with dependency-aware hooks and inert
// Stripe substitutes, so no test creates a session or contacts Stripe.
async function fixture(entry, bindings = {}) {
    const source = await readFile(new URL('../src/components/CheckoutSessionTransition.jsx', import.meta.url), 'utf8');
    const transformed = await transformWithOxc(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export default /gm, ''),
        'CheckoutSessionTransition.jsx', { jsx: { runtime: 'automatic', development: false } });
    const hooks = [], scheduled = [];
    let cursor = 0, dirty = false, tree, props;
    const element = (type, props, key) => ({ type, props, key });
    const memo = (compute, deps) => {
        const index = cursor++, prior = hooks[index];
        if (!prior || deps.some((value, i) => !Object.is(value, prior.deps[i]))) hooks[index] = { value: compute(), deps };
        return hooks[index].value;
    };
    const effect = (callback, deps) => {
        const index = cursor++, prior = hooks[index];
        if (!prior || deps.some((value, i) => !Object.is(value, prior.deps[i]))) {
            hooks[index] = { deps, cleanup: prior?.cleanup };
            scheduled.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = callback(); });
        }
    };
    const Component = vm.runInNewContext(`${transformed.code.replace(/^import[^\n]*\n/gm, '')}\n${entry};`, {
        require: () => ({ jsx: element, jsxs: element, Fragment: 'fragment' }),
        useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
            return [hooks[index].value, value => { const next = typeof value === 'function' ? value(hooks[index].value) : value;
                if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; } }]; },
        useRef(initial) { return hooks[cursor++] ||= { current: initial }; },
        useCallback: (callback, deps) => memo(() => callback, deps), useEffect: effect, useLayoutEffect: effect,
        CheckoutElementsProvider: 'stripe-provider', CurrencySelectorElement: 'currency', ExpressCheckoutElement: 'express',
        ...bindings,
    });
    const render = next => {
        props = next || props; cursor = 0; dirty = false; tree = Component(props);
        for (const run of scheduled.splice(0)) run();
        return tree;
    };
    return { render, tree: () => tree, flush() { for (let i = 0; dirty && i < 10; i++) render(); assert.equal(dirty, false); return tree; },
        unmount() { for (const hook of hooks) hook?.cleanup?.(); } };
}

const offer = id => ({ sessionId: id, clientSecret: `${id}_secret`, allowAdaptivePricing: false });
const success = id => ({ sessionId: id, state: { type: 'success', checkout: { id } }, currencySelectorStatus: 'not-needed' });
const controls = (tree, id) => all(tree, node => node.type?.name === 'SessionControls' && node.props.sessionId === id)[0];
const layers = tree => all(tree, node => node.props?.className?.startsWith('checkout-session-layer'));

test('replacing a quote retains the old frame inert until the current frame is ready, then removes only the old provider', async () => {
    const states = [], wallets = [], confirms = [];
    const props = { ...offer('a'), blocked: false, showExpressCheckout: true,
        onStateChange: value => states.push(value), onWalletsChange: value => wallets.push(value), onConfirm: value => confirms.push(value) };
    const current = await fixture('CheckoutSessionTransition');
    let tree = current.render(props);
    controls(tree, 'a').props.onStateChange(success('a'));
    controls(tree, 'a').props.onReady({ sessionId: 'a', wallets: true }); tree = current.flush();
    const priorControls = controls(tree, 'a');
    tree = current.render({ ...props, ...offer('b') });
    assert.equal(layers(tree).length, 2);
    assert.equal(layers(tree)[0].props.inert, true); assert.equal(layers(tree)[0].props['aria-hidden'], true);
    assert.equal(layers(tree)[1].props.inert, true); assert.match(layers(tree)[1].props.className, /is-preparing/);
    assert.deepEqual(all(tree, node => node.type === 'stripe-provider').map(node => node.props.options.clientSecret), ['a_secret', 'b_secret']);
    priorControls.props.onStateChange({ sessionId: 'a', state: { type: 'error' } });
    priorControls.props.onReady({ sessionId: 'a', wallets: false });
    priorControls.props.onConfirm({ sessionId: 'a', event: 'old-click' });
    assert.equal(states.length, 1); assert.deepEqual(confirms, []); assert.deepEqual(wallets, [true]);
    controls(tree, 'b').props.onStateChange(success('b'));
    assert.equal(layers(current.tree()).length, 2, 'a loaded session alone cannot remove the visible Link frame');
    controls(tree, 'b').props.onReady({ sessionId: 'b', wallets: true }); tree = current.flush();
    assert.equal(layers(tree).length, 1); assert.equal(layers(tree)[0].key, 'b');
    assert.equal(layers(tree)[0].props.inert, false); assert.equal(layers(tree)[0].props['aria-hidden'], undefined);
    controls(tree, 'b').props.onConfirm({ sessionId: 'b', event: 'new-click' });
    assert.deepEqual(confirms, ['new-click']);
});

test('rapid quote replacements keep at most the visible frame plus newest secret and ignore late readiness after unmount', async () => {
    const changes = [], confirms = [];
    const props = { ...offer('a'), blocked: false, showExpressCheckout: true,
        onStateChange: value => changes.push(value), onWalletsChange() {}, onConfirm: value => confirms.push(value) };
    const current = await fixture('CheckoutSessionTransition');
    let tree = current.render(props); controls(tree, 'a').props.onReady({ sessionId: 'a', wallets: true }); current.flush();
    tree = current.render({ ...props, ...offer('b') }); const abandoned = controls(tree, 'b');
    tree = current.render({ ...props, ...offer('c') });
    assert.deepEqual(all(tree, node => node.type === 'stripe-provider').map(node => node.props.options.clientSecret), ['a_secret', 'c_secret']);
    abandoned.props.onReady({ sessionId: 'b', wallets: true }); abandoned.props.onStateChange(success('b'));
    assert.equal(layers(current.flush()).length, 2); assert.deepEqual(changes, []);
    const newest = controls(current.tree(), 'c');
    current.unmount(); newest.props.onReady({ sessionId: 'c', wallets: true }); newest.props.onStateChange(success('c'));
    newest.props.onConfirm({ sessionId: 'c', event: 'late' });
    assert.deepEqual(changes, []); assert.deepEqual(confirms, []);
});

test('blocked and not-yet-visible sessions cannot confirm and a mismatched Stripe state cannot become current', async () => {
    const changes = [], confirms = [];
    const props = { ...offer('a'), blocked: false, showExpressCheckout: true,
        onStateChange: value => changes.push(value), onWalletsChange() {}, onConfirm: value => confirms.push(value) };
    const current = await fixture('CheckoutSessionTransition');
    let tree = current.render(props); controls(tree, 'a').props.onConfirm({ sessionId: 'a', event: 'early' });
    controls(tree, 'a').props.onStateChange({ ...success('a'), state: success('different').state });
    assert.deepEqual(changes, []); assert.deepEqual(confirms, []);
    controls(tree, 'a').props.onReady({ sessionId: 'a', wallets: true }); current.flush();
    tree = current.render({ ...props, blocked: true }); controls(tree, 'a').props.onConfirm({ sessionId: 'a', event: 'blocked' });
    assert.equal(layers(tree)[0].props.inert, true); assert.deepEqual(confirms, []);
});

test('Express readiness waits for actual available methods and recognizes unavailable method objects correctly', async () => {
    const ready = [], states = [];
    const props = { sessionId: 'a', showExpressCheckout: true, onReady: value => ready.push(value), onStateChange: value => states.push(value), onConfirm() {} };
    const current = await fixture('SessionControls', { useCheckoutElements: () => ({ type: 'success', checkout: { id: 'a' } }) });
    let tree = current.render(props);
    const express = all(tree, node => node.type === 'express')[0];
    express.props.onReady({ availablePaymentMethods: { link: true } }); current.flush();
    assert.deepEqual(ready, [], 'onReady can fire while the actual button area is still empty');
    express.props.onAvailablePaymentMethodsChange({ paymentMethods: { link: { available: false }, applePay: { available: false } } }); current.flush();
    assert.equal(ready.at(-1).wallets, false);
    express.props.onAvailablePaymentMethodsChange({ paymentMethods: { link: { available: true } } }); tree = current.flush();
    assert.equal(ready.at(-1).wallets, true); assert.ok(all(tree, node => node.props?.className === 'checkout-wallet-slot').length);
    assert.equal(states.at(-1).sessionId, 'a');
});

test('resolved no-methods and hidden Express need no availability event; currency controls still must be ready', async () => {
    const ready = [];
    const props = { sessionId: 'a', showExpressCheckout: true, onReady: value => ready.push(value), onStateChange() {}, onConfirm() {} };
    const current = await fixture('SessionControls', { useCheckoutElements: () => ({ type: 'success', checkout: { id: 'a', currencyOptions: [{ currency: 'usd' }] } }) });
    let tree = current.render(props);
    all(tree, node => node.type === 'express')[0].props.onReady({ availablePaymentMethods: undefined }); current.flush();
    assert.deepEqual(ready, []);
    all(tree, node => node.type === 'currency')[0].props.onReady(); tree = current.flush();
    assert.equal(ready.at(-1).wallets, false);
    assert.match(all(tree, node => node.props?.className?.startsWith('checkout-wallet-slot'))[0].props.className, /is-empty/);
    const hidden = await fixture('SessionControls', { useCheckoutElements: () => ({ type: 'success', checkout: { id: 'a' } }) });
    hidden.render({ ...props, showExpressCheckout: false }); hidden.flush();
    assert.equal(ready.at(-1).wallets, false);
});
