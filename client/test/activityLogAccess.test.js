import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { transformWithOxc } from 'vite';

// Run the actual hook with deferred in-memory requests. No real accounts,
// browser storage, API calls or additional testing dependencies are involved.
async function accessFixture() {
    const source = await readFile(new URL('../src/hooks/useActivityLogAccess.js', import.meta.url), 'utf8');
    const requests = [], listeners = new Map();
    let state, initialized = false, effect, cleanup;
    const hook = vm.runInNewContext(`${source.replace(/^import[^;]+;\r?\n/gm, '')
        .replace('export default function', 'function')}\nuseActivityLogAccess;`, {
        AbortController,
        useState(initial) {
            if (!initialized) { state = initial; initialized = true; }
            return [state, value => { state = value; }];
        },
        useEffect(callback) { effect ||= callback; },
        activityLogs(path, signal) {
            return new Promise((resolve, reject) => { requests.push({ path, signal, resolve, reject }); });
        },
        window: {
            addEventListener(type, callback) { listeners.set(type, callback); },
            removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
        },
    });
    assert.equal(hook(), false, 'access starts closed until the server confirms it');
    cleanup = effect();
    return { requests, allowed: () => hook(), focus: () => listeners.get('focus')?.(),
        unmount: () => cleanup(), listenerCount: () => listeners.size };
}

test('activity-log capability requires explicit server permission and does not require ownership', async () => {
    for (const [response, expected] of [[{ canView: true, isOwner: false }, true], [{ canView: false, isOwner: true }, false],
        [{ isOwner: true }, false], [{ canView: 'true' }, false], [{ canView: 1 }, false]]) {
        const fixture = await accessFixture();
        assert.equal(fixture.requests.length, 1);
        assert.equal(fixture.requests[0].path, '/access');
        fixture.requests[0].resolve(response); await nextTurn();
        assert.equal(fixture.allowed(), expected);
        fixture.unmount();
    }
});

test('focus rechecks revoke log access after unauthorized or unavailable responses', async () => {
    for (const status of [401, 403, 503]) {
        const fixture = await accessFixture();
        fixture.requests[0].resolve({ canView: true }); await nextTurn();
        assert.equal(fixture.allowed(), true);
        fixture.focus();
        assert.equal(fixture.requests[0].signal.aborted, true);
        assert.equal(fixture.requests.length, 2);
        fixture.requests[1].reject(Object.assign(new Error('Permission no longer available'), { status }));
        await nextTurn();
        assert.equal(fixture.allowed(), false, `HTTP ${status} clears the displayed grant`);
        fixture.unmount();
    }
});

test('an aborted stale focus response cannot restore or remove the latest log permission', async () => {
    for (const latestAllowed of [false, true]) {
        const fixture = await accessFixture();
        fixture.focus();
        assert.equal(fixture.requests[0].signal.aborted, true);
        if (latestAllowed) fixture.requests[1].resolve({ canView: true });
        else fixture.requests[1].reject(Object.assign(new Error('Revoked'), { status: 403 }));
        await nextTurn();
        assert.equal(fixture.allowed(), latestAllowed);
        // Deliberately ignore AbortSignal in this fake transport to simulate
        // a response already queued when a newer focus check supersedes it.
        if (latestAllowed) fixture.requests[0].reject(Object.assign(new Error('Stale denial'), { status: 403 }));
        else fixture.requests[0].resolve({ canView: true });
        await nextTurn();
        assert.equal(fixture.allowed(), latestAllowed);
        fixture.unmount();
    }
});

test('unmount aborts the request and removes the focus check without granting late access', async () => {
    const fixture = await accessFixture();
    assert.equal(fixture.listenerCount(), 1);
    fixture.unmount();
    assert.equal(fixture.requests[0].signal.aborted, true);
    assert.equal(fixture.listenerCount(), 0);
    fixture.requests[0].resolve({ canView: true }); await nextTurn();
    assert.equal(fixture.allowed(), false);
});

async function renderComponent(directory, name, canView) {
    const source = await readFile(new URL(`../src/${directory}/${name}.jsx`, import.meta.url), 'utf8');
    const transformed = await transformWithOxc(source.replace(/^import[\s\S]*?;\r?\n/gm, '')
        .replace('export default function', 'function'), `${name}.jsx`, { jsx: { runtime: 'automatic', development: false } });
    const element = (type, props) => ({ type, props });
    const component = vm.runInNewContext(`${transformed.code.replace(/^import[^\n]*\n/gm, '')}\n${name};`, {
        _jsx: element, _jsxs: element, _Fragment: 'fragment',
        require(module) { assert.equal(module, 'react/jsx-runtime'); return { jsx: element, jsxs: element, Fragment: 'fragment' }; },
        Link: 'Link', Outlet: 'Outlet', Navbar: 'Navbar', OrdersIcon: 'OrdersIcon', UsersIcon: 'UsersIcon',
        PriceIcon: 'PriceIcon', ActivityIcon: 'ActivityIcon', SupportIcon: 'SupportIcon',
        useActivityLogAccess: () => canView, useLocation: () => ({ pathname: '/admin/activity-logs' }),
    });
    return component();
}
function elements(tree) {
    if (Array.isArray(tree)) return tree.flatMap(elements);
    if (!tree || typeof tree !== 'object') return [];
    return [tree, ...elements(tree.props?.children)];
}
function textContent(tree) {
    if (Array.isArray(tree)) return tree.map(textContent).join(' ');
    if (tree == null || typeof tree === 'boolean') return '';
    if (typeof tree !== 'object') return String(tree);
    return textContent(tree.props?.children);
}

test('management navigation and card follow log access, with a read-only admin label', async () => {
    for (const canView of [false, true]) {
        const layout = await renderComponent('layouts', 'AdminLayout', canView);
        const management = await renderComponent('pages', 'AdminManagementPage', canView);
        for (const tree of [layout, management]) {
            const links = elements(tree).filter(node => node.type === 'Link' && node.props.to === '/admin/activity-logs');
            assert.equal(links.length, canView ? 1 : 0);
            assert.doesNotMatch(textContent(tree), /Owner only/u);
        }
        if (canView) {
            const card = elements(management).find(node => node.type === 'Link' && node.props.to === '/admin/activity-logs');
            assert.match(textContent(card), /Read only/u);
        }
    }
});
