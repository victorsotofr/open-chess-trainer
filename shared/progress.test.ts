// Synthetic events only.
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { addDays, dayIn, fold, liveStreak, orderEvents, xpFor, type AttemptEvent } from './progress'

let n = 0
const ev = (p: Partial<AttemptEvent>): AttemptEvent => ({
  attemptId: `a${String(++n).padStart(4, '0')}`, puzzleId: 1, finishedAt: '2026-11-14T10:00:00Z', result: 'clean',
  mistakes: 0, hints: 0, ms: 1000, mode: 'test', solverMoves: 1, runId: 'r1', runKind: 'chapter', dailyGoal: 10, deviceId: 'd1', ...p,
})
const TZ = 'Europe/Paris'
const derived = (es: AttemptEvent[]) => {
  const f = fold(es, TZ)
  return { xp: f.xp, streak: f.streak, lastDay: f.lastDay, puzzles: [...f.puzzles.values()].sort((a, b) => a.puzzleId - b.puzzleId) }
}

describe('fold is order-independent and idempotent', () => {
  const pool = [
    ev({ puzzleId: 1, finishedAt: '2026-11-10T08:00:00Z', result: 'failed', mistakes: 1 }),
    ev({ puzzleId: 1, finishedAt: '2026-11-11T08:00:00Z', runKind: 'review', runId: 'r2' }),
    ev({ puzzleId: 2, finishedAt: '2026-11-11T09:00:00Z' }),
    ev({ puzzleId: 3, finishedAt: '2026-11-11T09:30:00Z', result: 'hinted', hints: 1 }),
    ev({ puzzleId: 2, finishedAt: '2026-11-12T09:00:00Z', deviceId: 'd2', runId: 'r3' }),
    ev({ puzzleId: 4, finishedAt: '2026-11-12T09:00:00Z', deviceId: 'd2', runId: 'r3' }),
  ]
  const expected = derived(pool)
  it('any arrival order gives the same derived state', () => {
    fc.assert(fc.property(fc.shuffledSubarray(pool, { minLength: pool.length, maxLength: pool.length }), (shuffled) => {
      expect(derived(shuffled)).toEqual(expected)
    }))
  })
  it('duplicates (same attemptId) count once', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: pool.length - 1 }), { maxLength: 10 }), (dups) => {
      expect(derived([...pool, ...dups.map((i) => ({ ...pool[i] }))])).toEqual(expected)
    }))
  })
})

describe('semantics', () => {
  it('first-try is decided by the earliest attempt even if it arrives late', () => {
    const late = ev({ puzzleId: 9, finishedAt: '2026-11-01T10:00:00Z', result: 'failed', mistakes: 1 })
    const early = ev({ puzzleId: 9, finishedAt: '2026-11-02T10:00:00Z' })
    expect(fold([early], TZ).puzzles.get(9)!.firstTry).toBe(true)
    expect(fold([early, late], TZ).puzzles.get(9)!.firstTry).toBe(false)
  })
  it('a late event re-schedules SRS deterministically', () => {
    const miss = ev({ puzzleId: 5, finishedAt: '2026-11-01T10:00:00Z', result: 'failed', mistakes: 1 })
    const fix = ev({ puzzleId: 5, finishedAt: '2026-11-03T10:00:00Z', runKind: 'review' })
    expect(fold([miss], TZ).puzzles.get(5)).toMatchObject({ box: 1, due: '2026-11-02' })
    expect(fold([fix, miss], TZ).puzzles.get(5)).toMatchObject({ box: 2, due: '2026-11-06' })
  })
  it('practising a puzzle before its due date keeps the schedule; a miss still resets it', () => {
    const miss = ev({ puzzleId: 6, finishedAt: '2026-11-01T10:00:00Z', result: 'failed', mistakes: 1 })
    const fix = ev({ puzzleId: 6, finishedAt: '2026-11-02T10:00:00Z', runKind: 'review' }) // due 11-02 → step 2, due 11-05
    const early = ev({ puzzleId: 6, finishedAt: '2026-11-03T10:00:00Z', runKind: 'single' })
    expect(fold([miss, fix, early], TZ).puzzles.get(6)).toMatchObject({ box: 2, due: '2026-11-05' })
    const earlyMiss = ev({ puzzleId: 6, finishedAt: '2026-11-03T10:00:00Z', runKind: 'single', result: 'failed', mistakes: 1 })
    expect(fold([miss, fix, earlyMiss], TZ).puzzles.get(6)).toMatchObject({ box: 1, due: '2026-11-04' })
  })
  it('combo is per run and multiplies xp', () => {
    const run = [1, 2, 3].map((i) => ev({ puzzleId: 10 + i, finishedAt: `2026-11-14T10:0${i}:00Z`, runId: 'rc' }))
    const f = fold(run, TZ)
    expect(f.perEvent.get(run[2].attemptId)!.combo).toBe(3)
    expect(f.perEvent.get(run[2].attemptId)!.xp).toBe(Math.round(30 * 1.25))
    const other = run.map((e, i) => ({ ...e, runId: `x${i}` }))
    expect(fold(other, TZ).bestCombo).toBe(1)
  })
  it('daily goal bonus fires once, on the goal-th puzzle of the day', () => {
    const es = [1, 2, 3].map((i) => ev({ puzzleId: 20 + i, finishedAt: `2026-11-14T1${i}:00:00Z`, dailyGoal: 2, runId: `g${i}` }))
    const f = fold(es, TZ)
    expect([...es].map((e) => f.perEvent.get(e.attemptId)!.bonus)).toEqual([0, 20, 0])
  })
  it('xp honesty rules', () => {
    const base = { mode: 'test' as const, solverMoves: 1, mistakes: 0, hints: 0, firstAttempt: true, review: false, alreadySolved: false }
    expect(xpFor(base)).toBe(30)
    expect(xpFor({ ...base, hints: 3 })).toBe(2)
    expect(xpFor({ ...base, mistakes: 1 })).toBe(9)
  })
})

describe('days, timezones and DST', () => {
  it('uses the calendar day of the user timezone', () => {
    expect(dayIn('2026-11-14T23:30:00Z', 'Europe/Paris')).toBe('2026-11-15')
    expect(dayIn('2026-11-14T23:30:00Z', 'America/New_York')).toBe('2026-11-14')
  })
  it('streak spans the DST change (Paris, 2026-10-25)', () => {
    const es = ['2026-10-24T22:30:00Z', '2026-10-25T22:30:00Z', '2026-10-26T23:30:00Z'].map((t, i) => ev({ puzzleId: 30 + i, finishedAt: t, runId: `s${i}` }))
    // 22:30Z on 10-24 is 00:30 on 10-25 (CEST); 22:30Z on 10-25 is 23:30 on 10-25 (CET) -> same day; 23:30Z on 10-26 is 00:30 on 10-27
    const f = fold(es, 'Europe/Paris')
    expect([...f.days.keys()].sort()).toEqual(['2026-10-25', '2026-10-27'])
    expect(f.streak).toBe(1)
  })
  it('live streak breaks after a missed day', () => {
    expect(liveStreak({ streak: 4, lastDay: '2026-11-14' }, '2026-11-15')).toBe(4)
    expect(liveStreak({ streak: 4, lastDay: '2026-11-14' }, '2026-11-16')).toBe(0)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('orders ties by attemptId', () => {
    const a = ev({ attemptId: 'b', finishedAt: '2026-11-14T10:00:00Z' }), b = ev({ attemptId: 'a', finishedAt: '2026-11-14T10:00:00Z' })
    expect(orderEvents([a, b]).map((e) => e.attemptId)).toEqual(['a', 'b'])
  })
})
