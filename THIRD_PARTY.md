# Third-party software and data

Open Chess Trainer is free software under the **GNU GPL v3** (`LICENSE`). It distributes or depends on the following. Exact versions are pinned in `app/package-lock.json` and `server/package-lock.json`; this list is checked before every public release.

## Data
| What | License | Source |
|---|---|---|
| Lichess puzzle database | CC0 (public domain) | https://database.lichess.org/#puzzles |

## Shipped in the web app
| Package | License | Source |
|---|---|---|
| stockfish (WebAssembly build of Stockfish) | GPL-3.0 | https://github.com/nmrugg/stockfish.js · engine: https://github.com/official-stockfish/Stockfish |
| @lichess-org/chessground | GPL-3.0 | https://github.com/lichess-org/chessground |
| chess.js | BSD-2-Clause | https://github.com/jhlywa/chess.js |
| react, react-dom | MIT | https://github.com/facebook/react |
| xstate, @xstate/react | MIT | https://github.com/statelyai/xstate |
| @tanstack/react-router | MIT | https://github.com/TanStack/router |
| dexie | Apache-2.0 | https://github.com/dexie/Dexie.js |
| motion | MIT | https://github.com/motiondivision/motion |
| @base-ui/react | MIT | https://github.com/mui/base-ui |
| lucide-react | ISC | https://github.com/lucide-icons/lucide |
| Geist, Geist Mono (@fontsource-variable) | OFL-1.1 | https://github.com/vercel/geist-font |
| Departure Mono | OFL-1.1 | https://github.com/rektdeckard/departure-mono |

## Server
| Package | License | Source |
|---|---|---|
| hono, @hono/node-server | MIT | https://github.com/honojs/hono |
| better-auth | MIT | https://github.com/better-auth/better-auth |
| better-sqlite3 | MIT | https://github.com/WiseLibs/better-sqlite3 |
| tsx | MIT | https://github.com/privatenumber/tsx |

## Pipeline (not distributed)
python-chess (GPL-3.0), Stockfish native build (GPL-3.0), zstandard (BSD-3-Clause).

The full license texts are included with each package in `node_modules/` and will be collected into `licenses/` by the release script before the first public release.
