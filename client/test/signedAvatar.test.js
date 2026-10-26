import test from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_REFRESH_INTERVAL_MS, isSignedAvatarUrl, requestAvatarRefresh, safeAvatarSrc, shouldRefreshAvatarData } from '../src/utils/signedAvatar.js';

const signed = 'https://fastboost-assets.s3.ca-central-1.amazonaws.com/profiles/user/photo.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900&X-Amz-Signature=abc';

test('allows a signed profile URL and normal HTTPS avatars', () => {
  assert.equal(safeAvatarSrc(signed), signed);
  assert.equal(isSignedAvatarUrl(signed), true);
  const pathStyle = 'https://s3.ca-central-1.amazonaws.com/fastboost-assets/profiles/user/photo.png?X-Amz-Expires=900&X-Amz-Signature=abc';
  assert.equal(safeAvatarSrc(pathStyle), pathStyle);
  assert.equal(safeAvatarSrc('https://images.example.test/avatar.png'), 'https://images.example.test/avatar.png');
  assert.equal(safeAvatarSrc('/assets/logos/fastboost-logo.png'), '/assets/logos/fastboost-logo.png');
});

test('never renders an unsigned private bucket URL or raw object key', () => {
  assert.equal(safeAvatarSrc('profiles/user/photo.png'), '');
  assert.equal(safeAvatarSrc('https://fastboost-assets.s3.amazonaws.com/profiles/user/photo.png'), '');
  assert.equal(safeAvatarSrc('https://fastboost-assets.s3.amazonaws.com/profiles/user/photo.png?X-Amz-Signature='), '');
  assert.equal(safeAvatarSrc('https://fastboost-assets.s3.amazonaws.com/order-highlights/clip.mp4?X-Amz-Expires=900&X-Amz-Signature=abc'), '');
  assert.equal(safeAvatarSrc('https://s3.ca-central-1.amazonaws.com/fastboost-assets/profiles/user/photo.png'), '');
  assert.equal(safeAvatarSrc('javascript:alert(1)'), '');
  assert.equal(safeAvatarSrc('https://name:password@images.example.test/a.png'), '');
  assert.equal(isSignedAvatarUrl('https://images.example.test/avatar.png'), false);
});

test('an expired signed image asks for a fresh API URL without retry loops', () => {
  const previousWindow = globalThis.window;
  const previousNow = Date.now;
  const events = [];
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  try {
    Date.now = () => 10_000;
    assert.equal(requestAvatarRefresh(signed), true);
    Date.now = () => 11_000;
    assert.equal(requestAvatarRefresh(signed), false);
    Date.now = () => 14_000;
    assert.equal(requestAvatarRefresh(signed), true);
    assert.equal(requestAvatarRefresh('profiles/user/photo.png'), false);
    assert.deepEqual(events, ['avatar:refresh', 'avatar:refresh']);
  } finally {
    globalThis.window = previousWindow;
    Date.now = previousNow;
  }
});

test('focus refreshes avatar data before fifteen-minute links expire', () => {
  assert.equal(shouldRefreshAvatarData(1000, 1000 + AVATAR_REFRESH_INTERVAL_MS - 1), false);
  assert.equal(shouldRefreshAvatarData(1000, 1000 + AVATAR_REFRESH_INTERVAL_MS), true);
  assert.ok(AVATAR_REFRESH_INTERVAL_MS < 15 * 60 * 1000);
});
