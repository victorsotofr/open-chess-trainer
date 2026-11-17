# Mate in one

**Checkmate** ends the game: the king is in check, and there is no way out. There are only three ways out of a check, and a mate takes all three away:

1. **Move** the king to a safe square.
2. **Block** the check by putting a piece in between.
3. **Capture** the piece that gives check.

To find a mate in one, look at **every check** you can give, and for each one ask the three questions.

::: example
fen: 6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1
moves: a1a8
caption: The back-rank mate. Ra8+ attacks the king along the 8th rank. The king can't move, because its own pawns block f7, g7 and h7. Nothing can block or capture the rook: mate.
:::

## Mating with help

A queen next to the enemy king is mate if it can't be captured, so it needs a defender. Often that defender is your own king.

::: example
fen: 7k/Q7/6K1/8/8/8/8/8 w - - 0 1
moves: a7g7
caption: Qg7# The queen gives check from g7. The black king can't take it, because the white king on g6 defends it, and every flight square (g8, h7) is covered too.
:::

## The habit

When the enemy king has few free squares, especially stuck behind its own pawns, start your search with checks. The forcing moves come first.
