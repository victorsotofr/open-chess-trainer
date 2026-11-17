/**
 * rush — Puzzle Rush: solve as many puzzles as possible in 3 minutes; 3 strikes end the run.
 *
 *   ready ──START──▶ running ─┬─ puzzle done (solved) ──▶ next puzzle (score +1)
 *                             ├─ puzzle done (failed) ──▶ strike; 3 strikes ──▶ over
 *                             ├─ TIME (endsAt reached) ──▶ over   (child stopped: no late move counts)
 *                             └─ queue exhausted ──────▶ over
 *   over ──RESTART──▶ ready
 *
 * Each puzzle is a one-shot puzzleSession (no hints, a wrong move fails it). Attempts are real
 * events (runKind "rush"): misses go to Review, and the best score is derived from history.
 * A rush is deliberately not resumable: leaving the page ends it.
 */
import { assign, setup } from 'xstate'
import { puzzleSession } from './puzzleSession'
import type { Exercise } from '../lib/types'
import type { AttemptEvent, Progress } from '@shared/progress'

export const RUSH_MS = 3 * 60_000
export const RUSH_STRIKES = 3

export interface RushContext {
  runId: string
  queue: Exercise[]
  index: number
  score: number
  strikes: number
  results: { puzzleId: number; ok: boolean }[]
  endsAt: number
}

type DoneOutput = { outcome: { kind: string; result: string } | null; puzzleId: number }

/** Ramp: shuffle within each chapter, then walk chapters in order (easier first). */
export function rushQueue(pool: Exercise[], rand: () => number = Math.random): Exercise[] {
  const byCh = new Map<number, Exercise[]>()
  pool.forEach((e) => byCh.set(e.chapter, [...(byCh.get(e.chapter) ?? []), e]))
  const chapters = [...byCh.keys()].sort((a, b) => a - b)
  const shuffled = chapters.map((c) => [...byCh.get(c)!].sort(() => rand() - 0.5))
  // interleave so the run climbs through chapters: take ~3 from each step, then move on
  const out: Exercise[] = []
  let round = 0
  while (shuffled.some((l) => l.length)) {
    for (let i = 0; i < shuffled.length; i++) {
      const take = i <= round ? 3 : 0
      out.push(...shuffled[i].splice(0, take))
    }
    round++
  }
  return out
}

/** Personal best = most solved puzzles in one rush run (derived from synced events). */
export function rushBest(progress: Progress): { best: number; runs: number } {
  const runs = new Map<string, AttemptEvent[]>()
  progress.events.filter((e) => e.runKind === 'rush').forEach((e) => runs.set(e.runId, [...(runs.get(e.runId) ?? []), e]))
  let best = 0
  runs.forEach((evs) => { best = Math.max(best, evs.filter((e) => e.result !== 'failed').length) })
  return { best, runs: runs.size }
}

export const rushMachine = setup({
  types: {} as { context: RushContext; events: { type: 'START'; queue: Exercise[]; now?: number } | { type: 'RESTART' } | { type: 'QUIT' } },
  actors: { puzzleSession },
  delays: { TIME_LEFT: ({ context }) => Math.max(0, context.endsAt - Date.now()) },
  guards: {
    solved: ({ event }) => { const o = (event as unknown as { output: DoneOutput }).output.outcome; return !!o && o.kind !== 'failed' },
    struckOut: ({ context }) => context.strikes >= RUSH_STRIKES,
    exhausted: ({ context }) => context.index >= context.queue.length,
  },
}).createMachine({
  id: 'rush',
  context: { runId: '', queue: [], index: 0, score: 0, strikes: 0, results: [], endsAt: 0 },
  initial: 'ready',
  states: {
    ready: {
      on: { START: { target: 'running', actions: assign(({ event }) => ({
        runId: crypto.randomUUID(), queue: event.queue, index: 0, score: 0, strikes: 0, results: [], endsAt: (event.now ?? Date.now()) + RUSH_MS,
      })) } },
    },
    running: {
      after: { TIME_LEFT: 'over' },
      on: { QUIT: 'over' },
      initial: 'puzzle',
      states: {
        puzzle: {
          invoke: {
            id: 'puzzle',
            src: 'puzzleSession',
            input: ({ context }) => ({ ex: context.queue[context.index], attemptId: crypto.randomUUID(), oneShot: true }),
            onDone: [
              { guard: 'solved', target: 'next', actions: assign(({ context, event }) => ({
                score: context.score + 1, results: [...context.results, { puzzleId: (event.output as DoneOutput).puzzleId, ok: true }] })) },
              { target: 'next', actions: assign(({ context, event }) => ({
                strikes: context.strikes + 1, results: [...context.results, { puzzleId: (event.output as DoneOutput).puzzleId, ok: false }] })) },
            ],
          },
        },
        next: {
          entry: assign({ index: ({ context }) => context.index + 1 }),
          always: [
            { guard: 'struckOut', target: '#rush.over' },
            { guard: 'exhausted', target: '#rush.over' },
            { target: 'puzzle' },
          ],
        },
      },
    },
    over: { on: { RESTART: 'ready' } },
  },
})
