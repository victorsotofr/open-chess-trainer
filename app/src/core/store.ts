/**
 * Local persistence (IndexedDB via Dexie). The storage contract:
 *  - events:   AttemptEvent, keyed by attemptId (idempotent)
 *  - outbox:   events not yet acknowledged by the server
 *  - sessions: the durable SessionRecord of the active learning run
 *  - settings: profile (deviceId, timezone, daily goal, free play, theme, sound)
 * Progress (XP, streak, SRS, stars) is never stored: it is folded from events (shared/progress.ts).
 */
import Dexie, { liveQuery, type Table } from 'dexie'
import { useEffect, useState } from 'react'
import type { AttemptEvent, RunKind } from '@shared/progress'
import { START_FEN, type GameRecord } from '@shared/game'
import { SESSION_SCHEMA_VERSION, upgradeSession, type PuzzleProgressRecord, type SessionRecord } from '@shared/session'

export interface Profile {
  key: 'profile'
  deviceId: string
  timeZone: string
  dailyGoal: number
  freePlay: boolean
  theme: 'dark' | 'light'
  sound: boolean
}

/** v1 record (single "current" game), kept only for the migration below. */
interface GameRecordV1 { id: 'current'; schemaVersion: 1; gameId: string; color: 'white' | 'black'; level: number; moves: string[]
  result: null | { winner: 'white' | 'black' | null; reason: string }; startedAt: string; updatedAt: string }

/** Per-position evaluation (White's point of view), best move and line. */
export interface GameAnalysis { gameId: string; depth: number; positions: ({ cp: number; mate: number | null; best: string; pv: string[] } | null)[] }

interface OutboxEntry { attemptId: string; event: AttemptEvent; queuedAt: string }

class ChessDB extends Dexie {
  gamesV2!: Table<GameRecord & { synced?: boolean }, string>
  analysis!: Table<GameAnalysis, string>
  meta!: Table<{ key: string; value: unknown }, string>
  events!: Table<AttemptEvent, string>
  outbox!: Table<OutboxEntry, string>
  sessions!: Table<SessionRecord, string>
  settings!: Table<Profile, string>
  constructor() {
    super('open-chess-trainer') // own IndexedDB name: never shares data with other local apps
    // v1 (milestone 1): puzzles / profile / attempts. Kept so the upgrade below can read them.
    this.version(1).stores({ puzzles: 'id, box, due', profile: 'id', attempts: '++id, puzzleId, at' })
    this.version(2)
      .stores({ events: '&attemptId, puzzleId, finishedAt', outbox: '&attemptId', sessions: '&id', settings: '&key',
        puzzles: null, profile: null, attempts: null })
      .upgrade(async (tx) => {
        const old = (await tx.table('attempts').toArray()) as { puzzleId: number; at: string; result: AttemptEvent['result']; mistakes: number; hints: number; ms: number; review: boolean }[]
        const prof = (await tx.table('profile').get('me')) as { dailyGoal?: number; freePlay?: boolean } | undefined
        const deviceId = crypto.randomUUID()
        await tx.table('settings').put(defaultProfile({ deviceId, dailyGoal: prof?.dailyGoal ?? 10, freePlay: !!prof?.freePlay }))
        await tx.table('events').bulkPut(old.map((a, i): AttemptEvent => ({
          attemptId: `v1-${i}-${a.at}`, puzzleId: a.puzzleId, finishedAt: a.at, result: a.result, mistakes: a.mistakes, hints: a.hints,
          ms: a.ms, mode: 'test', solverMoves: 1, runId: `v1-${a.at}`, runKind: a.review ? 'review' : 'chapter', dailyGoal: prof?.dailyGoal ?? 10, deviceId })))
      })
    // v3: games vs the computer (guest-friendly, device-local)
    this.version(3).stores({ games: '&id' })
    // v4: one row per game (history), keyed by gameId; the old single "current" game is migrated
    this.version(4).stores({ games: null, gamesV2: '&gameId, status, updatedAt' }).upgrade(async (tx) => {
      const old = (await tx.table('games').toArray().catch(() => [])) as GameRecordV1[]
      await tx.table('gamesV2').bulkPut(old.filter((g) => g && Array.isArray(g.moves)).map((g): GameRecord => ({
        gameId: g.gameId, schemaVersion: 2, status: g.result ? 'finished' : 'active', color: g.color, level: g.level, initialFen: START_FEN,
        timeControl: null, clocks: null, moves: g.moves, result: g.result, startedAt: g.startedAt, updatedAt: g.updatedAt, endedAt: g.result ? g.updatedAt : null })))
    })
    // v5: cached engine analysis of finished games (device-local; recomputable)
    this.version(5).stores({ analysis: '&gameId' })
    // v6: sync bookkeeping (account that owns this local data, incremental-pull cursors)
    this.version(6).stores({ meta: '&key' })
  }
}

export const db = new ChessDB()

export function defaultProfile(p: Partial<Profile> = {}): Profile {
  return { key: 'profile', deviceId: crypto.randomUUID(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dailyGoal: 10, freePlay: false, theme: 'dark', sound: false, ...p }
}

export async function getProfile(): Promise<Profile> {
  const p = await db.settings.get('profile')
  if (p) return p
  const fresh = defaultProfile()
  await db.settings.put(fresh)
  return fresh
}

export async function updateProfile(patch: Partial<Omit<Profile, 'key' | 'deviceId'>>) {
  const p = await getProfile()
  await db.settings.put({ ...p, ...patch })
}

// ── sessions ────────────────────────────────────────────────────────────────

export async function loadSession(): Promise<SessionRecord | null> {
  const raw = await db.sessions.get('learn')
  if (!raw) return null
  const up = upgradeSession(raw)
  if (!up.ok) { await db.sessions.delete('learn'); return null } // unsupported: closed cleanly, no penalty
  return up.record
}

export async function startRun(o: { kind: RunKind; queue: number[]; chapter: number | null; contentVersion: string; startIndex?: number }) {
  const p = await getProfile()
  const now = new Date().toISOString()
  const rec: SessionRecord = { id: 'learn', schemaVersion: SESSION_SCHEMA_VERSION, contentVersion: o.contentVersion, deviceId: p.deviceId,
    runId: crypto.randomUUID(), runKind: o.kind, chapter: o.chapter, queue: o.queue, index: o.startIndex ?? 0, puzzle: null, startedAt: now, updatedAt: now }
  await db.sessions.put(rec)
  return rec
}

export async function savePuzzleRecord(puzzle: PuzzleProgressRecord) {
  await db.sessions.update('learn', { puzzle, updatedAt: new Date().toISOString() })
}

export async function advanceRun(index: number) {
  await db.sessions.update('learn', { index, puzzle: null, updatedAt: new Date().toISOString() })
}

export async function endRun() { await db.sessions.delete('learn') }

/**
 * Commit a finished attempt atomically: event + outbox entry + session record, or nothing.
 * Re-committing the same attemptId is a no-op for derived progress (events keyed by attemptId).
 */
export async function commitAttempt(record: PuzzleProgressRecord, meta: { solverMoves: number; mode: 'guided' | 'test'; run?: { runId: string; runKind: RunKind } }) {
  if (!record.outcome) throw new Error('commitAttempt: attempt has no outcome')
  await db.transaction('rw', db.events, db.outbox, db.sessions, db.settings, async () => {
    const p = await getProfile()
    const s = await db.sessions.get('learn')
    const event: AttemptEvent = {
      attemptId: record.attemptId, puzzleId: record.puzzleId, finishedAt: record.outcome!.finishedAt, result: record.outcome!.result,
      mistakes: record.mistakes, hints: record.hints, ms: Date.parse(record.outcome!.finishedAt) - Date.parse(record.startedAt),
      mode: meta.mode, solverMoves: meta.solverMoves, runId: meta.run?.runId ?? s?.runId ?? 'single', runKind: meta.run?.runKind ?? s?.runKind ?? 'single',
      dailyGoal: p.dailyGoal, deviceId: p.deviceId,
    }
    await db.events.put(event)
    await db.outbox.put({ attemptId: event.attemptId, event, queuedAt: new Date().toISOString() })
    if (s?.puzzle?.attemptId === record.attemptId) await db.sessions.update('learn', { puzzle: { ...record, saved: true }, updatedAt: new Date().toISOString() })
  })
}

// ── backup ──────────────────────────────────────────────────────────────────

export async function exportProgress(): Promise<string> {
  const [events, settings] = await Promise.all([db.events.toArray(), db.settings.toArray()])
  return JSON.stringify({ app: 'open-chess-trainer', version: 2, exportedAt: new Date().toISOString(), events, settings }, null, 1)
}

/** Import merges events by attemptId (idempotent): importing twice changes nothing. */
export async function importProgress(json: string) {
  const d = JSON.parse(json)
  if (d.app !== 'open-chess-trainer' || d.version !== 2 || !Array.isArray(d.events)) throw new Error('Not an Open Chess Trainer backup')
  await db.transaction('rw', db.events, db.settings, async () => {
    await db.events.bulkPut(d.events)
    const prof = (d.settings as Profile[]).find((s) => s.key === 'profile')
    if (prof) { const cur = await getProfile(); await db.settings.put({ ...prof, deviceId: cur.deviceId }) }
  })
}

// ── live queries ────────────────────────────────────────────────────────────

export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [v, setV] = useState<T>(initial)
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setV, error: (e) => console.error(e) })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return v
}

// ── games vs computer (history) ─────────────────────────────────────────────

/** The game in progress, if any (most recently updated active game). */
export async function activeGame(): Promise<GameRecord | null> {
  const list = await db.gamesV2.where('status').equals('active').toArray()
  return list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null
}
export async function getGame(id: string): Promise<GameRecord | null> { return (await db.gamesV2.get(id)) ?? null }
export async function saveGame(g: GameRecord) { await db.gamesV2.put({ ...g, synced: false }) }
/** Delete a game from history: a synced tombstone (newest updatedAt wins), so other devices drop it too. */
export async function deleteGame(g: GameRecord) { await saveGame({ ...g, status: 'deleted', updatedAt: new Date().toISOString() }) }
/** Abandon a paused game from outside the board (starting a new one): counts as a loss, like on chess.com. */
export async function abandonGame(g: GameRecord) {
  const now = new Date().toISOString()
  await saveGame({ ...g, status: 'abandoned', result: { winner: g.color === 'white' ? 'black' : 'white', reason: 'abandoned' }, endedAt: now, updatedAt: now })
}
export async function listGames(): Promise<GameRecord[]> {
  return (await db.gamesV2.orderBy('updatedAt').reverse().toArray()).filter((g) => g.status !== 'deleted' && (g.moves.length > 0 || g.status === 'active'))
}
/** Merge games from the server: newest updatedAt wins (idempotent). */
export async function mergeGames(remote: GameRecord[]) {
  await db.transaction('rw', db.gamesV2, async () => {
    for (const g of remote) {
      const cur = await db.gamesV2.get(g.gameId)
      if (!cur || cur.updatedAt < g.updatedAt) await db.gamesV2.put({ ...g, synced: true })
    }
  })
}

// ── sync bookkeeping ────────────────────────────────────────────────────────

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  return ((await db.meta.get(key))?.value as T) ?? fallback
}
export async function setMeta(key: string, value: unknown) { await db.meta.put({ key, value }) }

/**
 * Bind local data to the signed-in account. Guest data (no owner yet) is adopted by the first
 * account; a *different* account starts from a clean local copy (its data is on the server),
 * so one person's progress is never uploaded into another's account.
 */
export async function bindOwner(userId: string): Promise<'adopted' | 'same' | 'switched'> {
  const owner = await getMeta<string | null>('owner', null)
  if (owner === userId) return 'same'
  if (owner === null) { await setMeta('owner', userId); return 'adopted' }
  await db.transaction('rw', [db.events, db.outbox, db.sessions, db.gamesV2, db.analysis, db.meta], async () => {
    await Promise.all([db.events.clear(), db.outbox.clear(), db.sessions.clear(), db.gamesV2.clear(), db.analysis.clear(), db.meta.clear()])
    await db.meta.put({ key: 'owner', value: userId })
  })
  return 'switched'
}
