import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess, START_FEN } from '@zchess/chess';
import { OPENING_KINDS } from '../dist/openings.js';

test('every selectable opening line is legal from the initial position', () => {
  assert.ok(OPENING_KINDS.length >= 5);
  for (const kind of OPENING_KINDS) {
    assert.ok(kind.lines.length > 0, `${kind.name} should have variations`);
    for (const line of kind.lines) {
      const chess = new Chess(START_FEN);
      for (const san of line.moves) {
        assert.doesNotThrow(() => chess.play(san), `${line.name}: ${san}`);
      }
    }
  }
});
