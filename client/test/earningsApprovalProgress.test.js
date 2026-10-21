import test from 'node:test';
import assert from 'node:assert/strict';
import { earningsApprovalProgress } from '../src/utils/earningsReport.js';

test('count-only approval includes an assigned booster before they submit any matches', () => {
    assert.deepEqual(earningsApprovalProgress({ reviewMode: 'contributions', boosters: [{ id: 'assigned' }], contributions: [],
        matchCounts: { approved: 0, submitted: 0 } }), { approved: 0, total: 1, unit: 'booster', pending: 0, returned: 0 });
});

test('count-only approvals count unique reviewed booster submissions rather than their match totals', () => {
    const row = { reviewMode: 'contributions', boosters: [{ id: 'approved' }, { id: 'approved' }, { id: 'missing' }], contributions: [
        { boosterId: 'approved', submittedMatches: 12, approvedMatches: 12 },
        { boosterId: 'pending', submittedMatches: 4, approvedMatches: null },
        { boosterId: 'returned', submittedMatches: 3, approvedMatches: null, reviewedAt: '2026-10-21T12:00:00Z' },
        { boosterId: 'revised', submittedMatches: 2, approvedMatches: 1 },
        { boosterId: 'zero', submittedMatches: 0, approvedMatches: 0 },
    ] };
    const before = structuredClone(row);
    assert.deepEqual(earningsApprovalProgress(row), { approved: 2, total: 6, unit: 'boosters', pending: 2, returned: 1 });
    assert.deepEqual(row, before);
});

test('individual-history approvals retain submitted match counts when evidence is saved', () => {
    assert.deepEqual(earningsApprovalProgress({ reviewMode: 'matches', boosters: [{ id: 'assigned' }],
        matchCounts: { total: 10, submitted: 3, approved: 2, pending: 1, rejected: 2, unsubmitted: 5 } }),
    { approved: 2, total: 3, unit: 'matches', pending: 1, returned: 2 });
    assert.deepEqual(earningsApprovalProgress({ reviewMode: 'matches', boosters: [{ id: 'assigned' }], matchCounts: { total: 1, submitted: 0, unsubmitted: 1 } }),
        { approved: 0, total: 0, unit: 'matches', pending: 0, returned: 0 });
});

test('history without saved matches shows assigned boosters awaiting submission without inventing matches', () => {
    assert.deepEqual(earningsApprovalProgress({ reviewMode: 'matches', boosters: [{ id: 'assigned' }, { id: 'assigned' }],
        matchCounts: { total: 0, submitted: 0, approved: 0, pending: 0, rejected: 0, unsubmitted: 0 } }),
    { approved: 0, total: 1, unit: 'booster', pending: 0, returned: 0 });
    assert.deepEqual(earningsApprovalProgress({ reviewMode: 'matches', boosters: [], matchCounts: { total: 0, submitted: 0 } }),
        { approved: 0, total: 0, unit: 'matches', pending: 0, returned: 0 });
});
