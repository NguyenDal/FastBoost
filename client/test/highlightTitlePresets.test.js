import test from 'node:test';
import assert from 'node:assert/strict';
import { isHighlightTitlePreset } from '../src/utils/highlightTitlePresets.js';

test('a preset title is valid only for its order game', () => {
  assert.equal(isHighlightTitlePreset('lol', 'Solo Kill'), true);
  assert.equal(isHighlightTitlePreset('tft', 'Solo Kill'), false);
  assert.equal(isHighlightTitlePreset('tft', '3-Star Unit'), true);
  assert.equal(isHighlightTitlePreset('lol', '3-Star Unit'), false);
  assert.equal(isHighlightTitlePreset('lol', ''), false);
});
