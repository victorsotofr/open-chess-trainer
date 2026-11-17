/**
 * Progress as a deterministic fold over attempt events.
 *
 * Shared by the client (Dexie) and the server (SQLite) so both compute exactly the same
 * derived state from the same events, regardless of the order in which they arrived.
 *
 * Rules:
 *  - events are de-duplicated by attemptId (last write with the same id is identical by construction)
 *  - events are ordered by (finishedAt, attemptId)
 *  - first-try = the earliest finished attempt for a puzzle was clean
 *  - SRS boxes follow that order; a late event re-sorts and the fold is simply recomputed
 *  - combo is computed within a run only (runs are device-local)
 *  - days/streaks use the user's IANA timezone
 */

/** Namespaced puzzle id, e.g. "lichess:00sHx" (never a number assigned from selection order). */
export type PuzzleId = string
export const isPuzzleId = (x: unknown): x is PuzzleId => typeof x === 'string' && /^[a-z]+:[A-Za-z0-9_-]{1,40}$/.test(x)

export type AttemptResult = 'clean' | 'hinted' | 'failed'
export type RunKind = 'chapter' | 'review' | 'single' | 'rush'

export interface AttemptEvent {
  attemptId: string // stable across retries / reloads / restores
  puzzleId: PuzzleId
  finishedAt: string // ISO instant
  result: AttemptResult
  mistakes: number
  hints: number // 0..3 (3 = move shown)
  ms: number
  mode: 'guided' | 'test'
  solverMoves: number
  runId: string
  runKind: RunKind
  dailyGoal: number // goal in force when the attempt finished (keeps the fold deterministic)
  deviceId: string
}

export interface PuzzleProgress {
  puzzleId: PuzzleId
  attempts: number
  solved: boolean
  firstTry: boolean // earliest attempt was clean
  lastResult: AttemptResult
  bestHints: number
  box: number // Leitner box (0 = not in review)
  due: string | null // local day (YYYY-MM-DD)
}

export interface Progress {
  puzzles: Map<PuzzleId, PuzzleProgress>
  xp: number
  xpLog: { day: string; xp: number }[] // per-day totals, ascending
  days: Map<string, number> // local day -> puzzles finished
  streak: number // consecutive active days ending at lastDay
  lastDay: string | null
  bestCombo: number
  events: AttemptEvent[] // ordered, de-duplicated
  perEvent: Map<string, { xp: number; combo: number; bonus: number }>
}

export const INTERVALS = [1, 3, 7, 16, 35]
export const DAILY_GOAL_BONUS = 20

/** Local calendar day of an instant in a timezone, as YYYY-MM-DD. */
export function dayIn(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function orderEvents(events: AttemptEvent[]): AttemptEvent[] {
  const byId = new Map<string, AttemptEvent>()
  for (const e of events) byId.set(e.attemptId, e)
  return [...byId.values()].sort((a, b) => (a.finishedAt < b.finishedAt ? -1 : a.finishedAt > b.finishedAt ? 1 : a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0))
}

/** Combo multiplier for the n-th consecutive clean solve in a run. */
export const comboMultiplier = (combo: number) => (combo >= 10 ? 2 : combo >= 5 ? 1.5 : combo >= 3 ? 1.25 : 1)

/** XP for one attempt (honesty rules: shown solutions earn a token, hints and mistakes cost). */
export function xpFor(o: { mode: 'guided' | 'test'; solverMoves: number; mistakes: number; hints: number; firstAttempt: boolean; review: boolean; alreadySolved: boolean }): number {
  if (o.hints >= 3) return 2
  if (o.review) return o.mistakes === 0 && o.hints === 0 ? 8 : 3
  if (o.alreadySolved) return 2
  let xp = (o.mode === 'test' ? 15 : 10) + 5 * (o.solverMoves - 1)
  if (o.mistakes === 0 && o.hints === 0) {
    xp += 5
    if (o.firstAttempt) xp = Math.round(xp * 1.5)
  }
  xp = Math.round(xp * Math.pow(0.7, o.hints))
  if (o.mistakes > 0) xp = Math.round(xp * 0.6)
  return Math.max(xp, 1)
}

function schedule(p: Pick<PuzzleProgress, 'box' | 'due'>, result: AttemptResult, day: string) {
  if (result !== 'clean') return { box: 1, due: addDays(day, INTERVALS[0]) }
  if (p.box === 0) return { box: 0, due: null }
  if (p.due && day < p.due) return { box: p.box, due: p.due } // practised early: schedule unchanged
  const next = p.box + 1
  if (next > INTERVALS.length) return { box: 0, due: null }
  return { box: next, due: addDays(day, INTERVALS[next - 1]) }
}

export function fold(input: AttemptEvent[], timeZone: string): Progress {
  const events = orderEvents(input)
  const puzzles = new Map<PuzzleId, PuzzleProgress>()
  const days = new Map<string, number>()
  const xpByDay = new Map<string, number>()
  const comboByRun = new Map<string, number>()
  const perEvent = new Map<string, { xp: number; combo: number; bonus: number }>()
  let xp = 0
  let bestCombo = 0
  for (const e of events) {
    const day = dayIn(e.finishedAt, timeZone)
    const prev = puzzles.get(e.puzzleId)
    const base = xpFor({ mode: e.mode, solverMoves: e.solverMoves, mistakes: e.mistakes, hints: e.hints,
      firstAttempt: !prev, review: e.runKind === 'review', alreadySolved: !!prev?.solved })
    const combo = e.result === 'clean' ? (comboByRun.get(e.runId) ?? 0) + 1 : 0
    comboByRun.set(e.runId, combo)
    bestCombo = Math.max(bestCombo, combo)
    const count = (days.get(day) ?? 0) + 1
    days.set(day, count)
    const bonus = count === e.dailyGoal ? DAILY_GOAL_BONUS : 0
    const gained = Math.round(base * comboMultiplier(combo)) + bonus
    xp += gained
    xpByDay.set(day, (xpByDay.get(day) ?? 0) + gained)
    perEvent.set(e.attemptId, { xp: gained - bonus, combo, bonus })
    puzzles.set(e.puzzleId, {
      puzzleId: e.puzzleId,
      attempts: (prev?.attempts ?? 0) + 1,
      solved: true,
      firstTry: prev ? prev.firstTry : e.result === 'clean',
      lastResult: e.result,
      bestHints: prev ? Math.min(prev.bestHints, e.hints) : e.hints,
      ...schedule(prev ?? { box: 0, due: null }, e.result, day),
    })
  }
  const sortedDays = [...days.keys()].sort()
  const lastDay = sortedDays.at(-1) ?? null
  let streak = 0
  if (lastDay) {
    streak = 1
    while (days.has(addDays(lastDay, -streak))) streak++
  }
  const xpLog = [...xpByDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, x]) => ({ day, xp: x }))
  return { puzzles, xp, xpLog, days, streak, lastDay, bestCombo, events, perEvent }
}

/** Streak as shown today: broken if the last active day is before yesterday. */
export function liveStreak(p: Pick<Progress, 'streak' | 'lastDay'>, today: string): number {
  if (!p.lastDay) return 0
  return p.lastDay === today || addDays(p.lastDay, 1) === today ? p.streak : 0
}

export const isDue = (p: PuzzleProgress, today: string) => p.box > 0 && p.due !== null && p.due <= today
