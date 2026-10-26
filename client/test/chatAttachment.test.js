import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpenChatAttachment } from '../src/utils/chatAttachment.js';

test('legacy URL-only attachment messages can open through the authorized endpoint', () => {
    assert.equal(canOpenChatAttachment({ id: 'saved', attachmentName: 'old.png', attachmentUrl: 'https://example.test/old.png' }), true);
    assert.equal(canOpenChatAttachment({ id: 'saved', attachmentName: 'old.png' }), true);
});

test('non-attachments and in-progress uploads cannot open', () => {
    assert.equal(canOpenChatAttachment({ id: 'message', text: 'hello' }), false);
    assert.equal(canOpenChatAttachment({ attachmentName: 'missing-id.png' }), false);
    assert.equal(canOpenChatAttachment({ id: 'uploading-1', attachmentName: 'pending.png', isUploadingAttachment: true }), false);
});
