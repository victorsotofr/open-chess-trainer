"""Offline move judge: classify every legal move at every solver ply of a puzzle.

Both the book move and each candidate are searched from the SAME position, with the
SAME node budget (`searchmoves`), and scored from the MOVER's perspective. Mate scores
are compared separately from centipawns.

Outcomes:
  book          the book's move
  accepted      also achieves the puzzle goal -> puzzle ends with "Also works"
  slower_mate   mates, but slower than the book (not counted as a failure)
  inconclusive  too close to call at this budget, even after a deeper re-search
  rejected      fails; stored with the engine refutation line and a short reason
"""
from __future__ import annotations

from dataclasses import dataclass

import chess
import chess.engine

NODES = 800_000
DEEP = 4


@dataclass
class Score:
    mate: int | None  # >0 mover mates in N, <0 mover gets mated in N
    cp: int | None

    @classmethod
    def from_pov(cls, s: chess.engine.PovScore, turn: chess.Color) -> "Score":
        p = s.pov(turn)
        return cls(mate=p.mate(), cp=None if p.is_mate() else p.score())

    def __str__(self) -> str:
        return f"#{self.mate}" if self.mate is not None else f"{self.cp:+d}"


def classify(book: Score, cand: Score) -> str:
    """Pure decision rule (unit-tested with synthetic scores)."""
    # Candidate gets mated or loses a forced mate race -> rejected.
    if cand.mate is not None and cand.mate < 0:
        return "rejected"
    if book.mate is not None and book.mate > 0:
        if cand.mate is not None and cand.mate > 0:
            return "accepted" if cand.mate <= book.mate else "slower_mate"
        # A centipawn move never beats a mate. Huge advantage still fails the puzzle goal.
        return "rejected"
    if cand.mate is not None and cand.mate > 0:
        return "accepted"  # book wins material, candidate mates: strictly better
    b, m = book.cp, cand.cp
    if b >= 300:  # decisive advantage (typical tactic: wins material)
        if m >= max(300, b - max(150, int(0.3 * b))):
            return "accepted"
        if m < b - 500 or m < 150:
            return "rejected"
        return "inconclusive"
    if b >= 100:  # clear but smaller edge
        if m >= b - 50:
            return "accepted"
        if m < b - 150:
            return "rejected"
        return "inconclusive"
    # Defensive puzzles: the book move only holds the balance.
    if m >= b - 30:
        return "accepted"
    if m < b - 120:
        return "rejected"
    return "inconclusive"


PIECE_NAMES = {chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop", chess.ROOK: "rook", chess.QUEEN: "queen", chess.KING: "king"}
VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def explain(board: chess.Board, move: chess.Move, score: Score, pv: list[chess.Move], book: Score) -> str:
    """One-line reason for a rejected move, derived from the refutation line."""
    if score.mate is not None and score.mate < 0:
        n = -score.mate
        return "Allows checkmate" + (" in one." if n == 1 else f" in {n}.")
    if book.mate is not None and book.mate > 0:
        return f"There is a forced checkmate here (in {book.mate}); this move misses it."
    b = board.copy()
    b.push(move)
    if pv:
        reply = pv[0]
        captured = b.piece_at(reply.to_square)
        san = b.san(reply)
        if captured and captured.color == board.turn:
            return f"Opponent answers {san}, winning your {PIECE_NAMES[captured.piece_type]}."
        return f"Opponent answers {san} and you no longer win material (eval {score})."
    return f"Not good enough (eval {score} vs {book} for the book move)."


def analyse_move(engine, board: chess.Board, move: chess.Move, nodes: int):
    info = engine.analyse(board, chess.engine.Limit(nodes=nodes), root_moves=[move])
    return Score.from_pov(info["score"], board.turn), info.get("pv", [])[1:6]


def judge_position(engine, board: chess.Board, book_move: chess.Move) -> dict:
    book_score, book_pv = analyse_move(engine, board, book_move, NODES)
    verdicts = {}
    for mv in board.legal_moves:
        if mv == book_move:
            verdicts[mv.uci()] = {"v": "book", "score": str(book_score)}
            continue
        s, pv = analyse_move(engine, board, mv, NODES)
        v = classify(book_score, s)
        if v == "inconclusive":  # deeper, consistent re-search of both moves
            book_deep, _ = analyse_move(engine, board, book_move, NODES * DEEP)
            s, pv = analyse_move(engine, board, mv, NODES * DEEP)
            v = classify(book_deep, s)
        entry = {"v": v, "score": str(s)}
        b = board.copy()
        if pv:
            line, bb = [], board.copy()
            bb.push(mv)
            for x in pv[:4]:
                line.append(bb.san(x))
                bb.push(x)
            entry["line"] = line
        if v == "rejected":
            entry["why"] = explain(board, mv, s, pv, book_score)
        verdicts[mv.uci()] = entry
    return {"book_score": str(book_score), "moves": verdicts}
