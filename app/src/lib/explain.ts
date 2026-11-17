/**
 * Plain-language reason for a mistake in a played game, derived only from engine facts:
 * the position before, the move played, the engine's best move there, and the engine's
 * best reply after the played move. Never guesses beyond those facts.
 */
import { Chess } from 'chess.js'

const NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export interface MistakeFacts {
  fenBefore: string
  played: string // uci
  best: string | null // engine best move in fenBefore (uci)
  reply: string | null // engine best reply after the played move (uci)
  mateAfter: number | null // mate score after the played move, from the mover's point of view (negative = gets mated)
  mateBefore: number | null // mate available before (mover's pov, positive = mover mates)
}

export function explainMistake(f: MistakeFacts): string {
  const g = new Chess(f.fenBefore)
  const me = g.turn()
  const playedMove = g.move({ from: f.played.slice(0, 2), to: f.played.slice(2, 4), promotion: f.played[4] })
  if (f.mateAfter !== null && f.mateAfter < 0) return `Allows mate in ${Math.abs(f.mateAfter)}.`
  if (f.mateBefore !== null && f.mateBefore > 0) {
    const b = new Chess(f.fenBefore).move({ from: f.best!.slice(0, 2), to: f.best!.slice(2, 4), promotion: f.best![4] })
    return `Misses a forced mate in ${f.mateBefore}, starting with ${b.san}.`
  }
  if (f.reply) {
    const after = new Chess(g.fen())
    const target = after.get(f.reply.slice(2, 4) as never)
    const r = after.move({ from: f.reply.slice(0, 2), to: f.reply.slice(2, 4), promotion: f.reply[4] })
    if (target && target.color === me && target.type !== 'k') {
      const hung = target.type
      return r.to === playedMove.to
        ? `The ${NAMES[playedMove.piece]} on ${playedMove.to} can be taken: ${r.san} wins your ${NAMES[hung]}.`
        : `Leaves your ${NAMES[hung]} on ${r.to} undefended: ${r.san} wins it.`
    }
    if (after.inCheck() && r.san.includes('+')) return `Allows ${r.san}, a strong check that wins material or the initiative.`
  }
  if (f.best) {
    const b = new Chess(f.fenBefore)
    const cap = b.get(f.best.slice(2, 4) as never)
    const bm = b.move({ from: f.best.slice(0, 2), to: f.best.slice(2, 4), promotion: f.best[4] })
    if (cap && cap.color !== me && VALUE[cap.type] >= 3) return `Misses ${bm.san}, winning the ${NAMES[cap.type]}.`
    if (bm.san.includes('+')) return `Misses the forcing ${bm.san}.`
    return `Better was ${bm.san}.`
  }
  return 'A clearly weaker move.'
}
