import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { SITE_OPENING_AT, openingCountdownParts, openingLocalTimeLabel } from '../src/utils/openingCountdown.js';
import { resolveUserTimeZone } from '../src/utils/userTimeZone.js';

test('site launch is midnight November 1 in Winnipeg, using the launch-date UTC−5 offset', () => {
  assert.equal(SITE_OPENING_AT, '2026-11-01T05:00:00.000Z');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Winnipeg', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
  }).formatToParts(new Date(SITE_OPENING_AT)).map(part => [part.type, part.value]));
  assert.deepEqual([parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.timeZoneName],
    ['2026', '11', '01', '00', '00', 'GMT-5']);
});

test('the same launch instant displays local AM/PM time without a timezone suffix', () => {
  assert.equal(openingLocalTimeLabel({ locale: 'en-US', timeZone: 'America/Winnipeg' }), 'Nov 1, 2026, 12:00 AM');
  assert.equal(openingLocalTimeLabel({ locale: 'en-US', timeZone: 'Asia/Ho_Chi_Minh' }), 'Nov 1, 2026, 12:00 PM');
  assert.equal(openingLocalTimeLabel({ locale: 'en-US', timeZone: 'America/Los_Angeles' }), 'Oct 31, 2026, 10:00 PM');
});

test('the default label follows the viewer timezone without a hard-coded UTC override', () => {
  const moduleUrl = new URL('../src/utils/openingCountdown.js', import.meta.url).href;
  for (const timeZone of ['America/Winnipeg', 'Asia/Ho_Chi_Minh']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { openingLocalTimeLabel } from ${JSON.stringify(moduleUrl)}; console.log(openingLocalTimeLabel({ locale: 'en-US' }));`,
    ], { env: { ...process.env, TZ: timeZone }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), openingLocalTimeLabel({ locale: 'en-US', timeZone }));
  }
});

test('a browser with no regional timezone uses Winnipeg without changing known visitor zones', t => {
  t.mock.method(Intl.DateTimeFormat.prototype, 'resolvedOptions', () => ({ timeZone: undefined }));
  assert.equal(resolveUserTimeZone(), 'America/Winnipeg');
  assert.equal(openingLocalTimeLabel({ locale: 'en-US' }), 'Nov 1, 2026, 12:00 AM');
  assert.equal(resolveUserTimeZone('Asia/Ho_Chi_Minh'), 'Asia/Ho_Chi_Minh');
  assert.equal(openingLocalTimeLabel({ locale: 'en-US', timeZone: 'Asia/Ho_Chi_Minh' }), 'Nov 1, 2026, 12:00 PM');
  assert.equal(resolveUserTimeZone('UTC'), 'UTC');
  assert.equal(openingLocalTimeLabel({ locale: 'en-US', timeZone: 'UTC' }), 'Nov 1, 2026, 5:00 AM');
});

test('countdown uses one absolute launch boundary and does not open early at midnight UTC', () => {
  assert.deepEqual(openingCountdownParts(Date.parse('2026-11-01T00:00:00Z')),
    { days: 0, hours: 5, minutes: 0, seconds: 0, total: 18000 });
  assert.equal(openingCountdownParts(Date.parse(SITE_OPENING_AT) - 1).total, 1);
  assert.equal(openingCountdownParts(Date.parse(SITE_OPENING_AT)).total, 0);
  assert.equal(openingCountdownParts(Date.parse('2026-11-02T05:00:00Z')).total, 0);
  assert.deepEqual(openingCountdownParts(Date.parse('2026-10-31T04:59:59Z')),
    { days: 1, hours: 0, minutes: 0, seconds: 1, total: 86401 });
});
