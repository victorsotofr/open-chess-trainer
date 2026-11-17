/**
 * run — a learning session over a queue frozen at start (chapter, review or single puzzle).
 *
 *   puzzle (invokes puzzleSession) ──done──▶ between ──NEXT──▶ puzzle | complete
 *
 * The SessionRecord (durable) is updated by injected actions; the child puzzle actor is
 * stopped automatically when the run leaves `puzzle` or the run actor itself is stopped.
 */
import { assign, setup, type ActorRefFrom } from 'xstate'
import type { SessionRecord } from '@shared/session'
import type { Exercise } from '../lib/types'
import { puzzleSession } from './puzzleSession'

export interface RunContext {
  record: SessionRecord
  exercises: Map<number, Exercise>
  attemptKey: number // bumps to re-invoke a fresh child for the next puzzle
}

export interface RunInput { record: SessionRecord; exercises: Map<number, Exercise> }

export type RunEvent = { type: 'NEXT' } | { type: 'EXIT' }

const current = (c: RunContext) => c.exercises.get(c.record.queue[c.record.index])

export const runMachine = setup({
  types: {} as { context: RunContext; input: RunInput; events: RunEvent },
  actors: { puzzleSession },
  actions: {
    /** Injected: persist run position (index) and clear the finished puzzle record. */
    advance: (_, _p: { index: number }) => {},
    /** Injected: delete the session record when the run is complete. */
    finish: () => {},
  },
  guards: {
    hasPuzzle: ({ context }) => context.record.index < context.record.queue.length && !!current(context),
    finishedSaved: ({ context }) => !!context.record.puzzle?.saved && context.record.puzzle.puzzleId === context.record.queue[context.record.index],
    hasNext: ({ context }) => context.record.index + 1 < context.record.queue.length,
  },
}).createMachine({
  id: 'run',
  context: ({ input }) => {
    // drop ids that no longer exist in the current book (content changed)
    const queue = input.record.queue.filter((id) => input.exercises.has(id))
    const index = Math.min(input.record.index, queue.length)
    return { record: { ...input.record, queue, index }, exercises: input.exercises, attemptKey: 0 }
  },
  initial: 'boot',
  states: {
    boot: { always: [{ guard: 'finishedSaved', target: 'between' }, { guard: 'hasPuzzle', target: 'puzzle' }, { target: 'complete' }] },
    puzzle: {
      invoke: {
        id: 'puzzle',
        src: 'puzzleSession',
        input: ({ context }) => {
          const ex = current(context)!
          const r = context.record.puzzle
          return { ex, attemptId: crypto.randomUUID(), restore: r && r.puzzleId === ex.id ? r : null }
        },
        onDone: { target: 'between' },
      },
      on: { EXIT: 'exited' },
    },
    between: {
      on: {
        NEXT: [
          { guard: 'hasNext', target: 'puzzle', reenter: true, actions: [
            assign(({ context }) => ({ record: { ...context.record, index: context.record.index + 1, puzzle: null }, attemptKey: context.attemptKey + 1 })),
            { type: 'advance', params: ({ context }) => ({ index: context.record.index }) }] },
          { target: 'complete' },
        ],
        EXIT: 'exited',
      },
    },
    complete: { entry: 'finish', type: 'final' },
    exited: { type: 'final' },
  },
})

export type RunRef = ActorRefFrom<typeof runMachine>
