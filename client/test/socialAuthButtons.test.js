import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import vm from 'node:vm';
import { transformWithOxc } from 'vite';
import { socialAuthPopupFeatures } from '../src/utils/socialAuthPopup.js';

const API_BASE_URL = 'http://localhost:5000/api';
const APP_ORIGIN = 'http://localhost:5173';

function elements(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...elements(tree.props?.children, predicate)];
}

async function fixture(componentName, { blocked = false } = {}) {
  const source = await readFile(new URL(`../src/components/${componentName}.jsx`, import.meta.url), 'utf8');
  const transformed = await transformWithOxc(source
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/\bexport default\s+(?=function)/g, '')
    .replace(/^export /gm, ''), `${componentName}.jsx`, { jsx: { runtime: 'automatic', development: false } });
  const states = [], refs = [], effects = [], cleanups = [], opened = [], submissions = [], calls = [];
  const listeners = new Set(), intervals = new Map(), timeouts = new Map();
  let cursor = 0, refCursor = 0, nextTimer = 1, token = 'synthetic-app-session', props = {};
  const popup = { closed: false, closeCalls: 0, close() { this.closed = true; this.closeCalls++; } };
  const window = {
    location: { origin: APP_ORIGIN },
    screen: { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1040 },
    open(...args) { opened.push(args); return blocked ? null : popup; },
    addEventListener(type, listener) { assert.equal(type, 'message'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'message'); listeners.delete(listener); },
    setInterval(callback) { const id = nextTimer++; intervals.set(id, callback); return id; },
    setTimeout(callback) { const id = nextTimer++; timeouts.set(id, callback); return id; },
  };
  const document = {
    createElement(tag) {
      if (tag === 'input') return {};
      assert.equal(tag, 'form');
      return {
        inputs: [], append(input) { this.inputs.push(input); },
        submit() { submissions.push(this); }, remove() { this.removed = true; },
      };
    },
    body: { append(form) { form.appended = true; } },
  };
  const element = (type, elementProps) => ({ type, props: elementProps });
  const Component = vm.runInNewContext(`${transformed.code.replace(/^import[^\n]*\n/gm, '')}\n${componentName};`, {
    _jsx: element, _jsxs: element, _Fragment: 'fragment',
    require(module) { assert.equal(module, 'react/jsx-runtime'); return { jsx: element, jsxs: element }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useRef(initial) { return refs[refCursor++] ||= { current: initial }; },
    useEffect(effect) { effects.push(effect); },
    fetch: async (url, options) => {
      calls.push({ url, options });
      assert.ok(url.endsWith('/providers') || url.endsWith('/connections'), 'fixture only loads provider availability');
      return { ok: true, json: async () => url.endsWith('/providers')
        ? { google: true, discord: true }
        : { google: { configured: true, linked: false }, discord: { configured: true, linked: false } } };
    },
    API_BASE_URL, URL, AbortController, window, document, socialAuthPopupFeatures,
    clearInterval: id => intervals.delete(id), clearTimeout: id => timeouts.delete(id),
    authStorage: { getItem(key) { assert.equal(key, 'token'); return token; } },
    SocialLinkConfirmation: 'social-link-confirmation', LegalAgreement: 'legal-agreement',
    PaymentErrorDialog: 'payment-error-dialog', ProviderLogo: 'provider-logo',
  });
  const render = () => { cursor = 0; refCursor = 0; return Component(props); };
  return {
    opened, submissions, calls, popup, listeners, intervals, timeouts,
    async mount(nextProps = {}) {
      props = nextProps; render();
      for (const effect of effects.splice(0)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
      await nextTurn();
    },
    render,
    click(provider) {
      const button = elements(render(), item => item.type === 'button' && (
        item.props.className === 'auth-provider-button'
          ? item.props.children[1].props.children[1].toLowerCase() === provider
          : item.props.children === `Link ${provider === 'google' ? 'Google' : 'Discord'}`
      ))[0];
      assert.ok(button, `${provider} button is rendered`);
      assert.equal(button.props.disabled, false);
      button.props.onClick();
    },
    message(data, overrides = {}) {
      const event = { origin: new URL(API_BASE_URL).origin, source: popup, data: { type: 'fastboost:social-auth', ...data }, ...overrides };
      for (const receive of [...listeners]) receive(event);
    },
    closePopup() { popup.closed = true; for (const callback of [...intervals.values()]) callback(); },
    setToken(value) { token = value; },
    unmount() { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); },
  };
}

function assertCleanedUp(f) {
  assert.equal(f.listeners.size, 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timeouts.size, 0);
}

function assertIdle(f) {
  assertCleanedUp(f);
  const buttons = elements(f.render(), item => item.type === 'button');
  assert.equal(buttons.length, 2);
  assert.ok(buttons.every(item => item.props.disabled === false));
}

for (const provider of ['google', 'discord']) {
  test(`${provider} opens a separate sign-in popup and retains registration choices`, async () => {
    const f = await fixture('SocialAuthButtons');
    await f.mount({ mode: 'register', termsAccepted: true, promotionalEmails: true, rememberMe: true, referralCode: 'REFERRAL' });
    f.click(provider);
    assert.equal(f.opened.length, 1);
    const [href, target, features] = f.opened[0];
    assert.equal(target, 'fastboost-social-auth');
    assert.equal(features, 'popup,width=520,height=720,left=700,top=160', 'preserve and center the separate popup');
    const url = new URL(href);
    assert.equal(url.origin + url.pathname, `${API_BASE_URL}/auth/social/${provider}/start`);
    assert.equal(url.searchParams.get('origin'), APP_ORIGIN);
    for (const key of ['termsAccepted', 'promotionalEmails', 'rememberMe']) assert.equal(url.searchParams.get(key), 'true');
    assert.equal(url.searchParams.get('referralCode'), 'REFERRAL');
    assert.ok(elements(f.render(), item => item.props?.className === 'auth-provider-button').every(item => item.props.disabled));
    f.unmount();
    assert.equal(f.popup.closeCalls, 1);
    assertCleanedUp(f);
  });
}

test('a blocked sign-in popup shows feedback without leaving either provider busy', async () => {
  const f = await fixture('SocialAuthButtons', { blocked: true });
  await f.mount(); f.click('google');
  const dialog = elements(f.render(), item => item.type === 'payment-error-dialog')[0];
  assert.equal(dialog.props.message, 'Please allow the sign-in popup and try again.');
  assertIdle(f);
});

test('sign-in accepts only a message from its exact popup and API origin, then closes and cleans up', async () => {
  const f = await fixture('SocialAuthButtons');
  const accepted = [];
  await f.mount({ onSuccess: data => accepted.push(data) }); f.click('google');
  const payload = { token: 'synthetic-session-result', user: { id: 'synthetic-user' } };
  f.message(payload, { origin: 'https://attacker.example' });
  f.message(payload, { source: {} });
  f.message(payload, { data: { ...payload, type: 'unrelated-message' } });
  assert.equal(accepted.length, 0);
  assert.equal(f.listeners.size, 1);
  assert.equal(f.popup.closeCalls, 0);
  f.message(payload);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].token, payload.token);
  assert.equal(f.popup.closeCalls, 1);
  assertIdle(f);
  f.message(payload);
  assert.equal(accepted.length, 1, 'removed listener cannot deliver duplicate authentication');
});

test('closing the sign-in popup clears busy controls and watchers without authenticating', async () => {
  const f = await fixture('SocialAuthButtons');
  await f.mount({ onSuccess: () => assert.fail('Closing a popup must not authenticate') });
  f.click('discord'); f.closePopup();
  assertIdle(f);
});

test('provider cancellation returns the supplied error and cleans up the sign-in popup', async () => {
  const f = await fixture('SocialAuthButtons');
  await f.mount(); f.click('discord');
  f.message({ error: 'Sign-in was cancelled. You can try again.' });
  assert.equal(elements(f.render(), item => item.type === 'payment-error-dialog')[0].props.message, 'Sign-in was cancelled. You can try again.');
  assertIdle(f);
});

test('linking submits its session only by POST into a separate popup and checks callback ownership', async () => {
  const f = await fixture('LinkedSignInAccounts');
  await f.mount(); f.click('google');
  assert.deepEqual(f.opened[0], ['about:blank', 'fastboost-link-auth', 'popup,width=520,height=720,left=700,top=160']);
  assert.equal(f.submissions.length, 1);
  const form = f.submissions[0];
  assert.equal(form.method, 'POST');
  assert.equal(form.action, `${API_BASE_URL}/auth/social/google/link/start`);
  assert.equal(form.target, 'fastboost-link-auth');
  assert.equal(form.hidden, true);
  assert.equal(form.appended, true);
  assert.equal(form.removed, true);
  assert.equal(form.inputs.find(input => input.name === 'sessionToken').value, 'synthetic-app-session');
  assert.equal(form.inputs.find(input => input.name === 'origin').value, APP_ORIGIN);
  assert.ok(form.inputs.every(input => input.type === 'hidden'));
  assert.ok(!form.action.includes('synthetic-app-session'));
  f.message({ linked: 'google' }, { origin: 'https://attacker.example' });
  f.message({ linked: 'google' }, { source: {} });
  f.message({}, { data: { type: 'wrong-channel', linked: 'google' } });
  assert.equal(f.listeners.size, 1);
  f.message({ linked: 'google' });
  assert.equal(elements(f.render(), item => item.type === 'button' && item.props['aria-label'] === 'Unlink Google').length, 1);
  assert.equal(f.popup.closeCalls, 1);
  assertIdle(f);
});

test('a linked-account result cannot update the UI after the initiating session changes', async () => {
  const f = await fixture('LinkedSignInAccounts');
  await f.mount(); f.click('discord');
  f.setToken('different-synthetic-session');
  f.message({ linked: 'discord' });
  assert.equal(elements(f.render(), item => item.type === 'button' && item.props['aria-label'] === 'Unlink Discord').length, 0);
  assertIdle(f);
});
