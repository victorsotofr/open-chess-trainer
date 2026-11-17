# Skewers

A **skewer** is a pin turned inside out. The **more valuable** piece stands in front, the less valuable one behind it on the same line. You attack the front piece, it has to move, and you take the one behind.

Skewers are strongest with a **check**: the king must step out of the line, and whatever stood behind it falls.

::: example
fen: 3q4/8/8/3k4/8/8/8/R5K1 w - - 0 1
moves: a1d1 d5e5 d1d8
caption: Rd1+ checks the king on d5 along the d-file. The king must leave the file, and the rook takes the queen that was hiding behind it on d8.
:::

## How to look for skewers

Look for two enemy pieces on the same rank, file or diagonal, with the more valuable one (king, queen, rook) in front and nothing in between. If one of your long-range pieces can reach that line, preferably with check, you have a skewer.
