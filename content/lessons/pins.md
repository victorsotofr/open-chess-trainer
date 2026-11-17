# Pins

A **pin** freezes a piece: it stands on a line between an attacker and something more valuable behind it. If it moves, the piece behind is exposed.

- **Absolute pin:** the piece behind is the **king**. The pinned piece is not allowed to move at all.
- **Relative pin:** the piece behind is valuable (often the queen). Moving is legal, but it loses material.

Only long-range pieces pin: bishops, rooks and queens.

::: example
fen: 4k3/6pp/2n5/8/3P4/8/8/5BK1 w - - 0 1
moves: f1b5 g7g6 d4d5
caption: Bb5 pins the knight on c6 to the king on e8: the knight may not move. Then d5 attacks it with a pawn, and the knight can neither run nor be defended in time. A pinned piece is a target: attack it again.
:::

## Pile up on the pinned piece

A pinned piece can't escape, so you can attack it with more pieces than it has defenders.

::: example
fen: 3q2k1/5ppp/8/3n4/2B5/8/5PPP/3R2K1 w - - 0 1
moves: c4d5 d8d5 d1d5
caption: The knight on d5 is pinned to the queen on d8 by the rook on d1, and attacked twice (bishop and rook) while defended once. Bxd5 Qxd5 Rxd5: White wins a knight. Count attackers and defenders, then capture.
:::

## How to look for pins

Line up the enemy king or queen with your bishops, rooks and queen. Is there exactly one piece in between? Then ask what that piece is defending, and how you can attack it again.
