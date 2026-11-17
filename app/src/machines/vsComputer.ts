/**
 * vsComputer — a game against Stockfish, with optional clocks.
 *
 *   setup ──START{color,level,tc,fen?}──▶ playing.decide ─┬─▶ yourTurn ──MOVE──▶ decide
 *                                                         ├─▶ thinking ──engine RESULT{id}──▶ decide
 *                                                         └─▶ over (mate, draw, resign, abandon, flag)
 *   yourTurn: HINT, TAKEBACK; your flag falls after your remaining time
 *   thinking: TAKEBACK cancels the engine first; the engine can flag too
 *   playing: RESIGN, ABANDON (both cancel the engine)
 *   over ──NEW_GAME──▶ setup
 *
 * Clocks: remaining ms per side, updated when a move is made (elapsed since the turn began,
 * plus increment). They pause when you leave the page (no opponent is waiting): on restore the
 * turn simply starts again. Engine requests carry unique ids; stale results are ignored.
 * The durable GameRecord (shared/game.ts) is the storage/sync contract; restore = replay moves.
 */
import { assign, enqueueActions, sendTo, setup } from 'xstate'
import { Chess } from 'chess.js'
import { engineMachine, type SearchRequest, type SearchResult, type EngineFactory } from './engine'
import { START_FEN, type GameRecord, type TimeControl } from '@shared/game'

/** Rough Elo per level (midpoint used for the rating estimate). 5–7 use Stockfish's UCI_Elo; 1–4 and 8 are estimates. */
export const LEVELS = [
  { n: 1, label: 'Beginner', elo: '≈ 400–700', mid: 550, req: { skill: 0, depth: 1 } },
  { n: 2, label: 'Casual', elo: '≈ 600–900', mid: 750, req: { skill: 2, depth: 2 } },
  { n: 3, label: 'Novice', elo: '≈ 800–1100', mid: 950, req: { skill: 5, depth: 4 } },
  { n: 4, label: 'Improver', elo: '≈ 1000–1300', mid: 1150, req: { skill: 8, depth: 6 } },
  { n: 5, label: 'Club player', elo: '≈ 1300–1500', mid: 1400, req: { elo: 1400, movetime: 300 } },
  { n: 6, label: 'Strong club', elo: '≈ 1600–1800', mid: 1700, req: { elo: 1700, movetime: 400 } },
  { n: 7, label: 'Expert', elo: '≈ 1900–2100', mid: 2000, req: { elo: 2000, movetime: 600 } },
  { n: 8, label: 'Strong', elo: '2500+', mid: 2600, req: { skill: 20, movetime: 1000 } },
] as const satisfies readonly { n: number; label: string; elo: string; mid: number; req: Partial<SearchRequest> }[]

export { START_FEN }

export interface GameContext {
  gameId: string
  color: 'white' | 'black'
  level: number
  initialFen: string
  tc: TimeControl | null
  clocks: { white: number; black: number } | null
  turnStartedAt: number
  moves: string[]
  fen: string
  lastMove?: [string, string]
  result: GameRecord['result']
  status: GameRecord['status']
  expected: string | null
  hintExpected: string | null
  seq: number
  hint: string | null
  startedAt: string
  endedAt: string | null
  factory?: EngineFactory
  now: () => number
}

export type GameEvent =
  | { type: 'START'; color: 'white' | 'black'; level: number; tc: TimeControl | null; fen?: string }
  | { type: 'MOVE'; uci: string }
  | { type: 'HINT' }
  | { type: 'TAKEBACK' }
  | { type: 'RESIGN' }
  | { type: 'ABANDON' }
  | { type: 'NEW_GAME' }

export function replayMoves(moves: string[], initialFen = START_FEN) {
  const g = new Chess(initialFen)
  let last: [string, string] | undefined
  for (const u of moves) { const m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); last = [m.from, m.to] }
  return { g, last }
}

function outcome(g: Chess): GameRecord['result'] {
  if (g.isCheckmate()) return { winner: g.turn() === 'w' ? 'black' : 'white', reason: 'checkmate' }
  if (g.isStalemate()) return { winner: null, reason: 'stalemate' }
  if (g.isInsufficientMaterial()) return { winner: null, reason: 'insufficient material' }
  if (g.isThreefoldRepetition()) return { winner: null, reason: 'threefold repetition' }
  if (g.isDraw()) return { winner: null, reason: '50-move rule' }
  return null
}

export const sideToMove = (fen: string): 'white' | 'black' => (fen.split(' ')[1] === 'w' ? 'white' : 'black')
const other = (c: 'white' | 'black'): 'white' | 'black' => (c === 'white' ? 'black' : 'white')

/** Apply a move: update board, clocks (elapsed + increment) and result. */
function applyMove(c: GameContext, uci: string) {
  const g = new Chess(c.fen)
  const mover = sideToMove(c.fen)
  const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  let clocks = c.clocks
  if (clocks && c.tc) {
    const left = Math.max(0, clocks[mover] - (c.now() - c.turnStartedAt))
    clocks = { ...clocks, [mover]: left + c.tc.incMs }
  }
  const result = outcome(g)
  return {
    moves: [...c.moves, uci], fen: g.fen(), lastMove: [m.from, m.to] as [string, string], clocks, result, hint: null, hintExpected: null,
    status: result ? ('finished' as const) : c.status, endedAt: result ? new Date(c.now()).toISOString() : null,
  }
}

/** Engine thinking time: the level's setting, but never more than a sensible slice of its clock. */
function engineRequest(c: GameContext): SearchRequest {
  const lv = (LEVELS.find((l) => l.n === c.level) ?? LEVELS[2]).req as Partial<SearchRequest>
  const req: SearchRequest = { id: c.expected!, fen: c.fen, ...lv }
  if (c.clocks && c.tc) {
    const mine = c.clocks[other(c.color)]
    const budget = Math.max(50, Math.min(mine / 30 + c.tc.incMs * 0.8, mine / 4))
    req.movetime = Math.round(Math.min(req.movetime ?? budget, budget))
  }
  return req
}

const fromRecord = (r: GameRecord): Partial<GameContext> => {
  const { g, last } = replayMoves(r.moves, r.initialFen)
  return {
    gameId: r.gameId, color: r.color, level: r.level, initialFen: r.initialFen, tc: r.timeControl, clocks: r.clocks, moves: r.moves,
    fen: g.fen(), lastMove: last, result: r.result, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt,
  }
}

export const toGameRecord = (c: GameContext): GameRecord => ({
  gameId: c.gameId, schemaVersion: 2, status: c.status, color: c.color, level: c.level, initialFen: c.initialFen, timeControl: c.tc,
  clocks: c.clocks, moves: c.moves, result: c.result, startedAt: c.startedAt, updatedAt: new Date(c.now()).toISOString(), endedAt: c.endedAt,
})

const loss = (c: GameContext, reason: string, status: GameRecord['status'] = 'finished'): Partial<GameContext> => ({
  result: { winner: other(c.color), reason }, status, endedAt: new Date(c.now()).toISOString(), expected: null,
})

export const vsComputer = setup({
  types: {} as {
    context: GameContext
    events: GameEvent | { type: 'ENGINE'; result: SearchResult }
    input: { restore?: GameRecord | null; factory?: EngineFactory; now?: () => number }
  },
  actors: { engine: engineMachine },
  actions: {
    persist: (_, _p: { record: GameRecord }) => {},
  },
  delays: {
    YOUR_FLAG: ({ context }) => (context.clocks ? Math.max(0, context.clocks[context.color]) : 1e12),
    ENGINE_FLAG: ({ context }) => (context.clocks ? Math.max(0, context.clocks[other(context.color)]) : 1e12),
  },
  guards: {
    isOver: ({ context }) => !!context.result,
    enginesTurn: ({ context }) => sideToMove(context.fen) !== context.color,
    legal: ({ context, event }) => {
      const u = (event as { uci: string }).uci
      try { new Chess(context.fen).move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); return true } catch { return false }
    },
    isExpected: ({ context, event }) => (event as { result: SearchResult }).result.id === context.expected,
    isHintResult: ({ context, event }) => (event as { result: SearchResult }).result.id === context.hintExpected,
    canTakeback: ({ context }) => context.moves.length > 0,
    hasRestore: ({ context }) => !!context.gameId,
    timed: ({ context }) => !!context.clocks,
  },
}).createMachine({
  id: 'vsComputer',
  context: ({ input }) => ({
    gameId: '', color: 'white', level: 3, initialFen: START_FEN, tc: null, clocks: null, turnStartedAt: 0, moves: [], fen: START_FEN,
    result: null, status: 'active', expected: null, hintExpected: null, seq: 0, hint: null, startedAt: '', endedAt: null,
    factory: input.factory, now: input.now ?? Date.now,
    ...(input.restore ? fromRecord(input.restore) : {}),
  }),
  invoke: {
    id: 'engine', src: 'engine', input: ({ context }) => ({ factory: context.factory }),
    onSnapshot: { actions: enqueueActions(({ context, event, enqueue }) => {
      const last = event.snapshot.context.last as SearchResult | null
      if (last && (last.id === context.expected || last.id === context.hintExpected)) enqueue.raise({ type: 'ENGINE', result: last })
    }) },
  },
  initial: 'boot',
  states: {
    boot: { always: [{ guard: 'hasRestore', target: 'playing' }, { target: 'setup' }] },
    setup: {
      on: { START: { target: 'playing', actions: assign(({ context, event }) => {
        const fen = event.fen ?? START_FEN
        return {
          gameId: crypto.randomUUID(), color: event.color, level: event.level, initialFen: fen, tc: event.tc,
          clocks: event.tc ? { white: event.tc.baseMs, black: event.tc.baseMs } : null, moves: [], fen, lastMove: undefined,
          result: null, status: 'active' as const, expected: null, hintExpected: null, hint: null,
          startedAt: new Date(context.now()).toISOString(), endedAt: null,
        }
      }) } },
    },
    playing: {
      initial: 'decide',
      on: {
        ABANDON: { target: '#vsComputer.over', actions: [sendTo('engine', { type: 'CANCEL' }), assign(({ context }) => loss(context, 'abandoned', 'abandoned'))] },
        RESIGN: { target: '#vsComputer.over', actions: [sendTo('engine', { type: 'CANCEL' }), assign(({ context }) => loss(context, 'resignation'))] },
      },
      states: {
        decide: {
          entry: { type: 'persist', params: ({ context }) => ({ record: toGameRecord(context) }) },
          always: [
            { guard: 'isOver', target: '#vsComputer.over' },
            { guard: 'enginesTurn', target: 'thinking' },
            { target: 'yourTurn' },
          ],
        },
        yourTurn: {
          entry: assign({ turnStartedAt: ({ context }) => context.now() }),
          after: { YOUR_FLAG: { guard: 'timed', target: '#vsComputer.over', actions: assign(({ context }) => ({
            ...loss(context, 'time'), clocks: context.clocks && { ...context.clocks, [context.color]: 0 } })) } },
          on: {
            MOVE: { guard: 'legal', target: 'decide', actions: assign(({ context, event }) => applyMove(context, event.uci)) },
            HINT: { actions: [assign(({ context }) => ({ seq: context.seq + 1, hintExpected: `hint:${context.gameId}:${context.seq + 1}` })),
              sendTo('engine', ({ context }) => ({ type: 'SEARCH', req: { id: context.hintExpected!, fen: context.fen, depth: 12, skill: 20 } }))] },
            ENGINE: { guard: 'isHintResult', actions: assign({ hint: ({ event }) => event.result.bestmove, hintExpected: null }) },
            TAKEBACK: { guard: 'canTakeback', target: 'decide', actions: assign(({ context }) => {
              const n = context.moves.length >= 2 ? 2 : 1 // your move and the engine's reply
              const moves = context.moves.slice(0, -n)
              const { g, last } = replayMoves(moves, context.initialFen)
              return { moves, fen: g.fen(), lastMove: last, hint: null, result: null }
            }) },
          },
        },
        thinking: {
          entry: [
            assign(({ context }) => ({ turnStartedAt: context.now(), seq: context.seq + 1, expected: `${context.gameId}:${context.moves.length}:${context.seq + 1}` })),
            sendTo('engine', ({ context }) => ({ type: 'SEARCH', req: engineRequest(context) })),
          ],
          after: { ENGINE_FLAG: { guard: 'timed', target: '#vsComputer.over', actions: [sendTo('engine', { type: 'CANCEL' }), assign(({ context }) => ({
            result: { winner: context.color, reason: 'time' }, status: 'finished' as const, endedAt: new Date(context.now()).toISOString(), expected: null,
            clocks: context.clocks && { ...context.clocks, [other(context.color)]: 0 } }))] } },
          on: {
            ENGINE: { guard: 'isExpected', target: 'decide', actions: assign(({ context, event }) => ({ ...applyMove(context, event.result.bestmove), expected: null })) },
            TAKEBACK: { guard: 'canTakeback', target: 'decide', actions: [sendTo('engine', { type: 'CANCEL' }), assign(({ context }) => {
              const moves = context.moves.slice(0, -1)
              const { g, last } = replayMoves(moves, context.initialFen)
              return { moves, fen: g.fen(), lastMove: last, expected: null, hint: null }
            })] },
          },
        },
      },
    },
    over: {
      entry: { type: 'persist', params: ({ context }) => ({ record: toGameRecord(context) }) },
      on: { NEW_GAME: { target: 'setup', actions: assign({ gameId: '', moves: [], result: null, status: 'active' as const, clocks: null, hint: null }) } },
    },
  },
})
