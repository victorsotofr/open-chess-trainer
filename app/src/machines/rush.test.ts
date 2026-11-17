// Synthetic puzzles only.
import { describe, expect, it } from 'vitest'
import { createActor, fromPromise, SimulatedClock } from 'xstate'
import { rushMachine, rushQueue, rushBest, RUSH_MS } from './rush'
import { puzzleSession } from './puzzleSession'
import { fold, type AttemptEvent } from '@shared/progress'
import type { Exercise } from '../lib/types'

const mk = (n: number, chapter = 1): Exercise => ({
  id: `t:${n}`, chapter, section: 'S', mode: 'test', hint: 'h', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
  solution: ['Ra8#'], solution_uci: ['a1a8'], solution_text: '', initialFen: null, setup: null, judging: 'engine' as const, flags: [],
  plies: [{ ref_score: '#1', moves: { a1a8: { v: 'solution', score: '#1' }, a1a2: { v: 'rejected', score: '0', why: 'Misses mate.' } } }],
})
const tick = () => new Promise((r) => setTimeout(r, 0))

function start(n = 10) {
  const clock = new SimulatedClock()
  const actor = createActor(rushMachine.provide({ actors: { puzzleSession: puzzleSession.provide({ actors: { saveAttempt: fromPromise(async () => {}) } }) } }), { clock })
  actor.start()
  actor.send({ type: 'START', queue: Array.from({ length: n }, (_, i) => mk(i + 1)), now: Date.now() })
  const child = () => actor.getSnapshot().children.puzzle as ReturnType<typeof createActor<typeof puzzleSession>> | undefined
  return { actor, clock, child }
}

describe('rush', () => {
  it('solved puzzles score, wrong moves strike, 3 strikes end the run', async () => {
    const { actor, child } = start()
    child()!.send({ type: 'MOVE', uci: 'a1a8' }); await tick()
    child()!.send({ type: 'MOVE', uci: 'a1a8' }); await tick()
    expect(actor.getSnapshot().context.score).toBe(2)
    for (let i = 0; i < 3; i++) { child()!.send({ type: 'MOVE', uci: 'a1a2' }); await tick() }
    expect(actor.getSnapshot().value).toBe('over')
    expect(actor.getSnapshot().context).toMatchObject({ score: 2, strikes: 3 })
    expect(actor.getSnapshot().context.results.map((r) => r.ok)).toEqual([true, true, false, false, false])
  })
  it('one-shot puzzles refuse hints', async () => {
    const { child } = start()
    child()!.send({ type: 'HINT' })
    expect(child()!.getSnapshot().context.hints).toBe(0)
  })
  it('time runs out after 3 minutes and stops the current puzzle', () => {
    const { actor, clock, child } = start()
    const c = child()!
    clock.increment(RUSH_MS + 10)
    expect(actor.getSnapshot().value).toBe('over')
    expect(c.getSnapshot().status).toBe('stopped')
  })
  it('ramp climbs through chapters and never repeats', () => {
    const pool = [1, 1, 1, 1, 2, 2, 2, 2, 3, 3].map((c, i) => mk(i + 1, c))
    const q = rushQueue(pool, () => 0.3)
    expect(new Set(q.map((e) => e.id)).size).toBe(pool.length)
    expect(q[0].chapter).toBe(1)
    expect(q.slice(0, 3).every((e) => e.chapter === 1)).toBe(true)
  })
  it('best score comes from history', () => {
    let n = 0
    const ev = (runId: string, result: AttemptEvent['result']): AttemptEvent => ({ attemptId: `a${++n}`, puzzleId: `t:${n}`, finishedAt: `2026-11-14T10:${String(n).padStart(2, '0')}:00Z`, result,
      mistakes: 0, hints: 0, ms: 1, mode: 'test', solverMoves: 1, runId, runKind: 'rush', dailyGoal: 10, deviceId: 'd' })
    const p = fold([ev('r1', 'clean'), ev('r1', 'clean'), ev('r1', 'failed'), ev('r2', 'clean')], 'Europe/Paris')
    expect(rushBest(p)).toEqual({ best: 2, runs: 2 })
  })
})
