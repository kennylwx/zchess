import type { Chess } from '@zchess/chess';
import { ResolutionError, type MoveResult } from '@zchess/chess/interaction';
export { ResolutionError, type MoveResult } from '@zchess/chess/interaction';

/** Explicit flag takes precedence over the environment; no implicit local service. */
export function serverUrlFromArgs(args: string[], env = process.env): string | undefined {
  const index = args.indexOf('--server');
  if (index >= 0) {
    const value = args[index + 1];
    if (!value?.trim() || value.startsWith('--')) throw new Error('--server requires a Chess server URL.');
    return value.trim();
  }
  return env.ZCHESS_SERVER_URL?.trim() || undefined;
}

export class ChessServerClient {
  constructor(private readonly baseUrl = process.env.ZCHESS_SERVER_URL, private readonly signal?: AbortSignal) {}

  async resolve(text: string, chess: Chess): Promise<MoveResult> {
    if (!this.baseUrl?.trim()) {
      throw new ResolutionError('Set --server URL or ZCHESS_SERVER_URL for natural-language moves. SAN/UCI works offline', 503);
    }
    let url: URL;
    try {
      url = new URL(this.baseUrl.trim().replace(/\/$/, '') + '/api/resolve');
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
      throw new ResolutionError('Invalid Chess server URL. Use an HTTP(S) base URL without credentials, query or fragment', 503);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: text, fen: chess.fen() }),
        signal: this.signal,
      });
    } catch (error) {
      if (this.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      throw new ResolutionError('Cannot reach Chess server. Check --server or ZCHESS_SERVER_URL and start the backend', 503);
    }
    if (response.status === 401 || response.status === 403) {
      throw new ResolutionError(`Chess server access denied (${response.status}). Check the endpoint and its access policy; provider keys belong on the server`, response.status);
    }
    let body: unknown;
    try { body = await response.json(); }
    catch (error) {
      if (this.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      throw new ResolutionError(`Invalid Chess server response (${response.status}). Check that the configured URL serves /api/resolve`, 502);
    }
    if (!response.ok) {
      const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : undefined;
      throw new ResolutionError(typeof detail === 'string' ? detail : `Chess server failed (${response.status})`, response.status);
    }
    if (!body || typeof body !== 'object' || !('move' in body) || !('fen' in body) || !('explanation' in body) ||
        typeof body.move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(body.move) ||
        typeof body.fen !== 'string' || typeof body.explanation !== 'string') {
      throw new ResolutionError('Invalid Chess server move response. Check the configured /api/resolve endpoint', 502);
    }
    return body as MoveResult;
  }
}
