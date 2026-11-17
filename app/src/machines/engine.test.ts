import { describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

vi.mock('../../node_modules/stockfish/bin/stockfish-18-lite-single.js?url', () => ({ default: 'sf.js' }))
vi.mock('../../node_modules/stockfish/bin/stockfish-18-lite-single.wasm?url', () => ({ default: 'sf.wasm' }))
const { engineMachine } = await import('./engine')
import type { EngineFactory, SearchResult } from './engine'

/** Fake UCI engine: answers handshake; `go` replies asynchronously with a move derived from the fen. */
function fake(log: string[]): EngineFactory {
  return (onLine) => {
    let fen = ''
    let pending: ReturnType<typeof setTimeout> | null = null
    const finish = () => { onLine('info depth 5 multipv 1 score cp 42 pv e2e4 e7e5'); onLine(`bestmove ${fen.startsWith('8/') ? 'a1a2' : 'e2e4'}`); pending = null }
    return {
      post: (c) => {
        log.push(c)
        if (c === 'uci') setTimeout(() => onLine('uciok'))
        else if (c === 'isready') setTimeout(() => onLine('readyok'))
        else if (c.startsWith('position fen ')) fen = c.slice(13)
        else if (c.startsWith('go')) pending = setTimeout(finish, 20)
        else if (c === 'stop' && pending) { clearTimeout(pending); finish() }
      },
      terminate: () => {},
    }
  }
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

function start() {
  const log: string[] = []
  const actor = createActor(engineMachine, { input: { factory: fake(log) } })
  const results: SearchResult[] = []
  actor.on('RESULT', (e) => results.push(e.result))
  actor.start()
  return { actor, log, results }
}

describe('engine', () => {
  it('boots, searches, and returns the result with its request id', async () => {
    const { actor, results, log } = start()
    actor.send({ type: 'SEARCH', req: { id: 'r1', fen: 'start-fen', depth: 5, skill: 3 } })
    await tick(60)
    expect(results).toEqual([{ id: 'r1', bestmove: 'e2e4', score: { cp: 42, mate: undefined }, pv: ['e2e4', 'e7e5'] }])
    expect(log).toContain('setoption name Skill Level value 3')
    expect(actor.getSnapshot().value).toBe('ready')
  })
  it('a newer request supersedes the running one: the stale result is never delivered', async () => {
    const { actor, results } = start()
    await tick(5)
    actor.send({ type: 'SEARCH', req: { id: 'old', fen: 'start-fen', depth: 20 } })
    await tick(5)
    actor.send({ type: 'SEARCH', req: { id: 'new', fen: '8/8/8/8/8/8/8/K6k w - - 0 1', depth: 5 } })
    await tick(80)
    expect(results.map((r) => r.id)).toEqual(['new'])
    expect(results[0].bestmove).toBe('a1a2')
  })
  it('cancel drops the result', async () => {
    const { actor, results } = start()
    await tick(5)
    actor.send({ type: 'SEARCH', req: { id: 'x', fen: 'start-fen', depth: 20 } })
    await tick(5)
    actor.send({ type: 'CANCEL' })
    await tick(60)
    expect(results).toEqual([])
    expect(actor.getSnapshot().value).toBe('ready')
  })
  it('limited strength uses UCI_Elo', async () => {
    const { actor, log } = start()
    actor.send({ type: 'SEARCH', req: { id: 'e', fen: 'start-fen', movetime: 10, elo: 1500 } })
    await tick(60)
    expect(log).toContain('setoption name UCI_Elo value 1500')
  })
})
