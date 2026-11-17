/**
 * Durable, versioned record of the active learning session: the storage contract for resume.
 *
 * It holds what happened (moves, hints, mistakes, outcome), never an XState snapshot, so
 * machine definitions can change freely. Restore = replay these facts through the pure
 * puzzle logic (app/src/core/restore.ts).
 */
import type { AttemptResult, RunKind } from './progress'

export const SESSION_SCHEMA_VERSION = 1

export interface PuzzleProgressRecord {
  puzzleId: number
  /** fen + book line; if the book data changes for this puzzle, the record is closed as "restarted". */
  puzzleKey: string
  attemptId: string
  /** Solver moves on the board, in order (UCI). Opponent replies are re-derived from the book. */
  moves: string[]
  hints: number // 0..3
  mistakes: number
  /** true if a book move had to be revealed (engine inconclusive): the attempt can't be clean */
  revealed: boolean
  /** Set once the puzzle is over; `saved` flips true when the attempt event is committed. */
  outcome: null | { kind: 'solved' | 'alternative' | 'revealed' | 'failed'; result: AttemptResult; finishedAt: string; text: string }
  saved: boolean
  startedAt: string
}

export interface SessionRecord {
  id: 'learn' // one active learning session per device
  schemaVersion: number
  contentVersion: string // hash of book.json the session was built against
  deviceId: string
  runId: string
  runKind: RunKind
  chapter: number | null
  queue: number[] // frozen at start
  index: number // position in queue
  puzzle: PuzzleProgressRecord | null
  startedAt: string
  updatedAt: string
}

export type Upgrade = { ok: true; record: SessionRecord } | { ok: false; reason: string }

/** Accept current-version records; older/unknown versions are closed cleanly (no penalty). */
export function upgradeSession(raw: unknown): Upgrade {
  const r = raw as Partial<SessionRecord> | null
  if (!r || typeof r !== 'object') return { ok: false, reason: 'empty' }
  if (r.schemaVersion !== SESSION_SCHEMA_VERSION) return { ok: false, reason: `unsupported schema v${String(r.schemaVersion)}` }
  if (!Array.isArray(r.queue) || typeof r.index !== 'number' || !r.runId) return { ok: false, reason: 'malformed' }
  return { ok: true, record: r as SessionRecord }
}
