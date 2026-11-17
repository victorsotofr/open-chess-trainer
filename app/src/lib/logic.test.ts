// Synthetic fixtures only: no book content in tests.
import { describe, expect, it } from 'vitest'
import { judgeMove, formatLine, isMateMove } from './puzzle'
import { levelInfo, stars, isUnlocked, questsFor, questXp, achievements, weekStats } from './gamify'
import { fold, type AttemptEvent } from '@shared/progress'
import type { Exercise } from './types'

const ex: Exercise = {
  id: 't:1', chapter: 1, section: 'Test', mode: 'test', hint: null, fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
  solution: ['Ra8#'], solution_uci: ['a1a8'], solution_text: '', initialFen: null, setup: null, judging: 'engine' as const, flags: [],
  plies: [{ ref_score: '#1', moves: { a1a8: { v: 'solution', score: '#1' }, a1a7: { v: 'rejected', score: '+0', why: 'x' },
    a1b1: { v: 'slower_mate', score: '#3' }, a1c1: { v: 'inconclusive', score: '+400' }, a1d1: { v: 'accepted', score: '#1' } } }],
}
let n = 0
const ev = (p: Partial<AttemptEvent>): AttemptEvent => ({ attemptId: `e${++n}`, puzzleId: 't:1', finishedAt: '2026-11-14T10:00:00Z', result: 'clean',
  mistakes: 0, hints: 0, ms: 1, mode: 'test', solverMoves: 1, runId: 'r', runKind: 'chapter', dailyGoal: 10, deviceId: 'd', ...p })
const TZ = 'Europe/Paris'

describe('judgeMove', () => {
  it('maps verdicts', () => {
    expect(judgeMove(ex, 0, 'a1a8')).toEqual({ kind: 'correct', done: true, reply: undefined })
    expect(judgeMove(ex, 0, 'a1a7').kind).toBe('wrong')
    expect(judgeMove(ex, 0, 'a1b1').kind).toBe('slower_mate')
    expect(judgeMove(ex, 0, 'a1c1').kind).toBe('inconclusive')
    expect(judgeMove(ex, 0, 'a1d1').kind).toBe('alternative')
    expect(judgeMove(ex, 0, 'g1h1').kind).toBe('unknown')
  })
  it('formats lines', () => {
    expect(formatLine(['Qxg8+', 'Kxg8', 'Rf8#'], true)).toBe('1.Qxg8+ Kxg8 2.Rf8#')
    expect(formatLine(['Rxb3+', 'cxb3', 'Rc1#'], false)).toBe('1...Rxb3+ 2.cxb3 Rc1#')
  })
})

describe('levels, stars, unlocks', () => {
  it('levels', () => {
    expect(levelInfo(0)).toMatchObject({ level: 1, title: 'Pawn' })
    expect(levelInfo(250)).toMatchObject({ level: 3, title: 'Knight' })
  })
  it('stars from first-try ratio', () => {
    const ids = [1, 2, 3, 4, 5]
    const all = fold(ids.map((i) => ev({ puzzleId: `t:${i}`, finishedAt: `2026-11-14T10:0${i}:00Z` })), TZ)
    expect(stars(ids.map((i) => `t:${i}`), all)).toBe(3)
    const one = fold([...ids.map((i) => ev({ puzzleId: `t:${i}`, finishedAt: `2026-11-14T10:0${i}:00Z`, result: i === 5 ? 'failed' : 'clean' }))], TZ)
    expect(stars(ids.map((i) => `t:${i}`), one)).toBe(2)
    expect(stars(ids.map((i) => `t:${i}`), fold([ev({ puzzleId: 't:1' })], TZ))).toBe(0)
  })
  it('unlocks', () => {
    expect(isUnlocked(0, [], false)).toBe(true)
    expect(isUnlocked(1, [0], false)).toBe(false)
    expect(isUnlocked(1, [1], false)).toBe(true)
    expect(isUnlocked(4, [0, 0, 0, 0], true)).toBe(true)
  })
})

describe('quests', () => {
  it('are deterministic per day and differ across days', () => {
    const p = fold([], TZ)
    expect(questsFor('2026-11-14', p, TZ)).toEqual(questsFor('2026-11-14', p, TZ))
    const ids = (d: string) => questsFor(d, p, TZ).map((q) => q.id).join()
    expect(new Set(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'].map(ids)).size).toBeGreaterThan(1)
    expect(questsFor('2026-11-14', p, TZ)).toHaveLength(3)
  })
  it('count progress from that day only and add derived XP', () => {
    const es = [1, 2, 3, 4, 5, 6].map((i) => ev({ puzzleId: `t:${i}`, finishedAt: `2026-11-14T10:0${i}:00Z`, solverMoves: 2 }))
    const p = fold(es, TZ)
    const q = questsFor('2026-11-14', p, TZ)
    expect(q.every((x) => x.progress > 0)).toBe(true)
    expect(questXp(p, TZ)).toBeGreaterThan(0)
    expect(questsFor('2026-11-15', p, TZ).every((x) => x.progress === 0)).toBe(true)
  })
})

describe('achievements', () => {
  it('first solve and clean', () => {
    const a = achievements(fold([ev({})], TZ), [ex], 0)
    expect(a.find((x) => x.id === 'first-blood')!.earned).toBe(true)
    expect(a.find((x) => x.id === 'clean')!.earned).toBe(true)
    expect(a.find((x) => x.id === 'combo5')!.earned).toBe(false)
  })
})

describe('weekly summary', () => {
  it('splits Monday-based weeks in the user timezone', () => {
    // 2026-11-14 is a Saturday; this week starts Monday 2026-11-09
    const es = [ev({ puzzleId: 't:1', finishedAt: '2026-11-10T10:00:00Z' }), ev({ puzzleId: 't:2', finishedAt: '2026-11-08T10:00:00Z', result: 'failed', mistakes: 1 })]
    const p = fold(es, TZ)
    expect(weekStats(p, '2026-11-14', 0, TZ)).toMatchObject({ start: '2026-11-09', puzzles: 1, clean: 1, activeDays: 1 })
    expect(weekStats(p, '2026-11-14', 1, TZ)).toMatchObject({ start: '2026-11-02', puzzles: 1, clean: 0 })
  })
})

import { material } from './material'
describe('material balance', () => {
  it('start position is even', () => {
    expect(material('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toEqual({ whiteCaptured: [], blackCaptured: [], diff: 0 })
  })
  it('White up a knight after capturing it', () => {
    const m = material('r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(m).toEqual({ whiteCaptured: ['n'], blackCaptured: [], diff: 3 })
  })
  it('promotion counts as a missing pawn, not a capture', () => {
    const m = material('QQ2k3/8/8/8/8/8/8/4K3 w - - 0 1') // two white queens, nothing else
    expect(m.blackCaptured).toEqual(['r', 'r', 'b', 'b', 'n', 'n', 'p', 'p', 'p', 'p', 'p', 'p', 'p'])
    expect(m.diff).toBe(18)
  })
})

describe('judging policies', () => {
  // synthetic position: two white rooks, both Ra8# and Rb8# mate
  const base: Exercise = {
    id: 'lichess:test1', chapter: 1, section: 'S', mode: 'test', hint: null,
    initialFen: '6k1/5ppp/8/8/8/8/1R6/R5K1 b - - 0 1', setup: null,
    fen: '6k1/5ppp/8/8/8/8/1R6/R5K1 w - - 0 1', solution: ['Ra8#'], solution_uci: ['a1a8'], solution_text: '',
    flags: [], judging: 'reference', plies: [],
  }
  it('reference: the solution move wins', () => expect(judgeMove(base, 0, 'a1a8')).toMatchObject({ kind: 'correct', done: true }))
  it('reference: any other checkmate is accepted (as on Lichess)', () => expect(judgeMove(base, 0, 'b2b8')).toMatchObject({ kind: 'alternative' }))
  it('reference: a non-mating other move "doesn\'t match", with no invented refutation', () => {
    const o = judgeMove(base, 0, 'b2b3')
    expect(o).toMatchObject({ kind: 'wrong', verdict: { why: "Doesn't match the solution." } })
    expect((o as { verdict: { line?: string[] } }).verdict.line).toBeUndefined()
  })
  it('engine policy also accepts an alternative mate without a stored verdict', () =>
    expect(judgeMove({ ...base, judging: 'engine' }, 0, 'b2b8')).toMatchObject({ kind: 'alternative' }))
  it('engine policy without a verdict for a non-mate is "unknown", never a guess', () =>
    expect(judgeMove({ ...base, judging: 'engine' }, 0, 'b2b3')).toEqual({ kind: 'unknown' }))
  it('mate detection works after a promotion in the solution', () => {
    const promo: Exercise = { ...base, fen: '7k/P7/7K/8/8/8/8/8 w - - 0 1', solution: ['a8=Q#'], solution_uci: ['a7a8q'] }
    expect(isMateMove(promo, 0, 'a7a8q')).toBe(true)
  })
})
