// Synthetic position only (no book content): 1.Qxg8+ Kxg8 2.Rf8#
import { describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise, SimulatedClock } from 'xstate'
import { puzzleSession } from './puzzleSession'
import type { Exercise } from '../lib/types'
import type { PuzzleProgressRecord } from '@shared/session'
import { puzzleKey } from '../core/restore'

const ex: Exercise = {
  id: 1, chapter: 18, section: 'Mate in two', mode: 'test', hint: 'Sacrifice first.',
  fen: '6rk/6pp/8/3Q4/8/8/8/5RK1 w - - 0 1',
  solution: ['Qxg8+', 'Kxg8', 'Rf8#'], solution_uci: ['d5g8', 'h8g8', 'f1f8'], solution_text: '', page: 1, flags: [],
  plies: [
    { book_score: '#2', moves: {
      d5g8: { v: 'book', score: '#2' },
      d5d8: { v: 'rejected', score: '-900', why: 'Opponent answers Rxd8, winning your queen.', line: ['Rxd8'] },
      d5e5: { v: 'accepted', score: '#2' },
      d5d7: { v: 'slower_mate', score: '#4' },
      d5c5: { v: 'inconclusive', score: '+400' },
    } },
    { book_score: '#1', moves: { f1f8: { v: 'book', score: '#1' } } },
  ],
}

function start(opts: { restore?: PuzzleProgressRecord | null; save?: () => Promise<void> } = {}) {
  const clock = new SimulatedClock()
  const persisted: PuzzleProgressRecord[] = []
  const saved: PuzzleProgressRecord[] = []
  const machine = puzzleSession.provide({
    actions: { persist: (_, p) => { persisted.push(p.record) } },
    actors: { saveAttempt: fromPromise(async ({ input }) => { saved.push(input.record); if (opts.save) await opts.save() }) },
  })
  const actor = createActor(machine, { input: { ex, attemptId: 'att-1', restore: opts.restore }, clock })
  actor.start()
  return { actor, clock, persisted, saved }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('puzzleSession', () => {
  it('solves a two-move line through the reply delay', async () => {
    const { actor, clock, saved } = start()
    actor.send({ type: 'MOVE', uci: 'd5g8' })
    expect(actor.getSnapshot().value).toBe('replying')
    clock.increment(550)
    expect(actor.getSnapshot().value).toBe('playing')
    expect(actor.getSnapshot().context.k).toBe(1)
    actor.send({ type: 'MOVE', uci: 'f1f8' })
    await flush()
    expect(actor.getSnapshot().value).toBe('done')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ attemptId: 'att-1', moves: ['d5g8', 'f1f8'], saved: true, outcome: { kind: 'solved', result: 'clean' } })
  })

  it('wrong move: mistake, refutation arrow, retry restores the position', () => {
    const { actor } = start()
    actor.send({ type: 'MOVE', uci: 'd5d8' })
    const s = actor.getSnapshot()
    expect(s.value).toBe('wrong')
    expect(s.context.mistakes).toBe(1)
    expect(s.context.feedback).toMatchObject({ tone: 'bad', arrow: ['g8', 'd8'] })
    actor.send({ type: 'MOVE', uci: 'd5g8' }) // ignored while in `wrong`
    expect(actor.getSnapshot().value).toBe('wrong')
    actor.send({ type: 'RETRY' })
    expect(actor.getSnapshot().context.fen).toBe(ex.fen)
    expect(actor.getSnapshot().value).toBe('playing')
  })

  it('accepted alternative ends the puzzle without the book continuation', async () => {
    const { actor, saved } = start()
    actor.send({ type: 'MOVE', uci: 'd5e5' })
    await flush()
    expect(actor.getSnapshot().value).toBe('done')
    expect(saved[0].outcome).toMatchObject({ kind: 'alternative', result: 'clean' })
  })

  it('slower mate bounces back with no penalty', () => {
    const { actor, clock } = start()
    actor.send({ type: 'MOVE', uci: 'd5d7' })
    expect(actor.getSnapshot().value).toBe('bouncing')
    clock.increment(1200)
    expect(actor.getSnapshot()).toMatchObject({ value: 'playing', context: { mistakes: 0, fen: ex.fen } })
  })

  it('inconclusive reveals the book move, then continues; result is hinted, not failed', async () => {
    const { actor, clock, saved } = start()
    actor.send({ type: 'MOVE', uci: 'd5c5' })
    clock.increment(1600)
    expect(actor.getSnapshot().value).toBe('replying')
    clock.increment(550)
    actor.send({ type: 'MOVE', uci: 'f1f8' })
    await flush()
    expect(saved[0].outcome!.result).toBe('hinted')
    expect(saved[0].mistakes).toBe(0)
  })

  it('hint ladder stops at 3 and is persisted', () => {
    const { actor, persisted } = start()
    for (let i = 0; i < 5; i++) actor.send({ type: 'HINT' })
    expect(actor.getSnapshot().context.hints).toBe(3)
    expect(persisted.at(-1)!.hints).toBe(3)
  })

  it('stopping mid-reply cancels the delayed reply (no move lands after leaving)', () => {
    const { actor, clock, persisted } = start()
    actor.send({ type: 'MOVE', uci: 'd5g8' })
    const before = persisted.length
    actor.stop()
    clock.increment(5000)
    expect(actor.getSnapshot().status).toBe('stopped')
    expect(actor.getSnapshot().context.k).toBe(0)
    expect(persisted.length).toBe(before)
  })

  it('persists the solver move before the reply is applied (reload-safe)', () => {
    const { actor, persisted } = start()
    actor.send({ type: 'MOVE', uci: 'd5g8' })
    expect(actor.getSnapshot().value).toBe('replying')
    expect(persisted.at(-1)!.moves).toEqual(['d5g8'])
    // a fresh actor restored from exactly what was persisted lands on the solver turn
    const { actor: again } = start({ restore: persisted.at(-1)! })
    expect(again.getSnapshot().context.k).toBe(1)
  })

  it('restores "solver moved, reply pending" onto the solver turn', () => {
    const restore: PuzzleProgressRecord = { puzzleId: 1, puzzleKey: puzzleKey(ex), attemptId: 'att-old', moves: ['d5g8'], hints: 1,
      mistakes: 0, revealed: false, outcome: null, saved: false, startedAt: '2026-11-14T10:00:00Z' }
    const { actor } = start({ restore })
    const s = actor.getSnapshot()
    expect(s.value).toBe('playing')
    expect(s.context).toMatchObject({ k: 1, attemptId: 'att-old', hints: 1, lastMove: ['h8', 'g8'] })
    expect(s.context.fen.startsWith('6k1/6pp/8/8/8/8/8/5RK1 w')).toBe(true)
  })

  it('restores a finished-but-unsaved attempt straight into saving (same attemptId)', async () => {
    const restore: PuzzleProgressRecord = { puzzleId: 1, puzzleKey: puzzleKey(ex), attemptId: 'att-old', moves: ['d5g8', 'f1f8'], hints: 0,
      mistakes: 0, revealed: false, outcome: { kind: 'solved', result: 'clean', finishedAt: '2026-11-14T10:01:00Z', text: 'Puzzle solved.' }, saved: false, startedAt: '2026-11-14T10:00:00Z' }
    const { actor, saved } = start({ restore })
    await flush()
    expect(actor.getSnapshot().value).toBe('done')
    expect(saved[0]).toMatchObject({ attemptId: 'att-old', outcome: { finishedAt: '2026-11-14T10:01:00Z' } })
  })

  it('ignores a record for a changed puzzle (content updated) and starts fresh', () => {
    const restore = { puzzleId: 1, puzzleKey: 'stale', attemptId: 'att-old', moves: ['d5g8'], hints: 2, mistakes: 1, revealed: false, outcome: null, saved: false, startedAt: 'x' }
    const { actor } = start({ restore })
    expect(actor.getSnapshot().context).toMatchObject({ k: 0, hints: 0, mistakes: 0, attemptId: 'att-1' })
  })

  it('save failure is visible and retryable', async () => {
    const fail = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const { actor, saved } = start({ save: fail })
    actor.send({ type: 'MOVE', uci: 'd5e5' })
    await flush()
    expect(actor.getSnapshot()).toMatchObject({ value: 'saveFailed', context: { saveError: 'Error: disk full' } })
    actor.send({ type: 'RETRY_SAVE' })
    await flush()
    expect(actor.getSnapshot().value).toBe('done')
    expect(saved.map((r) => r.attemptId)).toEqual(['att-1', 'att-1']) // same attempt id: idempotent upsert downstream
  })
})
