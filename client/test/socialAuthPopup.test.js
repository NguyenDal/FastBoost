import test from 'node:test';
import assert from 'node:assert/strict';
import { socialAuthPopupFeatures } from '../src/utils/socialAuthPopup.js';

test('centers the original popup size within the current display work area', () => {
  assert.equal(socialAuthPopupFeatures({
    screen: { availLeft: 0, availTop: 40, availWidth: 1920, availHeight: 1040 },
    screenX: 20, screenY: 60, outerWidth: 900, outerHeight: 800,
  }), 'popup,width=520,height=720,left=700,top=200');
});

test('centers on displays left of and above the primary monitor without clamping to zero', () => {
  assert.equal(socialAuthPopupFeatures({
    screen: { availLeft: -1920, availTop: -1080, availWidth: 1920, availHeight: 1040 },
  }), 'popup,width=520,height=720,left=-1220,top=-920');
  assert.equal(socialAuthPopupFeatures({
    screen: { availLeft: 1920, availTop: 0, availWidth: 2560, availHeight: 1440 },
  }), 'popup,width=520,height=720,left=2940,top=360');
});

test('fits a popup inside a smaller available display and retains that display offset', () => {
  assert.equal(socialAuthPopupFeatures({
    screen: { availLeft: -360, availTop: 40, availWidth: 360, availHeight: 640 },
  }), 'popup,width=360,height=640,left=-360,top=40');
});

test('falls back to the browser window center when available display offsets are missing', () => {
  assert.equal(socialAuthPopupFeatures({
    screen: { availWidth: 1920, availHeight: 1080 },
    screenX: 200, screenY: 100, outerWidth: 1200, outerHeight: 900,
  }), 'popup,width=520,height=720,left=540,top=190');
  assert.equal(socialAuthPopupFeatures({
    screen: { availWidth: 1920, availHeight: 1080 },
    screenX: -1800, screenY: 100, outerWidth: 1000, outerHeight: 800,
  }), 'popup,width=520,height=720,left=-1560,top=140');
});

test('uses legacy window offsets and viewport dimensions if outer geometry is unavailable', () => {
  assert.equal(socialAuthPopupFeatures({
    screenLeft: -1200, screenTop: 80, innerWidth: 1000, innerHeight: 800,
  }), 'popup,width=520,height=720,left=-960,top=120');
});

test('missing or nonfinite geometry never generates NaN or Infinity features', () => {
  for (const browser of [null, {}, {
    screen: { availLeft: NaN, availTop: Infinity, availWidth: -20, availHeight: Infinity },
    screenX: NaN, screenY: Infinity, outerWidth: 0, outerHeight: NaN,
  }]) {
    assert.equal(socialAuthPopupFeatures(browser), 'popup,width=520,height=720,left=0,top=0');
  }
});
