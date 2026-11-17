# Open Chess Trainer

Open-source chess tactics course on the Lichess puzzle database (CC0), plus play vs Stockfish. Read `README.md` for the user-facing picture and roadmap; the full plan is in the maintainer's notes (teaching sequence, skills-first curriculum).

## Rules
- **Independent project.** Bootstrapped from a private app; nothing from that app's book content or history may enter this repo. Lessons and teaching positions are original. Puzzles come only from the Lichess dump (CC0), referenced by `lichess:<PuzzleId>`.
- **Own identity.** Compose project `chess-puzzles` (volume `chess-puzzles_db`), image `open-chess-trainer`, ports 8090 (container) / 5190 + 8790 (dev), IndexedDB `open-chess-trainer`, Better Auth cookie prefix `oct`. Never reuse the private app's names.
- **Honest feedback.** Course puzzles: reference solution + precomputed Stockfish verdicts (`pipeline/judge.py`). Reference judging elsewhere: any legal checkmate is accepted; otherwise "doesn't match the solution", never an invented refutation. Rewards never pay for hints or shown solutions.
- **Three measures, never conflated:** course progress, puzzle rating, Stockfish level (approximate). None is presented as a human rating.
- **Explicit config.** `AUTH_MODE` must be `local` or `google`; google without keys exits 78. Progress routes are guarded (`server/src/app.ts`); the puzzle pack is public static data.
- **Feedback mirror to GitHub stays off** until reports have been reviewed.

## State machines (`app/src/machines/`) — one file per behaviour, unit-tested

| Machine | States | Owner (stopped on unmount) |
|---|---|---|
| `puzzleSession` | boot → playing ⇄ judging → replying / bouncing / revealing / wrong → finishing → saving → done / saveFailed | child of `run` |
| `run` | boot → puzzle (invokes puzzleSession) → between → … → complete / exited | `views/Session.tsx` |
| `vsComputer` | boot → setup → playing{decide, yourTurn (your flag), thinking (engine flag)} → over; RESIGN/ABANDON from playing | `views/Play.tsx` |
| `rush` | ready → running{puzzle (one-shot puzzleSession) → next} → over (3 strikes / time) | `views/Rush.tsx` |
| `engine` | booting → ready ⇄ searching (request ids; stale/cancelled results dropped) | child of `vsComputer`, review |
| `auth` | checking → local / signedIn / notInvited / signedOut / noServer | `app/data.tsx` |
| `sync` | paused → idle ⇄ flushing → offline (backoff) / error | `app/data.tsx` (enabled by auth) |
| `bookLoader` (pack loader) | loading → ready / notInstalled / error (static `/data/pack.json`, no sign-in) | `app/data.tsx` |

Durable contracts (versioned, independent of XState): `shared/session.ts` (SessionRecord), `shared/progress.ts` (AttemptEvent + deterministic fold), `shared/game.ts` (GameRecord v2), `shared/rating.ts` (Elo estimate fold). Local data is bound to one account (`bindOwner`). Pure logic: `lib/puzzle.ts`, `lib/gamify.ts`, `core/restore.ts`.

## Layout
- `pipeline/` Python (venv `.venv`): `fetch.py` (download + pin the Lichess dump: `data/dump.json` sha256/date) → `coverage.py` (theme × rating-band counts, `pipeline/out/coverage.md`) → `pack.py` (curriculum selection from `pipeline/curriculum.yaml`, conversion with the setup move applied once, Stockfish verdicts via `judge.py` cached in `pipeline/out/verdicts.json`, lesson parsing/validation from `content/lessons/*.md`, Rush pool) → `app/public/data/pack.json` + `pipeline/out/pack-manifest.json`. `STOCKFISH=/path/to/stockfish` (native build).
- `content/lessons/<slug>.md`: original lessons; `::: example` blocks (fen / moves / caption) become inline step-through boards, validated legal by `pack.py`.
- `app/` Vite + React + TS, Tailwind v4, TanStack Router, XState, Dexie, chessground. `server/` Hono + Better Auth (Google) + better-sqlite3. `shared/` code used by both.

## Commands
```
cd app && npx vitest run && npx tsc -b
cd server && npx vitest run && npx tsc --noEmit
python3 -m pytest -q pipeline/tests            # or .venv/bin/python -m pytest
.venv/bin/python pipeline/fetch.py && .venv/bin/python pipeline/coverage.py
STOCKFISH=… .venv/bin/python pipeline/pack.py   # builds app/public/data/pack.json
docker compose up --build                       # http://127.0.0.1:8090 (Colima: IPv4)
```
Browser e2e scripts run on their own ports (never on a developer's running session).

## Status (2026-11-15)
- Done: bootstrap with own identity; data model (string ids `lichess:<id>`, `initialFen` + `setup` + `fen`, judging policy per puzzle); pipeline (fetch/coverage/pack); pack: 7 chapters (Free pieces, Mate in one, Forks, Pins, Skewers, Discovered attacks, Mate in two) × (Guided 5, On your own 12, Recognize 8 mixed, Boss 1), engine-judged, + Rush pool of 2000 reference-judged puzzles; lessons for the 3 chapters; chapter completion = fresh unassisted solves (`lib/gamify.ts` `completion`), unlocks the next chapter.
- The pack (`app/public/data/pack.json`) and `pipeline/out/pack-manifest.json` are committed and baked into the image (small, CC0); rebuild them only with `pipeline/pack.py`.
- Next: beginner test against the acceptance criterion; public repo + deploy (Google OAuth client, cookie prefix `oct`); more chapters from `coverage.md`; then puzzle rating (Glicko-2), weakness quests, mastery map, daily puzzle.
