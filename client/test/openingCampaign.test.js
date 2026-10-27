import test from 'node:test';
import assert from 'node:assert/strict';
import { openingCampaignPhase, openingCampaignTimeLeft, openingSavings } from '../src/data/openingCampaign.js';

test('opening offer follows November 2026 UTC boundaries', () => {
  assert.equal(openingCampaignPhase('2026-10-31T23:59:59.999Z'), 'upcoming');
  assert.equal(openingCampaignPhase('2026-11-01T00:00:00.000Z'), 'active');
  assert.equal(openingCampaignPhase('2026-11-30T23:59:59.999Z'), 'active');
  assert.equal(openingCampaignPhase('2026-12-01T00:00:00.000Z'), 'ended');
  assert.deepEqual(openingCampaignTimeLeft('2026-10-31T23:00:00.000Z'), { days: 0, hours: 1, minutes: 0 });
});

test('savings preview only calculates a base price example', () => {
  assert.deepEqual(openingSavings(100), { savings: 15, discountedBase: 85 });
  assert.deepEqual(openingSavings(20), { savings: 3, discountedBase: 17 });
  assert.equal(openingSavings(-1), null);
});
