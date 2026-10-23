# ZChess CLI

Play chess against the Stockfish engine from your terminal. The published
package includes the CLI and installs Stockfish automatically.

```sh
npm install --global zchess
chess
```

Requires Node.js 22.13 or newer. The menu lets you choose a skill level and
color, or load a saved game. Games are saved in
`~/.local/share/zchess/games.sqlite`.

You can also install with Homebrew from a release:

```sh
brew install --formula https://github.com/kennylwx/zchess/releases/latest/download/zchess.rb
```

Stockfish runs locally. Plain-English move descriptions need the Chess server;
SAN and UCI moves work offline.

Terminal graphics default to `--graphics auto`: the CLI probes the active terminal
for Kitty graphics support only when identified as Kitty or Ghostty. Unknown
emulators stay on text without receiving APC queries, because QTerminal 2.1.0
was observed to leak query payloads into shell scrollback. A known identifier
only permits probing; a successful runtime reply is still required. Names alone do not
enable images. Unsupported terminals, redirected streams, tmux, screen and Konsole use the
text board. `--graphics text` skips probing; `--graphics kitty` explicitly forces
the protocol on an interactive terminal (use only if you know it supports it).

Konsole defaults to text because testing in 25.04.2 found that it acknowledged
Kitty queries but ignored the requested image sizing, clipping the board over
the input field. Forced Kitty mode can still exhibit this issue in Konsole.

The CLI queries cell pixel dimensions at startup and on image-board resize, then
specifies only one image dimension so the PNG stays square. If cell size is not
reported, sizing uses an approximate 2:1 cell ratio; image aspect is still preserved,
but available-space estimates can be less accurate with unusual fonts. The text
board also uses approximate proportions and depends on the terminal font.

Help, returning to menus and exit delete the board image. If the native PNG
renderer cannot load, play continues with the text board. A protocol response
establishes capability, not visual correctness in every terminal/version.

When you start an interactive session, Chess checks npm for a newer version and
shows the command to install it in the main menu. Alpha installations also check
the alpha channel; stable installations only check stable releases. Homebrew
installations show a command to reinstall the latest release formula instead.
The check times out after 800 ms and failures are silent, so you can still play
offline. Set `ZCHESS_NO_UPDATE_CHECK=1` to disable it. Help and noninteractive
sessions do not check for updates. Updates are never installed automatically.


Unicode text boards require a terminal font containing chess symbols. The XTerm
398 Unicode check used DejaVu Sans Mono 11; its default bitmap font showed missing
glyph boxes. For fonts without chess symbols, use `chess --graphics ascii`.
This disables image probing and uses uppercase `KQRBNP` for white, lowercase
`kqrbnp` for black, and ASCII board labels/markers. It changes the board only;
other CLI messages can still contain Unicode. Font support is not auto-detected.

## Configure natural-language moves

The npm CLI bundles Stockfish, not a hosted language model or Chess server.
SAN/UCI (`Nf3`, `e2e4`) works offline. Free-form instructions are sent to a
separate Chess server, which asks TypeSafe JEV to choose among legal moves.
Local move suggestions are deterministic suggestions, not LLM inference, and
are never silently played as a substitute.

Set `--server URL` or `ZCHESS_SERVER_URL` to a Chess server **base URL** you own
or have permission to use. The flag takes precedence over the environment.
The launcher also loads `.env` from the current directory; existing environment
variables take precedence. Without configuration, no natural-language request
is made, including to localhost. The CLI does not launch a backend automatically.

For a local backend from this repository, install dependencies with `pnpm install`
and `pnpm run setup`. Supply `TYPESAFE_API_KEY` to the **server process** through
your own secure environment/secret-management setup. Then, from the repository
root, start the server on a port you have selected:

```sh
uv run uvicorn chess_server.main:app --host 127.0.0.1 --port 8765 --app-dir apps/server
```

In another terminal, connect the CLI explicitly:

```sh
ZCHESS_SERVER_URL=http://127.0.0.1:8765 chess
# Or start a game directly:
chess --server http://127.0.0.1:8765
```

The server defaults to `TYPESAFE_BASE_URL=https://api.typesafe.ai/v1` and
`TYPESAFE_MODEL=jev-latest`; use values supported by your provider account.
A TypeSafe key in the CLI environment alone does not start/configure a separate
server. Never put provider credentials in `--server`, a URL, or browser variables.
The CLI currently sends no authentication header to the Chess server. If your
chosen backend is behind an authenticated gateway, its supported client access
must be configured separately; do not bypass its access policy. A 401/403 from
an arbitrary local service does not establish that it is a Chess server.

A real language-model demo requires a reachable backend with working provider
configuration. Test an unambiguous **legal** instruction in the actual position
(e.g. `pawn to e4` from the initial board). `knight to e4` is not legal from the
initial board, and `bishop take queen` only works when exactly one legal bishop
capture matches. Ambiguous/illegal requests must not move the board.

The website is separately configured with `VITE_ZCHESS_SERVER_URL` at build time
and an appropriate server `ZCHESS_ORIGINS` value. Publishing this CLI does not
configure or deploy that backend or rebuild the website.
