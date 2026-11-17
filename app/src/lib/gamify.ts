/**
 * Gamification as pure functions of (events → Progress) and the book.
 * Everything here is deterministic, so it is identical on every device after sync.
 */
import { dayIn, type AttemptEvent, type Progress, type PuzzleId } from '@shared/progress'
import type { Exercise } from './types'

export const TITLES = ['Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King', 'Candidate Master', 'Master']

/** XP needed to reach level n (n >= 1): 0, 100, 250, 450, 700, ... */
export const xpForLevel = (n: number) => 25 * (n - 1) * (n + 2)

export function levelInfo(xp: number) {
  let level = 1
  while (xpForLevel(level + 1) <= xp) level++
  const lo = xpForLevel(level)
  const hi = xpForLevel(level + 1)
  const title = TITLES[Math.min(TITLES.length - 1, Math.floor((level - 1) / 2))]
  return { level, title, into: xp - lo, span: hi - lo, progress: (xp - lo) / (hi - lo) }
}

/** ★ all solved · ★★ ≥80% first try · ★★★ 100% first try. Also used for section medals. */
export function stars(ids: PuzzleId[], progress: Progress): 0 | 1 | 2 | 3 {
  if (ids.length === 0) return 0
  if (!ids.every((id) => progress.puzzles.get(id)?.solved)) return 0
  const first = ids.filter((id) => progress.puzzles.get(id)?.firstTry).length / ids.length
  return first === 1 ? 3 : first >= 0.8 ? 2 : 1
}

export const MEDALS = ['none', 'bronze', 'silver', 'gold'] as const

/** Sections whose puzzles prove a skill: solved alone, from a fresh position. */
export const PROOF_SECTIONS = ['On your own', 'Recognize it']

/**
 * Chapter completion = enough FRESH, UNASSISTED solves in the proof sections: a puzzle counts only if
 * its very first attempt was clean (no hint, no mistake). Re-solving a memorized puzzle never counts,
 * because "first try" is decided by the earliest attempt.
 */
export function completion(exs: Exercise[], progress: Progress, need: number): { fresh: number; need: number; done: boolean } {
  const fresh = exs.filter((e) => PROOF_SECTIONS.includes(e.section) && progress.puzzles.get(e.id)?.firstTry).length
  const target = Math.min(need, exs.filter((e) => PROOF_SECTIONS.includes(e.section)).length) || need
  return { fresh, need: target, done: fresh >= target }
}

export function isUnlocked(index: number, prevStars: number[], freePlay: boolean): boolean {
  return freePlay || index === 0 || (prevStars[index - 1] ?? 0) >= 1
}

// ── daily quests ────────────────────────────────────────────────────────────

export interface Quest { id: string; label: string; target: number; progress: number; done: boolean }

type Template = { id: string; label: (n: number) => string; target: number; measure: (day: AttemptEvent[], all: { combo: Map<string, number> }) => number }

const TEMPLATES: Template[] = [
  { id: 'clean3', label: () => 'Solve 3 puzzles cleanly', target: 3, measure: (d) => d.filter((e) => e.result === 'clean').length },
  { id: 'solve5', label: () => 'Finish 5 puzzles', target: 5, measure: (d) => d.length },
  { id: 'combo3', label: () => 'Reach a ×3 combo', target: 3, measure: (_d, a) => Math.max(0, ...a.combo.values()) },
  { id: 'nohint4', label: () => 'Finish 4 puzzles without hints', target: 4, measure: (d) => d.filter((e) => e.hints === 0).length },
  { id: 'long2', label: () => 'Solve 2 multi-move combinations', target: 2, measure: (d) => d.filter((e) => e.solverMoves > 1 && e.result !== 'failed').length },
  { id: 'guided-test', label: () => 'Solve 2 test puzzles (no guide)', target: 2, measure: (d) => d.filter((e) => e.mode === 'test' && e.result !== 'failed').length },
]
export const QUEST_XP = 15
export const QUEST_ALL_BONUS = 25

function seed(day: string) { let h = 2166136261; for (const c of day) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }

/** Three quests per local day, chosen by a seed of the date only (same on every device). */
export function questsFor(day: string, progress: Progress, timeZone: string): Quest[] {
  const pool = [...TEMPLATES]
  let s = seed(day)
  const picked: Template[] = []
  while (picked.length < 3) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; picked.push(pool.splice(s % pool.length, 1)[0]) }
  const dayEvents = progress.events.filter((e) => dayIn(e.finishedAt, timeZone) === day)
  const combo = new Map<string, number>()
  for (const e of dayEvents) combo.set(e.runId, progress.perEvent.get(e.attemptId)?.combo ?? 0)
  return picked.map((t) => { const p = Math.min(t.target, t.measure(dayEvents, { combo })); return { id: t.id, label: t.label(t.target), target: t.target, progress: p, done: p >= t.target } })
}

/** XP from quests over all days (derived, deterministic). */
export function questXp(progress: Progress, timeZone: string): number {
  let xp = 0
  for (const day of progress.days.keys()) {
    const q = questsFor(day, progress, timeZone)
    const done = q.filter((x) => x.done).length
    xp += done * QUEST_XP + (done === q.length ? QUEST_ALL_BONUS : 0)
  }
  return xp
}

// ── achievements ────────────────────────────────────────────────────────────

export interface Achievement { id: string; name: string; desc: string; earned: boolean }

/** Most puzzles solved in a single rush run. */
function bestRush(progress: Progress): number {
  const runs = new Map<string, number>()
  progress.events.forEach((e) => { if (e.runKind === 'rush' && e.result !== 'failed') runs.set(e.runId, (runs.get(e.runId) ?? 0) + 1) })
  return Math.max(0, ...runs.values())
}

export function achievements(progress: Progress, exercises: Exercise[], goalDays: number, timeZone = 'UTC'): Achievement[] {
  const solved = [...progress.puzzles.values()].filter((p) => p.solved).length
  const clean = progress.events.some((e) => e.result === 'clean')
  const bySection = new Map<string, PuzzleId[]>()
  exercises.forEach((e) => bySection.set(e.section, [...(bySection.get(e.section) ?? []), e.id]))
  const forks = exercises.filter((e) => e.themes?.includes('fork')).map((e) => e.id)
  const chapters = new Map<number, PuzzleId[]>()
  exercises.forEach((e) => chapters.set(e.chapter, [...(chapters.get(e.chapter) ?? []), e.id]))
  const anyChapter = [...chapters.values()].some((ids) => stars(ids, progress) >= 1)
  const anyGoldSection = [...bySection.values()].some((ids) => ids.length >= 3 && stars(ids, progress) === 3)
  const graduated = [...progress.puzzles.values()].some((p) => p.attempts > 1 && p.box === 0 && p.lastResult === 'clean' && !p.firstTry)
  const list: [string, string, string, boolean][] = [
    ['first-blood', 'First move', 'Finish your first puzzle', solved >= 1],
    ['clean', 'Clean hands', 'Solve a puzzle with no hints and no mistakes', clean],
    ['combo5', 'On fire', 'Reach a ×5 combo in one session', progress.bestCombo >= 5],
    ['combo10', 'Unstoppable', 'Reach a ×10 combo', progress.bestCombo >= 10],
    ['streak3', 'Habit', 'Practice 3 days in a row', progress.streak >= 3],
    ['streak7', 'Week of chess', 'Practice 7 days in a row', progress.streak >= 7],
    ['ten', 'Warming up', 'Solve 10 puzzles', solved >= 10],
    ['fifty', 'Pattern hunter', 'Solve 50 puzzles', solved >= 50],
    ['twofifty', 'Tactician', 'Solve 250 puzzles', solved >= 250],
    ['chapter', 'Chapter cleared', 'Earn ★ on any chapter', anyChapter],
    ['gold', 'Gold standard', 'Gold medal on a section (all first try)', anyGoldSection],
    ['forkmaster', 'Fork master', 'All fork puzzles solved first try', forks.length > 0 && stars(forks, progress) === 3],
    ['goal5', 'Committed', 'Hit your daily goal on 5 days', goalDays >= 5],
    ['redeemed', 'Redeemed', 'Turn a past mistake into a clean solve', graduated],
    ['comeback', 'Comeback', 'Fix 5 past mistakes cleanly in Review', progress.events.filter((e) => e.runKind === 'review' && e.result === 'clean').length >= 5],
    ['questing', 'Quest day', 'Complete all three daily quests in one day', [...progress.days.keys()].some((d) => questsFor(d, progress, timeZone).every((q) => q.done))],
    ['rush10', 'Rusher', 'Solve 10 puzzles in one Puzzle Rush', bestRush(progress) >= 10],
    ['rush20', 'Speed demon', 'Solve 20 puzzles in one Puzzle Rush', bestRush(progress) >= 20],
    ['hundred-clean', 'Sharp eye', '100 puzzles solved on the first try', [...progress.puzzles.values()].filter((p) => p.firstTry).length >= 100],
    ['part1', 'Board vision', 'Earn ★ on every chapter of Part I', [1, 2, 3, 4].every((c) => (chapters.get(c)?.length ?? 0) > 0 && stars(chapters.get(c)!, progress) >= 1)],
  ]
  return list.map(([id, name, desc, earned]) => ({ id, name, desc, earned }))
}

// ── weekly summary ──────────────────────────────────────────────────────────

export interface WeekStats { puzzles: number; clean: number; xp: number; activeDays: number; start: string }

/** Monday-based weeks in the user's calendar; `offset` 0 = this week, 1 = last week. */
export function weekStats(progress: Progress, today: string, offset: number, timeZone: string): WeekStats {
  const d = new Date(today + 'T12:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow - 7 * offset)
  const start = d.toISOString().slice(0, 10)
  const days = Array.from({ length: 7 }, (_, i) => { const x = new Date(start + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + i); return x.toISOString().slice(0, 10) })
  const set = new Set(days)
  const evs = progress.events.filter((e) => set.has(dayIn(e.finishedAt, timeZone)))
  return {
    start, puzzles: evs.length, clean: evs.filter((e) => e.result === 'clean').length,
    xp: progress.xpLog.filter((x) => set.has(x.day)).reduce((s, x) => s + x.xp, 0),
    activeDays: days.filter((x) => (progress.days.get(x) ?? 0) > 0).length,
  }
}
