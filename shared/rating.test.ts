import { describe, expect, it } from 'vitest'
import { playRating, recordByLevel } from './rating'
import { START_FEN, type GameRecord } from './game'

let n = 0
const g = (p: Partial<GameRecord>): GameRecord => ({
  gameId: `g${++n}`, schemaVersion: 2, status: 'finished', color: 'white', level: 3, initialFen: START_FEN, timeControl: null, clocks: null,
  moves: ['e2e4', 'e7e5', 'g1f3'], result: { winner: 'white', reason: 'checkmate' }, startedAt: '', updatedAt: `2026-11-14T10:${String(n).padStart(2, '0')}:00Z`,
  endedAt: `2026-11-14T10:${String(n).padStart(2, '0')}:00Z`, ...p,
})
const elo = (lv: number) => [0, 550, 750, 950, 1150, 1400, 1700, 2000, 2600][lv]

describe('play rating', () => {
  it('a win against a stronger level gains more than against a weaker one', () => {
    const strong = playRating([g({ level: 5 })], elo, START_FEN)
    const weak = playRating([g({ level: 1 })], elo, START_FEN)
    expect(strong.rating).toBeGreaterThan(weak.rating)
    expect(weak.rating).toBeGreaterThan(800)
  })
  it('losses lower it; abandoned counts as a loss; tiny and position games are not rated', () => {
    const r = playRating([
      g({ result: { winner: 'black', reason: 'checkmate' } }),
      g({ status: 'abandoned', result: { winner: 'black', reason: 'abandoned' } }),
      g({ moves: ['e2e4'] }),
      g({ initialFen: '8/8/8/8/8/8/8/K6k w - - 0 1' }),
      g({ status: 'active', result: null }),
    ], elo, START_FEN)
    expect(r.games).toBe(2)
    expect(r.rating).toBeLessThan(800)
    expect(r.provisional).toBe(true)
  })
  it('is order-independent of input order (sorted by end time)', () => {
    const a = g({}), b = g({ result: { winner: null, reason: 'stalemate' } })
    expect(playRating([a, b], elo, START_FEN).rating).toBe(playRating([b, a], elo, START_FEN).rating)
  })
  it('record per level', () => {
    const rec = recordByLevel([g({ level: 2 }), g({ level: 2, result: { winner: null, reason: 'x' } }), g({ level: 2, result: { winner: 'black', reason: 'x' } })], START_FEN)
    expect(rec.get(2)).toEqual({ w: 1, d: 1, l: 1 })
  })
})
