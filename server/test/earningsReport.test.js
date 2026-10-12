const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEarningsReport } = require('../src/utils/earningsReport');

const person = id => ({ id, username: `user-${id}`, profile: { displayName: `Booster ${id}` } });
const match = (boosterId, status = 'APPROVED', queueId = 420, game = 'LOL') => ({ boosterId, booster: boosterId ? person(boosterId) : null, status, game, details: { queueId } });
const history = (values = {}) => ({ id: 'order', orderNumber: 'LOL-RNK-TEST', boostType: 'Rank Boost', queueType: 'Solo/Duo',
    amountCents: 10001, goldDiscountCents: 2000, currency: 'cad', paidAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-10-10T10:00:00Z'), matchHistoryEnabled: true, matchHistoryConfirmedAt: null,
    assignments: [], contributions: [], matches: [], ...values });
const contribution = (boosterId, submittedMatches, approvedMatches = submittedMatches, extra = {}) => ({ boosterId,
    booster: person(boosterId), submittedMatches, approvedMatches, revision: 2, submittedAt: new Date('2026-09-02'),
    reviewedAt: approvedMatches == null ? null : new Date('2026-09-03'), reviewNote: null, ...extra });
const legacy = (values = {}) => history({ matchHistoryEnabled: false, ...values });

test('confirmed multi-booster shares reconcile with the pool and preserve currency-separated legacy totals', () => {
    const report = buildEarningsReport([
        history({ matchHistoryConfirmedAt: new Date(), matches: [match('a'), match('a'), match('b')] }),
        legacy({ id: 'usd', amountCents: 10000, goldDiscountCents: 0, currency: 'USD', contributions: [contribution('a', 1)] }),
    ]);
    assert.deepEqual(report.totals, [
        { currency: 'CAD', revenueCents: 8001, boosterCents: 5601, platformCents: 2400, unallocatedCents: 0, orders: 1 },
        { currency: 'USD', revenueCents: 10000, boosterCents: 7000, platformCents: 3000, unallocatedCents: 0, orders: 1 },
    ]);
    assert.deepEqual(report.boosters, { a: { CAD: 3734, USD: 7000 }, b: { CAD: 1867 } });
    assert.deepEqual(report.rows[0].shares, [{ boosterId: 'a', matches: 2, cents: 3734 }, { boosterId: 'b', matches: 1, cents: 1867 }]);
    assert.equal(report.rows[0].confirmedBoosterCents, 5601);
    assert.equal(report.rows[0].reviewStatus, 'CONFIRMED');
    assert.deepEqual(report.rows[0].estimatedShares, []);
});

test('pending claims have separate estimates, never enter confirmed earnings, and do not mutate evidence', () => {
    const input = history({ matches: [match('a'), match('a', 'PENDING'), match('b', 'PENDING'), match('b', 'REJECTED')] });
    const snapshot = structuredClone(input);
    const report = buildEarningsReport([input]);
    const row = report.rows[0];
    assert.equal(row.reviewStatus, 'NEEDS_REVIEW');
    assert.equal(row.confirmedBoosterCents, 0);
    assert.equal(row.unallocatedCents, 5601);
    assert.deepEqual(report.boosters, {});
    assert.deepEqual(row.shares, []);
    assert.deepEqual(row.estimatedShares, [{ boosterId: 'a', matches: 2, cents: 3734 }, { boosterId: 'b', matches: 1, cents: 1867 }]);
    assert.deepEqual(input, snapshot);
});

test('match counts and identities respect the service queue; unclaimed imports are not awaiting review', () => {
    const row = buildEarningsReport([history({ matches: [match('a'), match(null, 'PENDING'), match('a', 'REJECTED'),
        match('wrong-flex', 'PENDING', 440), match('wrong-tft', 'APPROVED', 1100, 'TFT')] })]).rows[0];
    assert.deepEqual(row.matchCounts, { total: 3, submitted: 1, approved: 1, pending: 0, rejected: 1, unsubmitted: 1 });
    assert.equal(row.reviewStatus, 'READY_TO_CONFIRM');
    assert.deepEqual(row.boosters, [{ id: 'a', username: 'user-a', displayName: 'Booster a' }]);
    const tft = buildEarningsReport([history({ boostType: 'TFT Rank Boost', queueType: 'Flex',
        matches: [match('a', 'PENDING', 1100, 'TFT'), match('wrong-double-up', 'APPROVED', 1160, 'TFT'), match('wrong-lol')] })]).rows[0];
    assert.deepEqual(tft.matchCounts, { total: 1, submitted: 1, approved: 0, pending: 1, rejected: 0, unsubmitted: 0 });
    assert.deepEqual(tft.boosters.map(booster => booster.id), ['a']);
});

test('missing amounts stay reviewable, known zero counts in the financial denominator, and unknown payment dates stay unknown', () => {
    const report = buildEarningsReport([
        history({ id: 'missing', amountCents: null, paidAt: null, matchHistoryConfirmedAt: new Date(), matches: [match('a')] }),
        history({ id: 'zero', amountCents: 1000, goldDiscountCents: 1000, matchHistoryConfirmedAt: new Date(), matches: [match('a')] }),
    ]);
    assert.equal(report.rows.length, 2);
    assert.equal(report.missingAmounts, 1);
    const missing = report.rows[0];
    assert.equal(missing.amountKnown, false);
    assert.equal(missing.reviewStatus, 'CONFIRMED', 'review state is independent of missing financial data');
    for (const key of ['revenueCents', 'boosterCents', 'platformCents', 'confirmedBoosterCents', 'unallocatedCents', 'paidAt']) assert.equal(missing[key], null);
    assert.deepEqual(missing.shares, []);
    assert.deepEqual(missing.estimatedShares, []);
    assert.equal(report.rows[1].amountKnown, true);
    assert.equal(report.rows[1].revenueCents, 0);
    assert.equal(report.rows[1].reviewStatus, 'CONFIRMED');
    assert.deepEqual(report.totals, [{ currency: 'CAD', revenueCents: 0, boosterCents: 0, platformCents: 0, unallocatedCents: 0, orders: 1 }]);
    assert.deepEqual(report.boosters, { a: { CAD: 0 } });
});

test('legacy review keeps former assignees and full contribution revisions, with no invented match imports', () => {
    const input = legacy({ assignments: [{ boosterId: 'b', booster: person('b') }],
        contributions: [contribution('a', 9), contribution('b', 1)] });
    const row = buildEarningsReport([input]).rows[0];
    assert.equal(row.reviewMode, 'contributions');
    assert.equal(row.reviewStatus, 'CONFIRMED');
    assert.deepEqual(row.matchCounts, { total: null, submitted: 10, approved: 10, pending: 0, rejected: 0, unsubmitted: null });
    assert.deepEqual(row.boosters.map(booster => booster.id), ['a', 'b']);
    assert.deepEqual(row.contributions, input.contributions);
    assert.equal(row.shares.find(share => share.boosterId === 'a').cents, 5041);
    assert.equal(row.shares.find(share => share.boosterId === 'b').cents, 560);
});

test('legacy pending, returned, and missing submissions remain distinct and cannot allocate money', () => {
    const rows = buildEarningsReport([
        legacy({ contributions: [contribution('a', 3), contribution('b', 1, null)] }),
        legacy({ contributions: [contribution('a', 3), contribution('b', 1, null, { reviewedAt: new Date(), reviewNote: 'Please correct.' })] }),
        legacy({ assignments: [{ boosterId: 'c', booster: person('c') }], contributions: [contribution('a', 3)] }),
        legacy({ contributions: [contribution('a', 0, null)] }),
        legacy({ contributions: [contribution('a', 0)] }),
    ]).rows;
    assert.deepEqual(rows.map(row => row.reviewStatus), ['NEEDS_REVIEW', 'RETURNED', 'AWAITING_SUBMISSION', 'NEEDS_REVIEW', 'AWAITING_SUBMISSION']);
    assert.deepEqual(rows.map(row => row.shares), [[], [], [], [], []]);
    assert.equal(rows[0].matchCounts.pending, 1);
    assert.equal(rows[1].matchCounts.rejected, 1);
    assert.deepEqual(rows[1].estimatedShares, [{ boosterId: 'a', matches: 3, cents: 5601 }], 'a returned claim must not dilute active claims');
    assert.deepEqual(rows[2].estimatedShares, [{ boosterId: 'a', matches: 3, cents: 5601 }], 'an unsubmitted assignee has no invented equal share');
    assert.deepEqual(rows[2].boosters.map(booster => booster.id), ['a', 'c']);
    assert.deepEqual(rows[3].estimatedShares, []);
});

test('unconfirmed approved matches are only estimates, while reintroduced pending claims invalidate confirmation', () => {
    const rows = buildEarningsReport([
        history({ matches: [match('a')] }),
        history({ matches: [match(null, 'PENDING')] }),
        history({ matchHistoryConfirmedAt: new Date(), matches: [match('a'), match('b', 'PENDING')] }),
    ]).rows;
    assert.deepEqual(rows.map(row => row.reviewStatus), ['READY_TO_CONFIRM', 'AWAITING_SUBMISSION', 'NEEDS_REVIEW']);
    assert.deepEqual(rows.map(row => row.shares), [[], [], []]);
    assert.equal(rows[0].estimatedShares[0].cents, 5601);
    assert.deepEqual(rows[1].estimatedShares, []);
    assert.equal(rows[2].estimatedShares.reduce((sum, share) => sum + share.cents, 0), 5601);
});
