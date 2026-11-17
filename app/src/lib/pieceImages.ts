/** Piece images from the board's own piece set (cburnett), so captured pieces match the board. */
import css from '@lichess-org/chessground/assets/chessground.cburnett.css?raw'

const IMG: Record<string, string> = {}
for (const m of css.matchAll(/piece\.(\w+)\.(white|black)\s*\{\s*background-image:\s*(url\([^)]*\))/g)) IMG[`${m[2]}.${m[1]}`] = m[3]

const NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }
export const pieceImage = (color: 'white' | 'black', t: string) => IMG[`${color}.${NAME[t]}`]
