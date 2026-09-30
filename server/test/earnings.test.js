const test = require('node:test');
const assert = require('node:assert/strict');
const { orderEarnings } = require('../src/utils/earnings');
const order = (counts, amountCents = 10000, goldDiscountCents = 2000) => ({ amountCents, goldDiscountCents,
    assignments: counts.map((_, i) => ({ boosterId: String(i) })),
    contributions: counts.map((matches, i) => ({ boosterId: String(i), approvedMatches: matches, submittedMatches: matches })) });
test('9/1 participation allocates 90/10 of the 70% pool after redemption', () => {
    const result = orderEarnings(order([9, 1]));
    assert.equal(result.revenueCents, 8000);
    assert.equal(result.platformCents, 2400);
    assert.equal(result.boosterCents, 5600);
    assert.deepEqual(result.shares.map(s => s.cents), [5040, 560]);
});
test('no equal split fallback for missing or pending approvals', () => {
    const input = order([9, 1]);
    input.contributions[1].approvedMatches = null;
    assert.deepEqual(orderEarnings(input).shares, []);
    input.contributions = [];
    assert.deepEqual(orderEarnings(input).shares, []);
    assert.deepEqual(orderEarnings(order([0, 0])).shares, []);
});
test('past contributions survive removal from current assignments', () => {
    const input = order([9, 1]); input.assignments = [input.assignments[1]];
    assert.deepEqual(orderEarnings(input).shares.map(s => s.cents), [5040, 560]);
});
test('fractional cents are conserved and zero contributors earn zero', () => {
    for (let amount = 1; amount < 150; amount++) {
        const result = orderEarnings(order([9, 1, 0], amount, 0));
        assert.equal(result.shares.reduce((sum, s) => sum + s.cents, 0), result.boosterCents);
        assert.equal(result.shares.find(s => s.boosterId === '2').cents, 0);
        assert.equal(result.platformCents + result.boosterCents, amount);
    }
});
test('fully redeemed and missing historical amounts never invent earnings', () => {
    assert.equal(orderEarnings(order([1], 1000, 1000)).boosterCents, 0);
    assert.equal(orderEarnings({ amountCents: null }), null);
});
