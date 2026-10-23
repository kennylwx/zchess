import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from '@zchess/chess';
import { ChessServerClient, serverUrlFromArgs } from '../dist/api.js';
import { modelInput } from '../dist/input.js';

test('server flag overrides environment and missing flag values fail clearly', () => {
  assert.equal(serverUrlFromArgs([], {}), undefined);
  assert.equal(serverUrlFromArgs([], {ZCHESS_SERVER_URL: '  '}), undefined);
  assert.equal(serverUrlFromArgs([], {ZCHESS_SERVER_URL: 'https://env.example'}), 'https://env.example');
  assert.equal(serverUrlFromArgs(['--server', 'https://flag.example'], {ZCHESS_SERVER_URL: 'https://env.example'}), 'https://flag.example');
  for (const args of [['--server'], ['--server', '--depth', '1'], ['--server', '']]) assert.throws(() => serverUrlFromArgs(args, {}), /requires/);
});

test('unconfigured natural language does not contact localhost; notation stays offline', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No configured service: do not fetch'));
  const chess = new Chess();
  const before = chess.fen();
  const client = new ChessServerClient('');
  assert.equal((await modelInput('e4', chess, client)).source, 'notation');
  await assert.rejects(modelInput('pawn to e4', chess, client), error => {
    assert.match(error.message, /Set --server URL or ZCHESS_SERVER_URL/);
    assert.ok(!error.message.includes('No exact match'));
    return true;
  });
  assert.equal(chess.fen(), before);
});

test('configured natural language sends instruction and position to resolver without provider credentials', async t => {
  // Stub transport verifies wiring only; these responses are not LLM inference.
  for (const [instruction, fen, move] of [
    ['pawn to e4', new Chess().fen(), 'e2e4'],
    ['knight to e4', '4k3/8/8/8/8/8/5N2/4K3 w - - 0 1', 'f2e4'],
    ['bishop take queen', '4k3/8/8/3q4/2B5/8/8/4K3 w - - 0 1', 'c4d5'],
  ]) {
    const chess = new Chess(fen);
    const after = new Chess(fen); after.play(move);
    const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(String(url), 'https://chess.example/base/api/resolve');
      assert.deepEqual(JSON.parse(options.body), {instruction, fen});
      assert.deepEqual(options.headers, {'content-type': 'application/json'});
      return Response.json({move, fen: after.fen(), explanation: 'Test fixture'});
    });
    const result = await modelInput(instruction, chess, new ChessServerClient('https://chess.example/base/'));
    assert.equal(result.source, 'jev');
    assert.equal(result.value, move);
    assert.equal(chess.fen(), fen);
    chess.play(result.value);
    assert.equal(chess.fen(), after.fen());
    fetch.mock.restore();
  }
});

test('wrong endpoint, access errors, missing provider config and malformed responses preserve board', async t => {
  for (const [status, body, message] of [
    [401, {detail:'Missing or invalid bearer token.'}, /Chess server access denied \(401\)/],
    [403, {}, /Chess server access denied \(403\)/],
    [503, {detail:'TYPESAFE_API_KEY is not configured'}, /TYPESAFE_API_KEY is not configured/],
    [200, {status:'ok'}, /Invalid Chess server move response/],
    [422, {detail:'No match'}, /No exact match/],
  ]) {
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(body, {status}));
    const chess = new Chess(); const before = chess.fen();
    await assert.rejects(modelInput('pawn to e4', chess, new ChessServerClient('https://chess.example')), message);
    assert.equal(chess.fen(), before);
    fetch.mock.restore();
  }
});

test('connection and non-JSON failures are actionable; cancellation stays cancellation', async t => {
  const client = new ChessServerClient('https://chess.example');
  const fetch = t.mock.method(globalThis, 'fetch', async () => {throw new TypeError('fetch failed');});
  await assert.rejects(client.resolve('pawn to e4', new Chess()), /Cannot reach Chess server/);
  fetch.mock.mockImplementation(async () => new Response('<html>Wrong app</html>'));
  await assert.rejects(client.resolve('pawn to e4', new Chess()), /Invalid Chess server response/);
  fetch.mock.mockImplementation(async () => {throw new DOMException('Cancelled', 'AbortError');});
  await assert.rejects(client.resolve('pawn to e4', new Chess()), {name:'AbortError'});
});

test('invalid or credential-bearing endpoint is rejected before a request', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Invalid endpoint must not be contacted'));
  for (const url of ['localhost:8000', 'https://user:secret@example.com', 'https://example.com?token=secret', 'file:///tmp/service']) {
    await assert.rejects(new ChessServerClient(url).resolve('pawn to e4', new Chess()), /Invalid Chess server URL/);
  }
});

test('cancellation after headers during streaming body parsing stays cancellation', {timeout: 2000}, async t => {
  for (const withSignal of [false, true]) {
    const abort = new AbortController();
    const reason = withSignal ? new Error('Caller cancelled body read') : new DOMException('Body aborted', 'AbortError');
    let bodyController;
    let reading;
    const bodyReadStarted = new Promise(resolve => { reading = resolve; });
    let sent = false;
    const response = new Response(new ReadableStream({
      start(controller) { bodyController = controller; },
      pull(controller) {
        if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode('{"move":')); }
        else reading();
      },
    }));
    const fetch = t.mock.method(globalThis, 'fetch', async () => response);
    const client = new ChessServerClient('https://chess.example', withSignal ? abort.signal : undefined);
    const result = client.resolve('pawn to e4', new Chess());
    await bodyReadStarted;
    if (withSignal) abort.abort(reason);
    bodyController.error(reason);
    await assert.rejects(result, error => error === reason);
    fetch.mock.restore();
  }
});
