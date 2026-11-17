import { describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import { Chess } from 'chess.js'

vi.mock('../../node_modules/stockfish/bin/stockfish-18-lite-single.js?url', () => ({ default: 'sf.js' }))
vi.mock('../../node_modules/stockfish/bin/stockfish-18-lite-single.wasm?url', () => ({ default: 'sf.wasm' }))
const { vsComputer } = await import('./vsComputer')
import type { EngineFactory } from './engine'
import { START_FEN, type GameRecord } from '@shared/game'

/** Fake engine: plays the first legal move (sorted) after `delay` ms; `stop` answers immediately. */
function fakeEngine(delay = 15): EngineFactory {
  return (onLine) => {
    let fen = ''
    let t: ReturnType<typeof setTimeout> | null = null
    const answer = () => {
      const moves = new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? '')).sort()
      onLine(`info depth 1 score cp 0 pv ${moves[0]}`); onLine(`bestmove ${moves[0]}`); t = null
    }
    return {
      post: (c) => {
        if (c === 'uci') setTimeout(() => onLine('uciok'))
        else if (c === 'isready') setTimeout(() => onLine('readyok'))
        else if (c.startsWith('position fen ')) fen = c.slice(13)
        else if (c.startsWith('go')) t = setTimeout(answer, delay)
        else if (c === 'stop' && t) { clearTimeout(t); answer() }
      },
      terminate: () => {},
    }
  }
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

let clockNow = 1_000_000
const now = () => clockNow
function start(restore?: GameRecord | null, delay = 15) {
  const saved: GameRecord[] = []
  const actor = createActor(vsComputer.provide({ actions: { persist: (_, p) => { saved.push(p.record) } } }), { input: { restore, factory: fakeEngine(delay), now } })
  actor.start()
  return { actor, saved }
}
const state = (a: ReturnType<typeof start>['actor']) => JSON.stringify(a.getSnapshot().value)

describe('vsComputer', () => {
  it('player move → engine replies → your turn; every ply persisted', async () => {
    const { actor, saved } = start()
    actor.send({ type: 'START', color: 'white', level: 1, tc: null })
    actor.send({ type: 'MOVE', uci: 'e2e4' })
    expect(state(actor)).toContain('thinking')
    await tick(60)
    expect(state(actor)).toContain('yourTurn')
    expect(actor.getSnapshot().context.moves).toHaveLength(2)
    expect(saved.at(-1)!.moves).toHaveLength(2)
  })
  it('illegal moves are ignored', () => {
    const { actor } = start()
    actor.send({ type: 'START', color: 'white', level: 1, tc: null })
    actor.send({ type: 'MOVE', uci: 'e2e5' })
    expect(actor.getSnapshot().context.moves).toEqual([])
  })
  it('engine opens when you play Black', async () => {
    const { actor } = start()
    actor.send({ type: 'START', color: 'black', level: 1, tc: null })
    await tick(60)
    expect(actor.getSnapshot().context.moves).toHaveLength(1)
    expect(state(actor)).toContain('yourTurn')
  })
  it('takeback while the engine thinks cancels the request (no stale reply lands)', async () => {
    const { actor } = start()
    actor.send({ type: 'START', color: 'white', level: 1, tc: null })
    actor.send({ type: 'MOVE', uci: 'e2e4' })
    actor.send({ type: 'TAKEBACK' })
    await tick(60)
    expect(actor.getSnapshot().context.moves).toEqual([])
    expect(state(actor)).toContain('yourTurn')
  })
  it('after a takeback to the same ply, the old engine reply is never reused', async () => {
    const { actor } = start()
    actor.send({ type: 'START', color: 'white', level: 1, tc: null })
    actor.send({ type: 'MOVE', uci: 'e2e4' }); await tick(60)
    const firstReply = actor.getSnapshot().context.moves[1]
    actor.send({ type: 'TAKEBACK' })
    actor.send({ type: 'MOVE', uci: 'd2d4' }); await tick(60)
    const m = actor.getSnapshot().context.moves
    expect(m[0]).toBe('d2d4')
    expect(m).toHaveLength(2)
    // the reply is legal in the new position (a stale reply for 1.e4 could be illegal or wrong)
    expect(() => { const g = new Chess(); g.move({ from: 'd2', to: 'd4' }); g.move({ from: m[1].slice(0, 2), to: m[1].slice(2, 4) }) }).not.toThrow()
    void firstReply
  })
  it('detects checkmate (fool\'s mate) and persists the result', async () => {
    const { actor, saved } = start({ gameId: 'g', schemaVersion: 2, status: 'active', color: 'black', level: 1, initialFen: START_FEN, timeControl: null, clocks: null, moves: ['f2f3', 'e7e5', 'g2g4'], result: null, startedAt: '', updatedAt: '', endedAt: null })
    await tick(5)
    actor.send({ type: 'MOVE', uci: 'd8h4' })
    expect(state(actor)).toBe('"over"')
    expect(actor.getSnapshot().context.result).toEqual({ winner: 'black', reason: 'checkmate' })
    expect(saved.at(-1)!.result).toEqual({ winner: 'black', reason: 'checkmate' })
  })
  it('restores a game where it is the engine\'s turn and lets it reply', async () => {
    const { actor } = start({ gameId: 'g2', schemaVersion: 2, status: 'active', color: 'white', level: 1, initialFen: START_FEN, timeControl: null, clocks: null, moves: ['e2e4'], result: null, startedAt: '', updatedAt: '', endedAt: null })
    expect(state(actor)).toContain('thinking')
    await tick(60)
    expect(actor.getSnapshot().context.moves).toHaveLength(2)
  })
  it('hint arrives as an arrow for the current position only', async () => {
    const { actor } = start()
    actor.send({ type: 'START', color: 'white', level: 1, tc: null })
    await tick(10)
    actor.send({ type: 'HINT' }); await tick(60)
    expect(actor.getSnapshot().context.hint).toMatch(/^[a-h][1-8][a-h][1-8]/)
  })

  it('clocks: your time is deducted on move, increment added; flag falls at zero', async () => {
    const { actor } = start(null, 5)
    actor.send({ type: 'START', color: 'white', level: 1, tc: { baseMs: 60_000, incMs: 2_000 } })
    clockNow += 10_000
    actor.send({ type: 'MOVE', uci: 'e2e4' })
    expect(actor.getSnapshot().context.clocks!.white).toBe(52_000) // 60 - 10 + 2
    await tick(40)
    expect(JSON.stringify(actor.getSnapshot().value)).toContain('yourTurn')
  })
  it('you lose on time (real timer, tiny clock)', async () => {
    const { actor, saved } = start(null, 5)
    actor.send({ type: 'START', color: 'white', level: 1, tc: { baseMs: 30, incMs: 0 } })
    await tick(80)
    expect(actor.getSnapshot().value).toBe('over')
    expect(actor.getSnapshot().context.result).toEqual({ winner: 'black', reason: 'time' })
    expect(saved.at(-1)!.status).toBe('finished')
  })
  it('the engine can lose on time too', async () => {
    const { actor } = start(null, 500) // engine answers far too slowly
    actor.send({ type: 'START', color: 'black', level: 1, tc: { baseMs: 40, incMs: 0 } })
    await tick(120)
    expect(actor.getSnapshot().context.result).toEqual({ winner: 'black', reason: 'time' })
  })
  it('abandon ends the game as a loss and keeps it (status abandoned)', async () => {
    const { actor, saved } = start()
    actor.send({ type: 'START', color: 'white', level: 1, tc: null })
    actor.send({ type: 'MOVE', uci: 'e2e4' }); await tick(40)
    actor.send({ type: 'ABANDON' })
    expect(actor.getSnapshot().value).toBe('over')
    expect(saved.at(-1)).toMatchObject({ status: 'abandoned', result: { winner: 'black', reason: 'abandoned' }, moves: { length: 2 } })
    actor.send({ type: 'NEW_GAME' })
    expect(actor.getSnapshot().value).toBe('setup')
  })
  it('can start from a position (retry from a mistake)', async () => {
    const { actor } = start()
    actor.send({ type: 'START', color: 'white', level: 1, tc: null, fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1' })
    actor.send({ type: 'MOVE', uci: 'a1a8' })
    expect(actor.getSnapshot().context.result).toEqual({ winner: 'white', reason: 'checkmate' })
  })
})
