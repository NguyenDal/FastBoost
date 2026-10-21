import test from 'node:test';
import assert from 'node:assert/strict';
import { getSaleDisplayStatus, isCurrentSale } from '../src/utils/saleStatus.js';

test('current campaign controls include live and scheduled offers and hide expired or disabled ones', () => {
    const now = Date.parse('2026-10-21T12:00:00Z');
    const sales = [
        { id: 'live', active: true, startsAt: '2026-10-20T12:00:00Z', endsAt: '2026-10-22T12:00:00Z' },
        { id: 'scheduled', active: true, startsAt: '2026-10-22T12:00:00Z', endsAt: null },
        { id: 'no-expiry', active: true, startsAt: null, endsAt: null },
        { id: 'expired-coupon', active: true, couponCode: 'FALL15', endsAt: '2026-10-20T12:00:00Z' },
        { id: 'disabled', active: false, endsAt: null },
    ];
    const before = structuredClone(sales);
    assert.deepEqual(sales.filter(sale => isCurrentSale(sale, now)).map(sale => sale.id), ['live', 'scheduled', 'no-expiry']);
    assert.equal(getSaleDisplayStatus(sales[1], now), 'SCHEDULED');
    assert.deepEqual(sales, before, 'filtering preserves historical campaign data');
});

test('an open control stops showing a coupon at its exact expiration, matching checkout eligibility', () => {
    const endsAt = '2026-10-21T12:00:00Z';
    const end = Date.parse(endsAt);
    const sale = { active: true, endsAt, status: 'ACTIVE' };
    assert.equal(isCurrentSale(sale, end - 1), true);
    assert.equal(isCurrentSale(sale, end), false);
    assert.equal(getSaleDisplayStatus(sale, end + 1), 'EXPIRED');
    assert.equal(isCurrentSale(null, end), false);
});
