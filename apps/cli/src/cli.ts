import { checkForUpdate, type UpdateNotice } from './update.js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Chess, START_FEN } from '@zchess/chess';
import { modelInput } from './input.js';
import { ChessServerClient, serverUrlFromArgs } from './api.js';
import { render } from './ui.js';
import { clearGraphics, renderGraphics, type GraphicsMode } from './graphics.js';
import { detectGraphics } from './terminal.js';
import { engineMove } from './engine.js';
import { GameScreen, MenuScreen } from './screen.js';
import { moveHistory, undoTurn } from './history.js';
import { GameStore, type SavedGame } from './store.js';
import type { Key } from 'node:readline';

const HELP = `chess — terminal chess

Usage: chess [--elo 1500] [--color white|black] [--fen FEN]
             [--server URL] [--depth 12] [--graphics auto|kitty|text|ascii]

Run "chess" with no options to open the Play / Load game menu.
Moves accept UCI (e2e4), SAN (Nf3), or free text ("move the queen up by 1").
Stockfish is included and runs locally. Free text requires a configured Chess server.
Set --server URL or ZCHESS_SERVER_URL; the backend needs TYPESAFE_API_KEY.
Games are saved automatically in ~/.local/share/zchess/games.sqlite.
Commands: /fen, /fen <position>, /undo, /help, /back, /quit`;

export function commandHelp(): string {
  return [
    'COMMANDS',
    '/help         Show this list',
    '/undo         Take back a turn',
    '/fen          Show the current position',
    '/fen <FEN>    Load a position',
    '/back         Return to the previous screen',
    '/quit         Quit Chess',
    '',
    'SHORTCUTS',
    'Ctrl+C        Quit',
    'Ctrl+U        Clear input',
  ].join('\n');
}

export function editGameInput(value: string, text: string, key: Key): string {
  if ((key?.ctrl && key.name === 'u') || (key?.meta && key.name === 'backspace')) return '';
  if (key?.name === 'backspace') return [...value].slice(0, -1).join('');
  if (!key?.ctrl && !key?.meta && text && !/[\x00-\x1f\x7f]/.test(text)) return value + text;
  return value;
}

const promptColor = '\x1b[39m';
const reset = '\x1b[0m';
const ELO_PRESETS = [
  { label: 'Beginner', elo: 1320 },
  { label: 'Intermediate', elo: 1500 },
  { label: 'Advanced', elo: 1800 },
  { label: 'Expert', elo: 2200 },
  { label: 'Master', elo: 3190 },
];
interface GameConfig { elo: number; human: 'w' | 'b'; saved?: SavedGame; fen?: string }

export async function run(args: string[], installation?: { version: string; homebrew?: boolean }): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  const get = (name: string, fallback: string | undefined): string | undefined => {
    const index = args.indexOf(name);
    return index < 0 ? fallback : (args[index + 1] ?? fallback);
  };
  const serverUrl = serverUrlFromArgs(args);
  const graphics = get('--graphics', 'auto') as GraphicsMode;
  if (!['auto', 'kitty', 'text', 'ascii'].includes(graphics)) throw new Error('Graphics must be auto, kitty, text, or ascii.');
  const depth = Number(get('--depth', '12'));
  if (!Number.isInteger(depth) || depth < 1 || depth > 30) throw new Error('Depth must be an integer from 1 to 30.');
  let cellAspect = 2;
  const useGraphics = await detectGraphics(graphics, stdin, stdout, process.env, 300, ratio => { cellAspect = ratio; });

  const update = installation && stdin.isTTY && stdout.isTTY && process.env.ZCHESS_NO_UPDATE_CHECK !== '1'
    ? await checkForUpdate(installation.version, { homebrew: installation.homebrew }) : undefined;
  const store = new GameStore(get('--db', undefined));
  const direct = args.some(arg => arg.startsWith('--'));
  const interactiveMenu = !direct && stdin.isTTY && stdout.isTTY;
  const menuScreen = interactiveMenu ? new MenuScreen(true) : undefined;
  menuScreen?.open();
  if (update && !interactiveMenu) console.log(`Update available: ${installation!.version} → ${update.version}\nRun: ${update.command}`);

  try {
    let keepGoing = true;
    let returnToSavedGames = false;
    while (keepGoing) {
      let config: GameConfig | undefined;
      if (direct || !stdin.isTTY || !stdout.isTTY) {
        const elo = Number(get('--elo', '1500'));
        if (!Number.isInteger(elo) || elo < 1320 || elo > 3190) throw new Error('ELO must be an integer from 1320 to 3190 (Stockfish UCI range).');
        config = { elo, human: get('--color', 'white')!.toLowerCase().startsWith('b') ? 'b' : 'w', fen: get('--fen', undefined) };
        keepGoing = false;
      } else {
        const choice = await mainMenu(store, menuScreen!, returnToSavedGames, update, installation?.version);
        returnToSavedGames = false;
        if (choice === 'quit') break;
        config = choice;
      }
      if (config) {
        const again = await playGame(config, { useGraphics, ascii: graphics === 'ascii', cellAspect, depth, serverUrl, store, sharedScreen: interactiveMenu });
        if (again && config.saved) returnToSavedGames = true;
        if (direct || !again) keepGoing = false;
      }
    }
  } finally { menuScreen?.close(); store.close(); }
}

async function mainMenu(store: GameStore, screen: MenuScreen, openSavedGames = false, update?: UpdateNotice, installed?: string): Promise<GameConfig | 'quit'> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      if (openSavedGames) {
        openSavedGames = false;
        const game = await savedGamesMenu(store, screen);
        if (game === 'quit') return 'quit';
        if (game) return game;
        continue;
      }
      const notice = update ? `\n\nUpdate available: ${installed} → ${update.version}\nRun: ${update.command}` : '';
      screen.draw('ZCHESS  /  LOCAL STOCKFISH', '  1  Play\n  2  Load a saved game\n  3  Quit' + notice, '');
      const choice = await menuKey('Select › ', ['1', '2', '3']);
      if (choice === 'q') return 'quit';
      if (choice === 'b') continue;
      if (choice === '3') return 'quit';
      if (choice === '1') {
        const game = await newGameMenu(screen);
        if (game === 'quit') return 'quit';
        if (game) return game;
      }
      if (choice === '2' || choice === 'load') {
        const game = await savedGamesMenu(store, screen);
        if (game === 'quit') return 'quit';
        if (game) return game;
      }
    }
  } finally { rl.close(); }
}

async function savedGamesMenu(store: GameStore, screen: MenuScreen): Promise<GameConfig | 'quit' | null> {
  const games = store.list();
  if (!games.length) {
    screen.draw('LOAD A SAVED GAME', 'No saved games yet.\n\n  1  Back\n  2  Quit', '');
    const action = await menuKey('Select › ', ['1', '2']);
    return action === '2' || action === 'q' ? 'quit' : null;
  }
  const recent = games.slice(0, 7);
  const lines = recent.map((game, index) => `  ${index + 1}  ${game.updatedAt.slice(0, 16).replace('T', ' ')} · ${game.elo} ELO · ${game.moves.length ? game.moves.join(' ') : 'New game'} · ${game.status}`);
  if (games.length > recent.length) lines.push('  Showing the 7 most recent games.');
  const backChoice = recent.length + 1;
  const quitChoice = recent.length + 2;
  lines.push(`  ${backChoice}  Back`, `  ${quitChoice}  Quit`);
  screen.draw('LOAD A SAVED GAME', lines.join('\n'), '');
  const selection = await menuKey('Choose a game › ', Array.from({ length: quitChoice }, (_, index) => String(index + 1)));
  if (selection === 'q') return 'quit';
  if (Number(selection) === backChoice) return null;
  if (Number(selection) === quitChoice) return 'quit';
  const game = recent[Number(selection) - 1];
  return game ? { elo: game.elo, human: game.color, saved: game } : null;
}

async function newGameMenu(screen: MenuScreen): Promise<GameConfig | null | 'quit'> {
  const choices = ELO_PRESETS.map(({ label, elo }, index) => `  ${index + 1}  ${label} · ${elo} ELO`);
  choices.push('  6  Custom ELO');
  choices.push('  7  Back', '  8  Quit');
  screen.draw('NEW GAME  /  STOCKFISH STRENGTH', `${choices.join('\n')}\n\nAvailable range: 1320–3190 ELO`, '');
  const selection = await menuKey('ELO › ', ['1', '2', '3', '4', '5', '6', '7', '8']);
  if (selection === 'q') return 'quit';
  if (selection === '7') return null;
  if (selection === '8') return 'quit';
  let elo = ELO_PRESETS[Number(selection) - 1]?.elo;
  if (selection === '6') {
    let custom: number;
    while (true) {
      screen.draw('NEW GAME  /  CUSTOM ELO', 'Enter any ELO from 1320 to 3190.\n\n  0   Back\n  00  Quit', '');
      const value = await menuText('ELO › ');
      if (value === 'q') return 'quit';
      if (value === 'b' || value === null) return await newGameMenu(screen);
      custom = Number(value);
      if (Number.isInteger(custom) && custom >= 1320 && custom <= 3190) break;
      screen.draw('NEW GAME  /  CUSTOM ELO', 'Enter an ELO from 1320 to 3190.\nThat value is outside the range.\n\n  0   Back\n  00  Quit', '');
    }
    elo = custom;
  }
  if (elo === undefined) return null;
  while (true) {
    screen.draw('NEW GAME  /  CHOOSE SIDE', `Stockfish ${elo} ELO\n\n  1  White\n  2  Black\n  3  Random\n  4  Back\n  5  Quit`, '');
    const side = await menuKey('Side › ', ['1', '2', '3', '4', '5']);
    if (side === 'q') return 'quit';
    if (side === '4') return await newGameMenu(screen);
    if (side === '5') return 'quit';
    const human: 'w' | 'b' = side === '1' ? 'w' : side === '2' ? 'b' : Math.random() < 0.5 ? 'w' : 'b';
    return { elo, human };
  }
}

function menuKey(prompt: string, choices: string[]): Promise<string> {
  return rawPrompt(prompt, (text, key, finish) => {
    if (key?.ctrl && key.name === 'c') { finish('q'); return; }
    const character = (text ?? '').toLowerCase();
    if (!key?.ctrl && choices.includes(character)) finish(character);
  });
}

function menuText(prompt: string): Promise<string | 'b' | 'q' | null> {
  let value = '';
  return rawPrompt(prompt, (text, key, finish) => {
    if (key?.ctrl && key.name === 'c') { finish('q'); return; }
    if (key?.name === 'backspace') {
      value = value.slice(0, -1);
      stdout.write('\b \b');
      return;
    }
    if (key?.name === 'return' || key?.name === 'enter') {
      finish(value === '0' ? 'b' : value === '00' ? 'q' : value);
      return;
    }
    const character = text ?? '';
    if (key?.ctrl || !character) return;
    value += character;
    stdout.write(character);
  });
}

function rawPrompt<T>(prompt: string, onKey: (text: string, key: Key, finish: (value: T) => void) => void): Promise<T> {
  const stream = stdin as typeof stdin & { setRawMode?: (mode: boolean) => void };
  if (!stream.isTTY || !stream.setRawMode) return Promise.reject(new Error('Menu selection requires an interactive terminal.'));
  const previous = stdin.listeners('keypress') as Array<(...args: any[]) => void>;
  previous.forEach(listener => stdin.removeListener('keypress', listener));
  stdout.write(`${promptColor}${prompt}${reset}`);
  stream.setRawMode(true);
  return new Promise(resolve => {
    let finished = false;
    const finish = (value: T): void => {
      if (finished) return;
      finished = true;
      stdin.removeListener('keypress', listener);
      stream.setRawMode(false);
      [...previous].reverse().forEach(listener => stdin.prependListener('keypress', listener));
      stdout.write('\r\n');
      resolve(value);
    };
    const listener = (text: string, key: Key): void => onKey(text, key, finish);
    stdin.on('keypress', listener);
  });
}

async function playGame(config: GameConfig, options: { useGraphics: boolean; ascii: boolean; cellAspect: number; depth: number; serverUrl: string | undefined; store: GameStore; sharedScreen: boolean }): Promise<boolean> {
  const { elo, human, saved } = config;
  let startFen = saved?.startFen ?? config.fen ?? START_FEN;
  const chess = new Chess(startFen);
  if (saved) for (const move of saved.moves) chess.play(move);
  const abort = new AbortController();
  const server = new ChessServerClient(options.serverUrl, abort.signal);
  const rl = createInterface({ input: stdin, output: stdout });
  const screen = new GameScreen(Boolean(stdout.isTTY && stdin.isTTY), stdout, !options.sharedScreen);
  let useGraphics = options.useGraphics;
  let stopped = false;
  let redrawInput: (() => void) | undefined;
  let last: number[] | null = null;
  let showingHelp = false;
  let returnToMenu = false;
  let returnToMenuRequested = false;
  let search: AbortController | undefined;
  let notice = 'Your move';
  let gameId = saved?.id;
  const header = `CHESS  /  ${human === 'w' ? 'White' : 'Black'}  /  Stockfish ${elo} ELO`;
  const persist = (): void => {
    gameId = options.store.save({ elo, color: human, startFen, fen: chess.fen(), moves: chess.history.map(entry => entry.san), status: chess.status() ?? 'In progress' }, gameId);
  };
  const draw = (): void => {
    let board: string;
    if (showingHelp) board = (useGraphics ? clearGraphics() : '') + commandHelp();
    else {
      try { board = useGraphics ? renderGraphics(chess, human, last, screen.active, options.cellAspect) : ''; }
      catch {
        // A missing native rasterizer must not prevent playing a text game.
        stdout.write(clearGraphics());
        useGraphics = false;
        board = '';
      }
      if (!useGraphics) board = render(chess, { ascii: options.ascii, perspective: human, last, compact: screen.active && (stdout.rows || 40) < 36 });
    }
    screen.draw(header, board, notice, showingHelp ? '' : moveHistory(chess, Math.max(1, (stdout.columns || 80) - 1)));
  };
  const takeBack = (): void => {
    notice = undoTurn(chess, human) ? 'Took back your last move and any Stockfish reply.' : 'No move to undo yet.';
    const move = chess.history.at(-1)?.move;
    last = move ? [move.from, move.to] : null;
    persist();
  };
  const shortcut = (text: string, key: Key): void => {
    if (stopped || returnToMenuRequested) return;
    if (key?.ctrl && key.name === 'c') { stop(); return; }
  };
  const stop = (): void => { stopped = true; abort.abort(); search?.abort(); };
  let resizeTask: Promise<void> | undefined;
  const resize = (): void => {
    if (stopped || resizeTask) return;
    resizeTask = (async () => {
      try {
        if (useGraphics) await detectGraphics('kitty', stdin, stdout, process.env, 300, ratio => { options.cellAspect = ratio; });
        if (!stopped) { draw(); redrawInput?.(); }
      } catch { /* Keep the previous geometry if the terminal stops responding. */ }
    })().finally(() => { resizeTask = undefined; });
  };
  const question = async (placeholder: string): Promise<string> => {
    if (!screen.active) return await rl.question(`${promptColor}${placeholder} › ${reset}`, { signal: abort.signal });
    const stream = stdin as typeof stdin & { setRawMode?: (mode: boolean) => void };
    const previousRaw = stream.isRaw;
    const previous = stdin.listeners('keypress') as Array<(text: string, key: Key) => void>;
    previous.forEach(listener => stdin.removeListener('keypress', listener));
    stream.setRawMode?.(true);
    return new Promise(resolve => {
      let value = '';
      let done = false;
      const redraw = (): void => screen.input(value, placeholder);
      const finish = (answer: string): void => {
        if (done) return;
        done = true;
        stdin.removeListener('keypress', onKey);
        abort.signal.removeEventListener('abort', onAbort);
        previous.forEach(listener => stdin.on('keypress', listener));
        stream.setRawMode?.(previousRaw);
        redrawInput = undefined;
        screen.input('', placeholder);
        resolve(answer);
      };
      const onAbort = (): void => finish('');
      const onKey = (text: string, key: Key): void => {
        if (key?.ctrl && key.name === 'c') { stop(); finish(''); return; }
        if (key?.name === 'return' || key?.name === 'enter') { finish(value); return; }
        value = editGameInput(value, text, key);
        redraw();
      };
      redrawInput = redraw;
      stdin.on('keypress', onKey);
      abort.signal.addEventListener('abort', onAbort, { once: true });
      redraw();
    });
  };
  stdin.on('keypress', shortcut);
  rl.on('SIGINT', stop);
  rl.on('close', stop);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  stdout.on('resize', resize);
  screen.open();
  persist();

  try {
    while (!stopped && !returnToMenuRequested) {
      const status = chess.status();
      if (status) {
        notice = status;
        persist();
        draw();
        if (screen.active) {
          const command = await question('Type /undo, /back, or /quit · Ctrl+C quit');
          if (command.trim().toLowerCase() === '/undo') { takeBack(); continue; }
          if (/^\/(quit|exit)$/.test(command.trim().toLowerCase())) { stop(); break; }
          break;
        }
        console.log(status);
        break;
      }
      if (chess.turn !== human) {
        notice = 'Stockfish is thinking…';
        draw();
        search = new AbortController();
        let move: string;
        try { move = await engineMove(chess.fen(), elo, options.depth, search.signal); }
        catch (error) {
          if (returnToMenuRequested) break;
          throw error;
        } finally { search = undefined; }
        const side = chess.turn;
        const san = chess.play(move);
        const played = chess.history.at(-1)!.move;
        last = [played.from, played.to];
        notice = `${side === 'w' ? 'White' : 'Black'} plays ${san}`;
        persist();
        continue;
      }

      draw();
      let raw: string;
      try { raw = await question(showingHelp ? 'Type /back to return to the game' : 'Type any moves e.g. e4 or e pawn up 2'); }
      catch (error) { if (returnToMenuRequested) break; throw error; }
      const wasShowingHelp = showingHelp;
      showingHelp = false;
      if (wasShowingHelp && /^\/back$/i.test(raw.trim())) { notice = 'Your move'; continue; }
      let intent;
      try { intent = await modelInput(raw, chess, server); }
      catch (error) { notice = message(error); continue; }
      if (stopped) break;
      if (intent.type === 'quit') { stop(); break; }
      if (intent.type === 'help') { notice = 'Available commands'; showingHelp = true; continue; }
      if (intent.type === 'back') { returnToMenuRequested = true; break; }
      if (intent.type === 'show-fen') { notice = chess.fen(); continue; }
      if (intent.type === 'load-fen') {
        try { chess.load(intent.value); startFen = intent.value; last = null; notice = 'Position loaded.'; persist(); }
        catch (error) { notice = message(error); }
        continue;
      }
      if (intent.type === 'undo') { takeBack(); continue; }
      if (intent.type === 'empty') continue;
      try {
        const san = chess.play(intent.value);
        const move = chess.history.at(-1)!.move;
        last = [move.from, move.to];
        notice = intent.source === 'jev' ? `JEV chose ${san}` : `You played ${san}`;
        persist();
      } catch (error) { notice = `${message(error)}. Try e2e4, Nf3, or describe the move.`; }
    }
  } catch (error) { if (!stopped) throw error; }
  finally {
    await resizeTask;
    returnToMenu = screen.active && !stopped;
    stdin.off('keypress', shortcut);
    stdout.off('resize', resize);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    rl.close();
    if (useGraphics) stdout.write(clearGraphics());
    screen.close();
  }
  return returnToMenu || screen.active && returnToMenuRequested;
}

export { HELP };
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
