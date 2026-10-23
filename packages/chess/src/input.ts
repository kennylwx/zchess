import { squareName } from './index.js';
import type { Chess } from './index.js';
import { ResolutionError, type MoveResolver } from './resolution.js';
import { illegalMoveReason } from './legality.js';
import { looksLikeNotation, normalizeNotation, suggestionMessage } from './suggestions.js';

export type InputIntent =
  | { type:'empty' }
  | { type:'quit' }
  | { type:'help' }
  | { type:'undo' }
  | { type:'back' }
  | { type:'show-fen' }
  | { type:'load-fen'; value:string }
  | { type:'move'; value:string; source:'notation'|'jev'; fen?:string; explanation?:string };

/** Parse local commands/notation; delegate all genuinely free-form text to JEV. */
export async function modelInput(raw:string, chess:Chess, server?:MoveResolver):Promise<InputIntent> {
  const text = String(raw).trim();
  const lower = text.toLowerCase();
  if (!text) return { type: 'empty' };
  if (/^\/(quit|exit)$/.test(lower)) return { type: 'quit' };
  if (lower === '/help') return { type: 'help' };
  if (lower === '/undo') return { type: 'undo' };
  if (/^\/(back|menu)$/.test(lower)) return { type: 'back' };
  if (/^\/(fen|position)$/.test(lower)) return { type: 'show-fen' };
  if (/^\/(fen|position)\s+/.test(lower)) return { type: 'load-fen', value: text.replace(/^\/(?:fen|position)\s+/i, '').trim() };
  if (lower.startsWith('/')) throw new Error(`Unknown command: ${text}. Type /help to see commands.`);

  const legal = chess.moves();
  const normalized = normalizeNotation(text);
  const exact = legal.find(move => {
    const uci = squareName(move.from) + squareName(move.to) + (move.promotion || '');
    return uci === normalized || chess.san(move, legal) === normalized;
  });
  if (exact) return { type: 'move', value: squareName(exact.from) + squareName(exact.to) + (exact.promotion || ''), source: 'notation' };

  const reason = illegalMoveReason(text, chess);
  if (reason) throw new Error(`${reason} ${suggestionMessage(text, chess)}`);
  if (looksLikeNotation(text)) throw new Error(suggestionMessage(text, chess));

  if (!server) throw new Error(`Chess server is required for natural-language input. ${suggestionMessage(text, chess)}`);
  let result;
  try { result = await server.resolve(text, chess); }
  catch (error) {
    if (error instanceof ResolutionError && error.status === 422) throw new Error(suggestionMessage(text, chess));
    if (error instanceof Error && error.name === 'AbortError') throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail.replace(/[.!]\s*$/, '')}. ${suggestionMessage(text, chess).replace(/^No exact match\. /, '')}`);
  }
  return { type: 'move', value: result.move, fen: result.fen, explanation: result.explanation, source: 'jev' };
}
