import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from '@zchess/chess';
import { modelInput } from '../dist/input.js';
import { ResolutionError } from '../dist/api.js';
import { suggestMoves } from '../dist/suggestions.js';

const capturePosition = 'k7/8/8/8/4r3/3K4/8/8 w - - 0 1';

test('missing capture marker suggests the matching capture without calling JEV or moving', async () => {
  const chess = new Chess(capturePosition);
  const server = { resolve: async () => { assert.fail('Notation must never be reinterpreted by JEV'); } };
  await assert.rejects(modelInput('Ke4', chess, server), /Try: Kxe4/);
  assert.equal(chess.fen(), capturePosition);
  assert.equal(chess.history.length, 0);
  const result = await modelInput('Kxe4', chess, server);
  assert.equal(result.value, 'd3e4');
  assert.equal(result.source, 'notation');
  assert.ok(suggestMoves('Ke4', chess).every(move => move.startsWith('K')));
  assert.ok(suggestMoves('Ke4', chess).length <= 5);
});

test('natural-language suggestions match the requested pawn capture and target', async () => {
  const chess = new Chess();
  chess.play('e4'); chess.play('d5');
  const before = chess.fen();
  assert.deepEqual(suggestMoves('my pawn takes on d5', chess), ['exd5']);
  assert.ok(suggestMoves('my knight takes on d5', chess).length > 0);
  const server = { resolve: async () => { throw new ResolutionError('No match', 422); } };
  await assert.rejects(modelInput('my pawn takes on d5', chess, server), /Try: exd5/);
  assert.equal(chess.fen(), before);
});

test('unrelated requests offer legal alternatives', () => {
  assert.ok(suggestMoves('hello there', new Chess()).length > 0);
});

test('strict SAN does not strip a wrong check marker or annotations', async () => {
  const chess = new Chess();
  await assert.rejects(modelInput('e4+', chess), /Try: e4/);
  await assert.rejects(modelInput('e4!', chess), /Try: e4/);
  assert.equal((await modelInput('e2e4', chess)).value, 'e2e4');
});

test('provider outages retain their error and include legal suggestions', async () => {
  const server = { resolve: async () => { throw new ResolutionError('TypeSafe unavailable', 502); } };
  await assert.rejects(modelInput('move my pawn', new Chess(), server), error => {
    assert.match(error.message, /TypeSafe unavailable.*Try:/);
    assert.ok(!error.message.includes('No exact match'));
    return true;
  });
});

for (const query of ['move my pawn to e4', 'knight to f3', 'take the queen', 'hello there', '???', 'e9', 'e4+', 'e2→e4', '♘f3', 'N×f3', 'move my rook to e5']) {
  test(`offers legal suggestions without changing the board: ${query}`, () => {
    const chess = new Chess();
    const before = chess.fen();
    const moves = chess.moves();
    const legal = moves.map(move => chess.san(move, moves));
    const suggestions = suggestMoves(query, chess);
    assert.ok(suggestions.length > 0 && suggestions.length <= 5);
    assert.equal(new Set(suggestions).size, suggestions.length);
    for (const move of suggestions) assert.ok(legal.includes(move), move);
    assert.equal(chess.fen(), before);
    assert.equal(chess.history.length, 0);
  });
}

for (const [query, move] of [['e4','e2e4'], ['e2e4','e2e4'], ['Nf3','g1f3'], ['♘f3','g1f3'], ['e2→e4','e2e4'], ['e2 -> e4','e2e4']]) {
  test(`accepts exact legal notation locally: ${query}`, async () => {
    const server = { resolve: async () => assert.fail('Legal notation must stay local') };
    assert.equal((await modelInput(query, new Chess(), server)).value, move);
  });
}

for (const error of [new TypeError('fetch failed'), new ResolutionError('API key missing',503), new ResolutionError('No match',422)]) {
  test(`offers suggestions after resolver failure: ${error.message}`, async () => {
    const chess = new Chess();
    const before = chess.fen();
    await assert.rejects(modelInput('move my knight to f3', chess, { resolve: async () => { throw error; } }), /Try: Nf3/);
    assert.equal(chess.fen(), before);
  });
}

test('suggests the requested human-language move without a provider', async () => {
  assert.deepEqual(suggestMoves('move my knight to f3',new Chess()), ['Nf3']);
  await assert.rejects(modelInput('move my knight to f3',new Chess()), /Try: Nf3/);
});

test('offers no moves after checkmate or stalemate', () => {
  for (const fen of ['7k/6Q1/5K2/8/8/8/8/8 b - - 0 1','7k/5Q2/6K1/8/8/8/8/8 b - - 0 1']) {
    assert.deepEqual(suggestMoves('anything',new Chess(fen)), []);
  }
});
