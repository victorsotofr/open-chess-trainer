/**
 * puzzleSession — one attempt at one puzzle.
 *
 *   playing ──MOVE──▶ judging ─┬─ correct & more ──▶ replying ──(REPLY_DELAY)──▶ playing
 *      ▲  │                    ├─ correct & last ──▶ finishing
 *      │  HINT (0→3)           ├─ alternative ─────▶ finishing
 *      │                       ├─ slower mate ─────▶ bouncing ──(BOUNCE_DELAY)──▶ playing
 *      │                       ├─ inconclusive ────▶ revealing ──(REVEAL_DELAY)──▶ replying | finishing
 *      │                       ├─ unknown ─────────▶ bouncing
 *      └────RETRY──── wrong ◀──┘ wrong
 *   finishing ─▶ saving ─┬─▶ done            (attempt event committed atomically)
 *                        └─▶ saveFailed ──RETRY_SAVE──▶ saving
 *
 * Side effects are injected (`persist`, `saveAttempt`) so tests run without IndexedDB.
 * Delays are named so tests can set them to 0. Leaving the page stops the actor, which
 * cancels any pending delayed transition: a reply can never land on another puzzle.
 * Resume: pass `restore` (a PuzzleProgressRecord); the board is rebuilt by replaying moves.
 */
import { assign, fromPromise, setup } from 'xstate'
import { Chess } from 'chess.js'
import type { Exercise, MoveVerdict } from '../lib/types'
import { judgeMove, solverMoves, type MoveOutcome } from '../lib/puzzle'
import { applyUci, positionAt, puzzleKey, replay } from '../core/restore'
import type { PuzzleProgressRecord } from '@shared/session'
import type { AttemptResult } from '@shared/progress'

export type Feedback = { tone: 'good' | 'bad' | 'info'; text: string; arrow?: [string, string] } | null
export type Outcome = NonNullable<PuzzleProgressRecord['outcome']>

export interface PuzzleContext {
  ex: Exercise
  attemptId: string
  startedAt: string
  moves: string[] // solver moves on the board
  k: number
  fen: string
  lastMove?: [string, string]
  hints: number
  mistakes: number
  revealed: boolean
  feedback: Feedback
  pending: (MoveOutcome & { uci: string; fenAfter: string; san: string; from: string; to: string }) | null
  outcome: Outcome | null
  saveError: string | null
  oneShot: boolean
}

export interface PuzzleInput {
  ex: Exercise
  attemptId: string
  restore?: PuzzleProgressRecord | null
  /** Puzzle Rush: a wrong move ends the puzzle as failed (no retry, no hints). */
  oneShot?: boolean
}

export type PuzzleEvent =
  | { type: 'MOVE'; uci: string }
  | { type: 'HINT' }
  | { type: 'RETRY' }
  | { type: 'RETRY_SAVE' }

/** failed if any mistake; hinted if a hint was used or the book move had to be revealed; else clean. */
const resultOf = (c: PuzzleContext, kind: Outcome['kind']): AttemptResult =>
  c.mistakes > 0 ? 'failed' : kind === 'revealed' || c.revealed || c.hints > 0 ? 'hinted' : 'clean'

/** The opponent's setup move as [from, to], for the last-move highlight. */
export const setupSquares = (ex: Exercise): [string, string] | undefined => (ex.setup ? [ex.setup.slice(0, 2), ex.setup.slice(2, 4)] : undefined)

function sanToSquares(fen: string, san: string) {
  const mv = new Chess(fen).move(san)
  return { from: mv.from, to: mv.to }
}

export const toRecord = (c: PuzzleContext, saved: boolean): PuzzleProgressRecord => ({
  puzzleId: c.ex.id, puzzleKey: puzzleKey(c.ex), attemptId: c.attemptId, moves: c.moves, hints: c.hints,
  mistakes: c.mistakes, revealed: c.revealed, outcome: c.outcome, saved, startedAt: c.startedAt,
})

export const puzzleSession = setup({
  types: {} as { context: PuzzleContext; input: PuzzleInput; events: PuzzleEvent },
  actions: {
    /** Injected: write the durable PuzzleProgressRecord. */
    persist: (_, _params: { record: PuzzleProgressRecord }) => {},
  },
  actors: {
    /** Injected: commit attempt event + outbox + session record in one transaction. */
    saveAttempt: fromPromise<void, { record: PuzzleProgressRecord; solverMoves: number; mode: 'guided' | 'test' }>(async () => {}),
  },
  delays: { REPLY_DELAY: 550, BOUNCE_DELAY: 1200, REVEAL_DELAY: 1600 },
  guards: {
    isCorrectDone: ({ context }) => context.pending?.kind === 'correct' && context.pending.done,
    isCorrect: ({ context }) => context.pending?.kind === 'correct',
    isAlternative: ({ context }) => context.pending?.kind === 'alternative',
    isBounce: ({ context }) => context.pending?.kind === 'slower_mate' || context.pending?.kind === 'unknown',
    isInconclusive: ({ context }) => context.pending?.kind === 'inconclusive',
    isWrong: ({ context }) => context.pending?.kind === 'wrong',
    isWrongOneShot: ({ context }) => context.pending?.kind === 'wrong' && context.oneShot,
    hasReply: ({ context }) => !!context.ex.solution_uci[2 * context.k + 1],
    canHint: ({ context }) => context.hints < 3 && !context.oneShot,
    restoredDone: ({ context }) => !!context.outcome,
  },
}).createMachine({
  id: 'puzzleSession',
  output: ({ context }) => ({ outcome: context.outcome, attemptId: context.attemptId, puzzleId: context.ex.id }),
  context: ({ input }) => {
    const r = input.restore
    const base = { ex: input.ex, attemptId: input.attemptId, feedback: null, pending: null, saveError: null, oneShot: !!input.oneShot }
    if (r && r.puzzleKey === puzzleKey(input.ex)) {
      const rp = replay(input.ex, r.moves)
      return { ...base, attemptId: r.attemptId, startedAt: r.startedAt, moves: r.moves, k: rp.k, fen: rp.fen,
        lastMove: rp.lastMove ?? setupSquares(input.ex), hints: r.hints, mistakes: r.mistakes, revealed: !!r.revealed, outcome: r.outcome }
    }
    // `fen` is already AFTER the opponent's setup move: it is never applied here (only highlighted)
    return { ...base, startedAt: new Date().toISOString(), moves: [], k: 0, fen: input.ex.fen, lastMove: setupSquares(input.ex), hints: 0, mistakes: 0, revealed: false, outcome: null }
  },
  initial: 'boot',
  states: {
    boot: { always: [{ guard: 'restoredDone', target: 'finishing' }, { target: 'playing' }] },
    playing: {
      entry: { type: 'persist', params: ({ context }) => ({ record: toRecord(context, false) }) },
      on: {
        HINT: { guard: 'canHint', actions: [assign({ hints: ({ context }) => context.hints + 1 }),
          { type: 'persist', params: ({ context }) => ({ record: toRecord(context, false) }) }] },
        MOVE: {
          target: 'judging',
          actions: assign(({ context, event }) => {
            const o = judgeMove(context.ex, context.k, event.uci)
            const m = applyUci(context.fen, event.uci)
            return { pending: { ...o, uci: event.uci, fenAfter: m.fen, san: m.san, from: m.from, to: m.to },
              fen: m.fen, lastMove: [m.from, m.to] as [string, string], feedback: null }
          }),
        },
      },
    },
    judging: {
      always: [
        { guard: 'isCorrectDone', target: 'finishing', actions: assign(({ context }) => ({
          moves: [...context.moves, context.pending!.uci],
          outcome: { kind: 'solved' as const, result: resultOf(context, 'solved'), finishedAt: new Date().toISOString(), text: 'Puzzle solved.' } })) },
        { guard: 'isCorrect', target: 'replying', actions: assign(({ context }) => ({
          moves: [...context.moves, context.pending!.uci],
          feedback: { tone: 'good' as const, text: `${context.pending!.san} — correct. Keep going.` } })) },
        { guard: 'isAlternative', target: 'finishing', actions: assign(({ context }) => {
          const v = (context.pending as { verdict: MoveVerdict }).verdict
          const line = v.line?.length ? ` Engine line: ${v.line.join(' ')}.` : ''
          return { moves: [...context.moves, context.pending!.uci],
            outcome: { kind: 'alternative' as const, result: resultOf(context, 'alternative'), finishedAt: new Date().toISOString(),
              text: `${context.pending!.san} also works (${v.score}).${line}` } }
        }) },
        { guard: 'isBounce', target: 'bouncing', actions: assign(({ context }) => ({
          feedback: context.pending!.kind === 'slower_mate'
            ? { tone: 'info' as const, text: `${context.pending!.san} also mates, but there is a faster mate. Try again — no penalty.` }
            : { tone: 'info' as const, text: 'This move could not be checked. Try another — no penalty.' } })) },
        { guard: 'isInconclusive', target: 'revealing', actions: assign(({ context }) => ({
          feedback: { tone: 'info' as const, text: `${context.pending!.san} might be fine — the engine can't tell clearly. Not a mistake. The solution continues with its move.` } })) },
        { guard: 'isWrongOneShot', target: 'finishing', actions: assign(({ context }) => {
          const v = (context.pending as { verdict: MoveVerdict }).verdict
          return { mistakes: context.mistakes + 1, moves: [...context.moves, context.pending!.uci],
            outcome: { kind: 'failed' as const, result: 'failed' as const, finishedAt: new Date().toISOString(), text: `${context.pending!.san}? ${v.why ?? 'Not good enough.'}` } }
        }) },
        { guard: 'isWrong', target: 'wrong', actions: assign(({ context }) => {
          const v = (context.pending as { verdict: MoveVerdict }).verdict
          let arrow: [string, string] | undefined
          if (v.line?.[0]) { try { const r = sanToSquares(context.pending!.fenAfter, v.line[0]); arrow = [r.from, r.to] } catch { /* no arrow */ } }
          return { mistakes: context.mistakes + 1, feedback: { tone: 'bad' as const, text: `${context.pending!.san}? ${v.why ?? 'Not good enough.'}`, arrow } }
        }) },
      ],
    },
    replying: {
      // the solver's move is durable before the reply animates: a reload here resumes on the next solver turn
      entry: { type: 'persist', params: ({ context }) => ({ record: toRecord(context, false) }) },
      after: { REPLY_DELAY: { target: 'playing', actions: assign(({ context }) => {
        const r = applyUci(context.fen, context.ex.solution_uci[2 * context.k + 1])
        return { fen: r.fen, lastMove: [r.from, r.to] as [string, string], k: context.k + 1, pending: null }
      }) } },
    },
    bouncing: {
      after: { BOUNCE_DELAY: { target: 'playing', actions: assign(({ context }) => ({ ...positionAt(context.ex, context.k), pending: null })) } },
    },
    revealing: {
      entry: { type: 'persist', params: ({ context }) => ({ record: toRecord(context, false) }) },
      after: { REVEAL_DELAY: [
        { guard: 'hasReply', target: 'replying', actions: assign(({ context }) => {
          const book = context.ex.solution_uci[2 * context.k]
          const before = positionAt(context.ex, context.k)
          const m = applyUci(before.fen, book)
          return { fen: m.fen, lastMove: [m.from, m.to] as [string, string], moves: [...context.moves, book], revealed: true }
        }) },
        { target: 'finishing', actions: assign(({ context }) => {
          const book = context.ex.solution_uci[2 * context.k]
          const m = applyUci(positionAt(context.ex, context.k).fen, book)
          return { fen: m.fen, lastMove: [m.from, m.to] as [string, string], moves: [...context.moves, book], revealed: true,
            outcome: { kind: 'revealed' as const, result: resultOf(context, 'revealed'), finishedAt: new Date().toISOString(), text: 'Finished with the solution move.' } }
        }) },
      ] },
    },
    wrong: {
      entry: { type: 'persist', params: ({ context }) => ({ record: toRecord(context, false) }) },
      on: { RETRY: { target: 'playing', actions: assign(({ context }) => ({ ...positionAt(context.ex, context.k), feedback: null, pending: null })) } },
    },
    finishing: {
      entry: [assign(({ context }) => ({ feedback: { tone: 'good' as const, text: context.outcome!.text } })),
        { type: 'persist', params: ({ context }) => ({ record: toRecord(context, false) }) }],
      always: 'saving',
    },
    saving: {
      invoke: {
        src: 'saveAttempt',
        input: ({ context }) => ({ record: toRecord(context, true), solverMoves: solverMoves(context.ex), mode: context.ex.mode }),
        onDone: 'done',
        onError: { target: 'saveFailed', actions: assign({ saveError: ({ event }) => String(event.error) }) },
      },
    },
    saveFailed: { on: { RETRY_SAVE: { target: 'saving', actions: assign({ saveError: null }) } } },
    done: { type: 'final' },
  },
})

