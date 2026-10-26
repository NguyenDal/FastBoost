import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_HIGHLIGHT_BYTES, normalizeHighlightTitle, titleFromFile, validateHighlightFile } from '../src/utils/orderHighlightValidation.js';

test('accepts MP4 and WebM clips within the 100 MiB limit', () => {
  assert.equal(validateHighlightFile({ name: 'winning-play.MP4', type: 'video/mp4', size: MAX_HIGHLIGHT_BYTES }), '');
  assert.equal(validateHighlightFile({ name: 'winning-play.webm', type: 'video/webm', size: 1024 }), '');
});

test('rejects missing, mismatched, empty and oversized clips', () => {
  assert.match(validateHighlightFile(null), /Choose/);
  assert.match(validateHighlightFile({ name: 'clip.mov', type: 'video/quicktime', size: 1024 }), /MP4 or WebM/);
  assert.match(validateHighlightFile({ name: 'clip.mp4', type: 'video/webm', size: 1024 }), /MP4 or WebM/);
  assert.match(validateHighlightFile({ name: 'clip.mp4', type: 'video/mp4', size: 0 }), /content/);
  assert.match(validateHighlightFile({ name: 'clip.mp4', type: 'video/mp4', size: MAX_HIGHLIGHT_BYTES + 1 }), /under 100 MB/);
});

test('normalizes concise titles and derives one from a filename', () => {
  assert.equal(normalizeHighlightTitle('  Final\nPush  '), 'FinalPush');
  assert.equal(normalizeHighlightTitle('a'.repeat(101)).length, 100);
  assert.equal(titleFromFile({ name: 'final_push-to-gold.mp4' }), 'final push to gold');
  assert.equal(titleFromFile({ name: '.webm' }), 'Match highlight');
});
