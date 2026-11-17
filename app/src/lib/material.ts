/** Material balance from a FEN, the chess.com way: captured pieces per side and the point lead. */

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 }
const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 }
const ORDER = ['q', 'r', 'b', 'n', 'p'] as const

export interface Material {
  /** pieces White has captured (Black's missing pieces), most valuable first */
  whiteCaptured: string[]
  blackCaptured: string[]
  /** White points minus Black points (positive = White ahead) */
  diff: number
}

export function material(fen: string): Material {
  const board = fen.split(' ')[0]
  const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 } as Record<string, number>, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } as Record<string, number> }
  for (const ch of board) {
    const t = ch.toLowerCase()
    if (!(t in VALUE)) continue
    count[ch === t ? 'b' : 'w'][t]++
  }
  const points = (c: Record<string, number>) => Object.entries(c).reduce((s, [t, n]) => s + VALUE[t] * n, 0)
  // a promoted piece replaces a pawn: count it as the pawn missing, not as an extra capture
  const missing = (c: Record<string, number>) => {
    const extra = ORDER.filter((t) => t !== 'p').reduce((s, t) => s + Math.max(0, c[t] - START[t]), 0)
    return ORDER.flatMap((t) => {
      const n = t === 'p' ? Math.max(0, START.p - c.p - extra) : Math.max(0, START[t] - c[t])
      return Array<string>(n).fill(t)
    })
  }
  return { whiteCaptured: missing(count.b), blackCaptured: missing(count.w), diff: points(count.w) - points(count.b) }
}
