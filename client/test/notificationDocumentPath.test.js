import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationDocumentPath } from '../src/utils/notificationDocumentPath.js';

test('document notifications link only to their own internal document route', () => {
    const payout = { type: 'BOOSTER_PAYOUT_INFORMATION', data: { targetPath: '/provider/payout-information/abc-123' } };
    assert.equal(notificationDocumentPath(payout), payout.data.targetPath);
    assert.equal(notificationDocumentPath({ type: 'BOOSTER_CONTRACT', data: { targetPath: '/provider/contracts/abc-123' } }), '/provider/contracts/abc-123');
    for (const path of ['https://example.com/', '//example.com/', '/admin/accounts', '/provider/contracts/abc', '/provider/payout-information/../accounts', '/provider/payout-information/abc?account=123', '/provider/payout-information/abc#data']) {
        assert.equal(notificationDocumentPath({ ...payout, data: { targetPath: path } }), null);
    }
    assert.equal(notificationDocumentPath({ ...payout, type: 'OTHER' }), null);
    assert.equal(notificationDocumentPath(null), null);
});
