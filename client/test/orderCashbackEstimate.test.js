import test from 'node:test';
import assert from 'node:assert/strict';
import { orderCashbackEstimate } from '../src/utils/orderCashbackEstimate.js';

test('cashback preview uses the net quoted cents and current earned tier with wallet rounding', () => {
    const estimate = (totalCents, cashbackPercent) => orderCashbackEstimate({ totalCents, cashbackPercent, eligible: true });
    assert.equal(estimate(1800, 3), 54);
    assert.equal(estimate(850, 3), 26, 'half cents round the same way as wallet cashback');
    assert.equal(estimate(2000, 5), 100);
    assert.equal(estimate(2000, 10), 200);
    assert.equal(estimate(2000, 15), 300);
});

test('cashback preview is hidden before Silver, for guests and for unavailable or stale pricing', () => {
    for (const cashbackPercent of [0, null, undefined, NaN, '3', 2, 100]) {
        assert.equal(orderCashbackEstimate({ totalCents: 1800, cashbackPercent, eligible: true }), null);
    }
    assert.equal(orderCashbackEstimate({ totalCents: 1800, cashbackPercent: 3, eligible: false }), null);
    for (const totalCents of [undefined, null, NaN, -1, 0, .5, '1800', 2147483648]) {
        assert.equal(orderCashbackEstimate({ totalCents, cashbackPercent: 3, eligible: true }), null);
    }
});
