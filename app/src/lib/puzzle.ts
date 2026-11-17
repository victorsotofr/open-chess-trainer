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

/** Judge the solver's k-th move (0-based). */
export function judgeMove(ex: Exercise, k: number, uci: string): MoveOutcome {
  const i = solverIndex(k)
  const book = ex.solution_uci[i]
  if (uci === book) {
    const reply = ex.solution_uci[i + 1]
    const done = i + 2 >= ex.solution_uci.length
    return { kind: 'correct', done, reply: done ? undefined : reply }
  }
  const verdict = ex.plies[k]?.moves[uci]
  if (!verdict) return { kind: 'unknown' }
  switch (verdict.v) {
    case 'accepted':
      return { kind: 'alternative', verdict }
    case 'slower_mate':
      return { kind: 'slower_mate', verdict }
    case 'inconclusive':
      return { kind: 'inconclusive', verdict, bookMove: book }
    case 'book': // promotion-equivalent spellings
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
