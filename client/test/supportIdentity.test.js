import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { setImmediate } from 'node:timers';
import { transformWithOxc } from 'vite';
import { supportIdentityName, supportIdentityHasName, supportIdentityImage } from '../src/utils/supportIdentity.js';

const customer = { id: 'customer', role: 'CUSTOMER', username: 'PlayerExample', profile: { displayName: 'Different display name', profileImageUrl: 'https://example.test/signed-avatar' } };
test('support consistently prefers the customer username and saved profile image', () => {
    assert.equal(supportIdentityName(customer), 'PlayerExample');
    assert.equal(supportIdentityImage(customer), customer.profile.profileImageUrl);
    assert.equal(supportIdentityName({ username: '  Player  ', profile: { displayName: 'Other' } }), 'Player');
    assert.equal(supportIdentityName({ username: '  ', profile: { displayName: '  Legacy name  ' } }), 'Legacy name');
});

test('a customer without profile data is never presented as Support or their private email', () => {
    const unnamed = { role: 'CUSTOMER', username: null, profile: null, email: 'private@example.test' };
    assert.equal(supportIdentityName(unnamed), 'Customer');
    assert.equal(supportIdentityHasName(unnamed), false);
    assert.equal(supportIdentityImage(unnamed), null);
    assert.equal(supportIdentityName({ role: 'ADMIN', username: null }), 'Support');
    assert.equal(supportIdentityName(undefined), 'Customer');
});

const jsx = (type, props, ...children) => ({ type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } });
function find(tree, predicate) {
    if (!tree || typeof tree !== 'object') return null;
    if (!Array.isArray(tree) && predicate(tree)) return tree;
    for (const child of Array.isArray(tree) ? tree : [tree.props?.children]) { const found = find(child, predicate); if (found) return found; }
    return null;
}
async function component(file, name, bindings = {}, initial = []) {
    const source = (await readFile(new URL(file, import.meta.url), 'utf8'))
        .replace(/^import .*?;\r?\n/gm, '').replace(/export default /g, '').replace(/export /g, '');
    const { code } = await transformWithOxc(source, 'fixture.jsx', { jsx: { runtime: 'classic', pragma: 'jsx', pragmaFrag: 'Fragment' } });
    let cursor = 0;
    const states = [...initial], effects = [], cleanup = [];
    const compiled = vm.runInNewContext(`${code}\n${name}`, { jsx, Fragment: 'fragment',
        useState(value) { const i = cursor++; if (!(i in states)) states[i] = value; return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
        useRef: value => ({ current: value }), useEffect: effect => effects.push(effect),
        supportIdentityName, supportIdentityHasName, supportIdentityImage, AvatarImage: 'AvatarImage',
        setTimeout: () => 1, clearTimeout() {}, document: { hidden: false, addEventListener() {}, removeEventListener() {} },
        window: { addEventListener() {}, removeEventListener() {} }, ...bindings });
    return { render(props) { cursor = 0; return compiled(props); }, runEffects() { for (const effect of effects.splice(0)) { const dispose = effect(); if (dispose) cleanup.push(dispose); } }, cleanup() { cleanup.splice(0).forEach(dispose => dispose()); } };
}

test('support avatar renders the saved photo and uses a neutral icon for an unnamed account', async () => {
    const ui = await component('../src/components/SupportChat.jsx', 'SupportAvatar');
    const photo = find(ui.render({ user: customer }), node => node.type === 'AvatarImage');
    assert.equal(photo.props.src, customer.profile.profileImageUrl);
    assert.equal(photo.props.fallback, 'P');
    const unnamed = find(ui.render({ user: { role: 'CUSTOMER' } }), node => node.type === 'AvatarImage');
    assert.equal(unnamed.props.fallback.type, 'svg');
});

test('incoming message authors use their customer identity instead of a generic staff label', async () => {
    for (const sender of [customer, { id: customer.id, role: 'CUSTOMER', username: null, profile: null }]) {
        const message = { id: 'message', senderId: sender.id, sender, content: 'Help with my order', createdAt: '2026-10-29T03:00:00Z' };
        const ui = await component('../src/components/SupportChat.jsx', 'SupportConversation', {
            shouldRenderDateDivider: () => false,
        }, [[message]]);
        const rendered = ui.render({ threadId: 'thread', user: { id: 'admin', role: 'ADMIN' } });
        assert.equal(find(rendered, node => node.props?.className === 'support-sender').props.children, sender.username || 'Customer');
        const avatar = find(rendered, node => node.props?.user === sender);
        assert.equal(avatar.props.user, sender);
        // Effects are intentionally not run: no message or read receipt is sent.
    }
});

test('a directly linked conversation loads customer identity even outside the first inbox page', async () => {
    const calls = [];
    const ui = await component('../src/pages/AdminSupportPage.jsx', 'AdminSupportPage', {
        useSearchParams: () => [new URLSearchParams('thread=older-thread'), () => {}],
        getStoredUser: () => ({ id: 'admin', role: 'ADMIN' }),
        SupportAvatar: 'SupportAvatar', SupportConversation: 'SupportConversation', SupportIcon: 'SupportIcon',
        supportRequest: async path => { calls.push(path); return path === '/threads' ? { threads: [], hasMore: false } : { thread: { id: 'older-thread', customer } }; },
    });
    ui.render(); ui.runEffects(); await new Promise(resolve => setImmediate(resolve));
    const rendered = ui.render();
    assert.ok(calls.includes('/threads/older-thread'));
    assert.ok(find(rendered, node => node.type === 'strong' && node.props.children === customer.username));
    assert.equal(find(rendered, node => node.type === 'SupportAvatar').props.user, customer);
    ui.cleanup();
});
