# Open Chess Trainer

**A free, open-source course that teaches chess tactics step by step:** understand an idea, see it worked out, practise it with help, solve it alone, then recognize it when nobody tells you what to look for. Play Stockfish to put it into practice.

> **Status: early development.** The app shell, Play vs Stockfish, game review, Stats and Feedback work today. The course content (puzzle pack and lessons) is being built; see [Roadmap](#roadmap).

## What it will do
- **A guided course, skill by skill.** Board habits first (checks, captures, threats, undefended pieces), then forks, pins, skewers and discovered attacks, deeper tactical ideas, mating patterns, and combinations.
- **The same six steps in every chapter:**
  1. **Understand:** a short, original lesson.
  2. **See:** worked examples you step through.
  3. **Guided:** puzzles with a hint ladder (idea → piece → move).
  4. **Independent:** fresh puzzles, no help.
  5. **Recognize:** a mixed set where the theme isn't announced.
  6. **Revisit:** spaced review of what you missed.
- **Honest feedback.** Course puzzles are checked by Stockfish in advance: another winning move is accepted, and a wrong move is explained. Elsewhere, any checkmate counts, and a non-matching move is reported as such, never with an invented refutation.
- **Motivation:** XP, streaks, daily quests, Puzzle Rush.
- **Play vs Stockfish** at approximate strengths, with clocks, a live material score and a game review that explains each mistake.
- **No account needed.** Progress stays in your browser; signing in with Google adds sync across devices.

Three measures are kept separate and never presented as a human rating:
- **course progress:** the skills you have demonstrated;
- **puzzle rating:** your performance on this trainer's puzzles;
- **Stockfish level:** an approximate practice difficulty.

## Sources and credits
| What | Source |
|---|---|
| Puzzles | [Lichess puzzle database](https://database.lichess.org/#puzzles), public domain (CC0), taken from real games |
| Lessons and teaching positions | Original to this project |
| Engine | [Stockfish](https://github.com/official-stockfish/Stockfish) (GPLv3): WebAssembly in the browser, native in the pipeline |
| Board | [chessground](https://github.com/lichess-org/chessground) by lichess.org (GPLv3) |

All dependencies and licenses are listed in [THIRD_PARTY.md](THIRD_PARTY.md).

## Tech stack
| Layer | Choices |
|---|---|
| App | React 18, TypeScript, Vite, Tailwind CSS v4, TanStack Router, XState v5 (each behaviour is a state machine), Dexie (IndexedDB), chessground, chess.js, Stockfish WASM in a Web Worker |
| Server | Node 22, Hono, Better Auth (Google sign-in), SQLite (better-sqlite3) |
| Pipeline | Python 3.9+, python-chess, Stockfish (native) |
| Delivery | One Docker image (app + API) |

## Running it
```bash
cp .env.example .env                       # AUTH_MODE=local: single user, no sign-in
docker compose up --build                  # http://127.0.0.1:8090
```
Development:
```bash
cd server && npm ci && AUTH_MODE=local PORT=8790 npm run dev
cd app && npm ci && npm run dev            # http://localhost:5190 (proxies /api to :8790)
cd app && npm test; cd ../server && npm test
```
This project uses its own ports (8090, 5190/8790), Compose project and volume (`chess-puzzles_db`), browser database (`open-chess-trainer`) and auth cookie prefix (`oct`). It can run next to other local apps without sharing data.

## Feedback loop
Users send bugs and ideas from the **Feedback** button. You and your coding agents triage them with `cd server && npm run feedback -- list | next | show | set` (needs `FEEDBACK_ADMIN_TOKEN`); the procedure is in `.agents/skills/feedback-loop/SKILL.md`. Mirroring reports to GitHub issues is optional and **off by default**.

## Roadmap
1. **Data model:** puzzle ids like `lichess:00sHx`; each puzzle keeps the position before and after the opponent's first move.
2. **Coverage report** of the Lichess dump, then the curriculum.
3. **Pilot pack:** 2–3 chapters with original lessons and engine-verified judging.
4. **Small public beta** with friends.
5. **More chapters, then:** puzzle rating (Glicko-2), weakness-based quests, theme mastery, daily puzzle.

## License
GNU GPL v3 (`LICENSE`), as required by Stockfish and chessground. The puzzle data is CC0.
