// Synthetic exercises only.
import { describe, expect, it } from 'vitest'
import { createActor, fromPromise, SimulatedClock } from 'xstate'
import { runMachine } from './run'
import { puzzleSession } from './puzzleSession'
import type { Exercise } from '../lib/types'
import type { SessionRecord } from '@shared/session'

const mk = (id: number): Exercise => ({
  id, chapter: 1, section: 'S', mode: 'test', hint: null, fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
  solution: ['Ra8#'], solution_uci: ['a1a8'], solution_text: '', page: 1, flags: [],
  plies: [{ book_score: '#1', moves: { a1a8: { v: 'book', score: '#1' } } }],
})
const exercises = new Map([1, 2, 3].map((i) => [i, mk(i)]))
const record = (p: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'learn', schemaVersion: 1, contentVersion: 'v', deviceId: 'd', runId: 'r', runKind: 'chapter', chapter: 1,
  queue: [1, 2, 3], index: 0, puzzle: null, startedAt: '', updatedAt: '', ...p,
})
const flush = () => new Promise((r) => setTimeout(r, 0))

function start(rec: SessionRecord) {
  const advances: number[] = []
  let finished = false
  const machine = runMachine.provide({
    actions: { advance: (_, p) => { advances.push(p.index) }, finish: () => { finished = true } },
    actors: { puzzleSession: puzzleSession.provide({ actors: { saveAttempt: fromPromise(async () => {}) } }) },
  })
  const actor = createActor(machine, { input: { record: rec, exercises }, clock: new SimulatedClock() })
  actor.start()
  return { actor, advances, isFinished: () => finished }
}

describe('run', () => {
  it('walks the frozen queue: puzzle → between → next … → complete', async () => {
    const { actor, advances, isFinished } = start(record())
    for (let i = 0; i < 3; i++) {
      expect(actor.getSnapshot().value).toBe('puzzle')
      actor.getSnapshot().children.puzzle!.send({ type: 'MOVE', uci: 'a1a8' })
      await flush()
      expect(actor.getSnapshot().value).toBe('between')
      actor.send({ type: 'NEXT' })
    }
    expect(advances).toEqual([1, 2])
    expect(actor.getSnapshot().value).toBe('complete')
    expect(isFinished()).toBe(true)
  })

  it('resumes into "between" when the current puzzle was already saved', () => {
    const { actor } = start(record({ index: 1, puzzle: { puzzleId: 2, puzzleKey: 'x', attemptId: 'a', moves: ['a1a8'], hints: 0, mistakes: 0,
      revealed: false, outcome: { kind: 'solved', result: 'clean', finishedAt: '', text: '' }, saved: true, startedAt: '' } }))
    expect(actor.getSnapshot().value).toBe('between')
  })

  it('drops puzzles that no longer exist in the book', () => {
    const { actor } = start(record({ queue: [99, 2], index: 0 }))
    expect(actor.getSnapshot().context.record.queue).toEqual([2])
  })

  it('stopping the run stops the child puzzle', () => {
    const { actor } = start(record())
    const child = actor.getSnapshot().children.puzzle!
    actor.stop()
    expect(child.getSnapshot().status).toBe('stopped')
  })
})
