# Forks

A **fork** is one piece attacking two (or more) enemy pieces at once. Your opponent can only save one of them, so you win the other.

Every piece can fork, but the **knight** is the champion: it jumps, it attacks in eight directions, and the pieces it attacks can never attack it back.

::: example
fen: r3k3/8/8/1N6/8/8/8/6K1 w - - 0 1
moves: b5c7 e8d7 c7a8
caption: Nc7+ attacks the king and the rook on a8 at the same time. The king must move, and then the knight takes the rook. A check plus an attack on something valuable is the strongest kind of fork.
:::

## Pawn forks

Pawns fork too, and because a pawn is worth so little, any fork it makes wins material.

::: example
fen: 6k1/8/2n1b3/8/3P4/8/8/6K1 w - - 0 1
moves: d4d5
caption: d5 attacks the knight on c6 and the bishop on e6 at once. Black can save only one of them.
:::

## How to look for forks

Look for two enemy pieces that are **undefended** or **more valuable** than your attacking piece, especially the king and queen. Then ask: is there a square from which one of my pieces attacks both? Check whether that square is safe.
