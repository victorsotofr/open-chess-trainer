import { Chess } from 'chess.js'
import type { Exercise } from '../lib/types'

export const puzzleKey = (ex: Exercise) => `${ex.fen}|${ex.solution_uci.join(' ')}`

export function applyUci(fen: string, uci: string): { fen: string; san: string; from: string; to: string } {
  const g = new Chess(fen)
  const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  return { fen: g.fen(), san: mv.san, from: mv.from, to: mv.to }
}

export interface ReplayResult {
  fen: string
  k: number // index of the solver move to find next
  lastMove?: [string, string]
  /** true if the last stored move was a non-book move (an accepted alternative) */
  endedOnAlternative: boolean
}

/**
 * Rebuild the board from the solver's stored moves.
 * Book replies are always re-applied, so a session saved "during the opponent's reply"
 * restores onto the solver's turn — never a half-applied state.
 */
export function replay(ex: Exercise, moves: string[]): ReplayResult {
  let fen = ex.fen
  let k = 0
  let lastMove: [string, string] | undefined
  for (let i = 0; i < moves.length; i++) {
    const book = ex.solution_uci[2 * k]
    const m = applyUci(fen, moves[i])
    fen = m.fen
    lastMove = [m.from, m.to]
    if (moves[i] !== book) return { fen, k, lastMove, endedOnAlternative: true }
    const reply = ex.solution_uci[2 * k + 1]
    if (reply) {
      const r = applyUci(fen, reply)
      fen = r.fen
      lastMove = [r.from, r.to]
    }
    k++
  }
  return { fen, k, lastMove, endedOnAlternative: false }
}

/** Position before solver move k (used to undo a wrong move). */
export function positionAt(ex: Exercise, k: number): { fen: string; lastMove?: [string, string] } {
  const r = replay(ex, ex.solution_uci.filter((_, i) => i % 2 === 0).slice(0, k))
  return { fen: r.fen, lastMove: r.lastMove }
}
