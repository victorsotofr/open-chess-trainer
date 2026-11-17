# Free pieces

A piece is **free** when it is attacked and nobody defends it. Taking it costs you nothing. Most games between beginners are decided by free pieces, so spotting them is the first habit worth building.

## The habit: checks, captures, threats

Before every move, look at the board in this order:

1. **Checks.** Can either side give check?
2. **Captures.** Every capture you could make, and every capture your opponent could make.
3. **Threats.** What does your opponent's last move attack?

It takes a few seconds and catches most free pieces, yours and your opponent's.

::: example
fen: 6k1/5ppp/8/3n4/8/8/5PPP/3R2K1 w - - 0 1
moves: d1d5
caption: The black knight on d5 is attacked by the rook and defended by nothing. Rxd5 wins a whole knight for free.
:::

## Is it really free? Count

A piece that is attacked is not always free. Count **attackers** and **defenders**. If the piece is defended, taking it usually means losing your own piece back.

::: example
fen: 6k1/5ppp/4p3/3n4/8/8/5PPP/3R2K1 w - - 0 1
moves: d1d5 e6d5
caption: Same idea, one difference: the pawn on e6 defends the knight. Rxd5? exd5 and White has traded a rook (5) for a knight (3). Count before you capture.
:::

When a piece is attacked twice and defended once, the second attacker usually wins it. Capture with your **least valuable** piece first, so that if the opponent recaptures, you lose as little as possible.

## Now you

The first puzzles come with a hint. After that you are on your own, and in the final set nobody tells you what to look for.
