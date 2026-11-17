/**
 * Estimated playing rating from games against the computer (standard Elo update).
 *
 * The opponent's rating is the level's approximate Elo (midpoint of its bracket), so the
 * result is an *estimate*: Stockfish's strength settings are calibrated against engines,
 * not people. Deterministic over the game history → identical on every device.
 */
import type { GameRecord } from './game'

export interface RatingPoint { gameId: string; at: string; rating: number; delta: number; opp: number; score: number }
export interface RatingSummary { rating: number; games: number; history: RatingPoint[]; provisional: boolean }

export function rated(g: GameRecord, startFen: string): boolean {
  return (g.status === 'finished' || g.status === 'abandoned') && !!g.result && g.initialFen === startFen && g.moves.length >= 2
}

export function playRating(games: GameRecord[], levelElo: (level: number) => number, startFen: string, start = 800): RatingSummary {
  const list = games.filter((g) => rated(g, startFen)).sort((a, b) => ((a.endedAt ?? a.updatedAt) < (b.endedAt ?? b.updatedAt) ? -1 : 1))
  let r = start
  const history: RatingPoint[] = []
  list.forEach((g, i) => {
    const opp = levelElo(g.level)
    const score = g.result!.winner === null ? 0.5 : g.result!.winner === g.color ? 1 : 0
    const expected = 1 / (1 + 10 ** ((opp - r) / 400))
    const k = i < 20 ? 40 : 24
    const delta = Math.round(k * (score - expected))
    r += delta
    history.push({ gameId: g.gameId, at: g.endedAt ?? g.updatedAt, rating: r, delta, opp, score })
  })
  return { rating: r, games: list.length, history, provisional: list.length < 10 }
}

/** Per-level record: wins / draws / losses. */
export function recordByLevel(games: GameRecord[], startFen: string) {
  const out = new Map<number, { w: number; d: number; l: number }>()
  games.filter((g) => rated(g, startFen)).forEach((g) => {
    const rec = out.get(g.level) ?? { w: 0, d: 0, l: 0 }
    if (g.result!.winner === null) rec.d++
    else if (g.result!.winner === g.color) rec.w++
    else rec.l++
    out.set(g.level, rec)
  })
  return out
}
