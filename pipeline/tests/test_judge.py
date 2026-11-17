"""Synthetic score fixtures only (no book content)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from judge import Score, classify

M = lambda n: Score(mate=n, cp=None)  # noqa: E731
C = lambda c: Score(mate=None, cp=c)  # noqa: E731

def test_equal_or_faster_mate_accepted():
    assert classify(M(2), M(2)) == "accepted"
    assert classify(M(3), M(1)) == "accepted"

def test_slower_mate_not_failure():
    assert classify(M(1), M(3)) == "slower_mate"

def test_centipawns_never_beat_mate():
    assert classify(M(2), C(2000)) == "rejected"

def test_getting_mated_rejected_even_if_book_is_cp():
    assert classify(C(500), M(-3)) == "rejected"

def test_mate_beats_material_win():
    assert classify(C(600), M(4)) == "accepted"

def test_decisive_band():
    assert classify(C(900), C(700)) == "accepted"      # still clearly winning
    assert classify(C(900), C(100)) == "rejected"      # threw away the win
    assert classify(C(900), C(450)) == "inconclusive"  # borderline

def test_small_edge_band():
    assert classify(C(200), C(160)) == "accepted"
    assert classify(C(200), C(20)) == "rejected"

def test_defensive_band():
    assert classify(C(0), C(-20)) == "accepted"
    assert classify(C(0), C(-300)) == "rejected"
    assert classify(C(0), C(-80)) == "inconclusive"
