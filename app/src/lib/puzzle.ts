import { Chess } from 'chess.js'
import type { Exercise, MoveVerdict } from './types'

/** Outcome of one solver move, decided from the precomputed Stockfish verdicts. */
export type MoveOutcome =
  | { kind: 'correct'; done: boolean; reply?: string } // book move; reply = opponent's book answer (uci)
  | { kind: 'alternative'; verdict: MoveVerdict } // also wins -> puzzle ends, book line shown
  | { kind: 'slower_mate'; verdict: MoveVerdict } // mates, but slower: retry, no penalty
  | { kind: 'inconclusive'; verdict: MoveVerdict; bookMove: string } // book move revealed, no penalty
  | { kind: 'wrong'; verdict: MoveVerdict } // counted as a mistake
  | { kind: 'unknown' } // no verdict stored (should not happen): never judge blindly

/** Solution index of the solver's k-th move. */
export const solverIndex = (k: number) => 2 * k

export const solverMoves = (ex: Exercise) => Math.ceil(ex.solution_uci.length / 2)

/** Does `uci` give checkmate in the position before the solver's k-th move? */
export function isMateMove(ex: Exercise, k: number, uci: string): boolean {
  try {
    const g = new Chess(ex.fen)
    for (const u of ex.solution_uci.slice(0, solverIndex(k))) g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })
    g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' })
    return g.isCheckmate()
  } catch { return false }
}

const MISMATCH: MoveVerdict = { v: 'rejected', score: '', why: "Doesn't match the solution." }

/**
 * Judge the solver's k-th move (0-based).
 * Policy "engine": the solution move, else the stored Stockfish verdict for this move.
 * Policy "reference" (no verdicts): the solution move; any legal checkmate also wins (as on Lichess);
 * anything else "doesn't match the solution" — never an invented refutation.
 */
export function judgeMove(ex: Exercise, k: number, uci: string): MoveOutcome {
  const i = solverIndex(k)
  const book = ex.solution_uci[i]
  if (uci === book) {
    const reply = ex.solution_uci[i + 1]
    const done = i + 2 >= ex.solution_uci.length
    return { kind: 'correct', done, reply: done ? undefined : reply }
  }
  if (isMateMove(ex, k, uci)) return { kind: 'alternative', verdict: { v: 'accepted', score: '#', why: 'Checkmate.' } }
  const verdict = ex.plies[k]?.moves[uci]
  if (!verdict) return ex.judging === 'reference' ? { kind: 'wrong', verdict: MISMATCH } : { kind: 'unknown' }
  switch (verdict.v) {
    case 'accepted':
      return { kind: 'alternative', verdict }
    case 'slower_mate':
      return { kind: 'slower_mate', verdict }
    case 'inconclusive':
      return { kind: 'inconclusive', verdict, bookMove: book }
    case 'solution': // promotion-equivalent spellings
      return { kind: 'correct', done: i + 2 >= ex.solution_uci.length, reply: ex.solution_uci[i + 1] }
    default:
      return { kind: 'wrong', verdict }
  }
}

/** Book line rendered with move numbers, starting from the side to move. */
export function formatLine(sans: string[], whiteToMove: boolean, startNumber = 1): string {
  const out: string[] = []
  let n = startNumber
  let white = whiteToMove
  sans.forEach((san, idx) => {
    if (white) out.push(`${n}.${san}`)
    else out.push(idx === 0 ? `${n}...${san}` : san)
    if (!white) n++
    white = !white
  })
  return out.join(' ')
}
