import { describe, expect, it } from 'vitest'
import { explainMistake } from './explain'

describe('explainMistake', () => {
  it('hanging a piece that just moved', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
    const s = explainMistake({ fenBefore: fen, played: 'g1f3', best: null, reply: null, mateAfter: null, mateBefore: null })
    expect(s).toBe('A clearly weaker move.')
    const fen2 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
    const s2 = explainMistake({ fenBefore: fen2, played: 'd1g4', best: 'g1f3', reply: 'd7d5', mateAfter: null, mateBefore: null })
    expect(s2).toBe('Better was Nf3.')
    const fen3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
    const s3 = explainMistake({ fenBefore: fen3, played: 'f3d4', best: 'b1c3', reply: 'e5d4', mateAfter: null, mateBefore: null })
    expect(s3).toBe('The knight on d4 can be taken: exd4 wins your knight.')
  })
  it('allowing mate', () => {
    const s = explainMistake({ fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/8/PPPPPP1P/RNBQKBNR w KQkq - 0 2', played: 'f2f3', best: null, reply: 'd8h4', mateAfter: -1, mateBefore: null })
    expect(s).toBe('Allows mate in 1.')
  })
  it('missing a mate', () => {
    const s = explainMistake({ fenBefore: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', played: 'g1f2', best: 'a1a8', reply: null, mateAfter: null, mateBefore: 1 })
    expect(s).toBe('Misses a forced mate in 1, starting with Ra8#.')
  })
})
