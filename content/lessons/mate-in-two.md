# Mate in two

A **mate in two** is a forcing sequence: your first move leaves the opponent no good answer, and your second move is mate. The first move is usually a check or a sacrifice that drives the king where you want it.

Work backwards: picture the mating position first, then find a forcing move that gets you there.

::: example
fen: 8/7k/R7/1R6/8/8/8/2K5 w - - 0 1
moves: b5b7 h7g8 a6a8
caption: The rook ladder. Rb7+ drives the king to the 8th rank (the 6th is covered by the rook on a6). Then Ra8# : one rook covers the 7th rank, the other gives check on the 8th. The rooks take turns.
:::

## The habit

In every mate in two, check the forcing moves first: checks, then captures, then threats. After each candidate, list every reply the opponent has. If each one leaves you a mate, you've found it.
