const test = require('node:test');
const assert = require('node:assert/strict');
const { orderEarnings, estimateMatchEarnings } = require('../src/utils/earnings');
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

test('match-based earnings require full confirmation and never also count legacy submissions', () => {
    const input = { ...order([100, 100]), matchHistoryEnabled: true,
        matches: [...Array.from({ length: 9 }, () => ({ status: 'APPROVED', boosterId: 'a' })),
            { status: 'APPROVED', boosterId: 'b' }, { status: 'REJECTED', boosterId: null }] };
    assert.deepEqual(orderEarnings(input).shares, []);
    input.matchHistoryConfirmedAt = new Date();
    assert.deepEqual(orderEarnings(input).shares, [{ boosterId: 'a', matches: 9, cents: 5040 }, { boosterId: 'b', matches: 1, cents: 560 }]);
    input.matches.push({ status: 'PENDING' });
    assert.equal(orderEarnings(input).shares.length, 2, 'unsubmitted games do not block confirmed earnings');
    input.matches.push({ status: 'PENDING', boosterId: 'b' });
    assert.deepEqual(orderEarnings(input).shares, []);
    input.matches = [{ status: 'REJECTED' }];
    assert.deepEqual(orderEarnings(input).shares, []);
});

test('submission estimates exclude unrelated and rejected games and never create payable earnings', () => {
    const input = { amountCents: 10001, goldDiscountCents: 2000, matchHistoryEnabled: true,
        matches: [{ status: 'APPROVED', boosterId: 'a' }, { status: 'PENDING', boosterId: 'a' },
            { status: 'PENDING', boosterId: 'b' }, { status: 'REJECTED', boosterId: 'b' },
            ...Array.from({ length: 17 }, () => ({ status: 'PENDING', boosterId: null }))] };
    const estimate = estimateMatchEarnings(input);
    assert.deepEqual(estimate.shares, [{ boosterId: 'a', matches: 2, cents: 3734 }, { boosterId: 'b', matches: 1, cents: 1867 }]);
    assert.equal(estimate.shares.reduce((sum, share) => sum + share.cents, 0), estimate.boosterCents);
    assert.deepEqual(orderEarnings(input).shares, []);
    assert.equal(input.matches[1].status, 'PENDING', 'preview must not approve the evidence');
});
