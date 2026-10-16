import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntilPayout, chronologicalMonths, monthAmount, chartCurrencies, monthWindow, chartScale } from '../src/utils/monthlyEarningsChart.js';

test('payout countdown uses the supplied local date and clamps payout day or past dates to zero', () => {
    const payout = '2026-11-01T05:00:00Z';
    const zone = 'America/Winnipeg';
    assert.equal(daysUntilPayout(payout, zone, new Date('2026-11-01T04:59:59Z')), 1, 'still October 31 in Winnipeg');
    assert.equal(daysUntilPayout(payout, 'UTC', new Date('2026-11-01T04:59:59Z')), 0, 'already November 1 in UTC');
    assert.equal(daysUntilPayout(payout, zone, new Date(payout)), 0);
    assert.equal(daysUntilPayout(payout, zone, new Date('2026-11-01T18:00:00Z')), 0);
    assert.equal(daysUntilPayout(payout, zone, new Date('2026-11-03T18:00:00Z')), 0);
});

test('payout calendar-day count remains correct across short and long DST days', () => {
    const zone = 'America/Winnipeg';
    assert.equal(daysUntilPayout('2026-04-01T05:00:00Z', zone, new Date('2026-03-01T06:00:00Z')), 31);
    assert.equal(daysUntilPayout('2026-12-01T06:00:00Z', zone, new Date('2026-11-01T05:00:00Z')), 30);
    assert.equal(daysUntilPayout('2026-03-09T05:00:00Z', zone, new Date('2026-03-08T06:00:00Z')), 1, '23-hour day');
    assert.equal(daysUntilPayout('2026-11-02T06:00:00Z', zone, new Date('2026-11-01T05:00:00Z')), 1, '25-hour day');
});

test('months are chronological across years without mutating API data or duplicating the current month', () => {
    const summary = { current: { month: '2027-01', closed: false }, reports: [
        { month: '2026-12' }, { month: '2026-11' }, { month: '2027-01', closed: true },
    ] };
    const before = structuredClone(summary);
    const months = chronologicalMonths(summary);
    assert.deepEqual(months.map(month => month.month), ['2026-11', '2026-12', '2027-01']);
    assert.equal(months.at(-1).closed, false);
    assert.deepEqual(summary, before);
    assert.deepEqual(chronologicalMonths(null), []);
});

test('currency amounts stay separate and preserve negative adjustments and absent-currency zeroes', () => {
    const months = [
        { totals: [{ currency: 'USD', amountCents: 12345 }, { currency: 'CAD', amountCents: -9876 }] },
        { totals: [{ currency: 'cad', amountCents: 30 }] },
        { totals: [] },
    ];
    assert.deepEqual(chartCurrencies(months), ['CAD', 'USD']);
    assert.equal(monthAmount(months[0], 'USD'), 12345);
    assert.equal(monthAmount(months[0], 'cad'), -9876);
    assert.equal(monthAmount(months[1], 'USD'), 0);
    assert.equal(monthAmount(months[2], 'CAD'), 0);
    assert.equal(monthAmount(null, 'USD'), 0);
    assert.deepEqual(chartCurrencies([]), []);
});

test('six-month pages expose all history exactly once in chronological windows, newest window first', () => {
    const months = Array.from({ length: 14 }, (_, index) => ({ month: index }));
    const latest = monthWindow(months);
    const middle = monthWindow(months, { page: 1 });
    const oldest = monthWindow(months, { page: 2 });
    assert.deepEqual(latest.months.map(month => month.month), [8, 9, 10, 11, 12, 13]);
    assert.deepEqual(middle.months.map(month => month.month), [2, 3, 4, 5, 6, 7]);
    assert.deepEqual(oldest.months.map(month => month.month), [0, 1]);
    assert.deepEqual([latest.hasOlder, latest.hasNewer, latest.totalPages], [true, false, 3]);
    assert.deepEqual([oldest.hasOlder, oldest.hasNewer], [false, true]);
    assert.equal(monthWindow(months, { page: 99 }).page, 2);
    assert.equal(monthWindow(months, { page: -1 }).page, 0);
    assert.deepEqual([...oldest.months, ...middle.months, ...latest.months], months);
    assert.deepEqual(monthWindow([]), { months: [], page: 0, totalPages: 1, hasOlder: false, hasNewer: false });
});

test('scaling includes zero for positive, negative and mixed month totals', () => {
    const positive = chartScale([100, 200]);
    assert.deepEqual([positive.min, positive.max, positive.baseline, positive.position(100)], [0, 200, 0, 50]);
    const negative = chartScale([-100, -200]);
    assert.deepEqual([negative.min, negative.max, negative.baseline, negative.position(-100)], [-200, 0, 100, 50]);
    const mixed = chartScale([-100, 300]);
    assert.deepEqual([mixed.min, mixed.max, mixed.baseline, mixed.position(-100), mixed.position(300)], [-100, 300, 25, 0, 100]);
    assert.equal(Math.abs(mixed.position(-100) - mixed.baseline), 25);
    assert.equal(Math.abs(mixed.position(300) - mixed.baseline), 75);
});

test('empty and all-zero series have finite baseline and no phantom positive bars', () => {
    for (const values of [[], [0, 0], [NaN, Infinity, -Infinity]]) {
        const scale = chartScale(values);
        assert.deepEqual([scale.min, scale.max, scale.baseline, scale.position(0)], [0, 1, 0, 0]);
        assert.equal(scale.position(NaN), 0);
    }
});
