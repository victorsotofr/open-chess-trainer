"""Pipeline rules on synthetic rows only (no dump needed)."""
import sys
from pathlib import Path

import chess
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pack  # noqa: E402
from lichess import Quality, convert, game_id  # noqa: E402


def row(pid="abc12", fen="6k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 1", moves="g8h8 a1a8", rating=800, game="AbCdEfGh", **kw):
    return {"PuzzleId": pid, "FEN": fen, "Moves": moves, "Rating": str(rating), "RatingDeviation": "75", "Popularity": "95",
            "NbPlays": "1200", "Themes": kw.get("themes", "mate mateIn1 backRankMate oneMove"),
            "GameUrl": f"https://lichess.org/game/{game}/black#33", "OpeningTags": "", "DailyDate": ""}


def test_setup_move_applied_exactly_once():
    p = convert(row())
    assert p["id"] == "lichess:abc12"
    assert p["initialFen"].startswith("6k1/") and p["setup"] == "g8h8"
    assert p["fen"].startswith("7k/") and " w " in p["fen"]        # after the opponent's move, solver to move
    assert p["solution_uci"] == ["a1a8"] and p["solution"] == ["Ra8#"]
    b = chess.Board(p["fen"]); b.push_uci(p["solution_uci"][0])
    assert b.is_checkmate()


def test_illegal_lines_are_rejected():
    with pytest.raises(ValueError):
        convert(row(moves="g8h8 a1a9"))
    with pytest.raises(ValueError):
        convert(row(moves="e2e4 a1a8"))  # setup move illegal for the side to move


def test_game_id_handles_both_url_formats():
    assert game_id({"PuzzleId": "x", "GameUrl": "https://lichess.org/game/787zsVup/black#48"}) == "787zsVup"
    assert game_id({"PuzzleId": "x", "GameUrl": "https://lichess.org/F8M8OS71#53"}) == "F8M8OS71"
    with pytest.raises(ValueError):
        game_id({"PuzzleId": "x", "GameUrl": "https://example.com/nope"})


def test_quality_filter():
    q = Quality(min_popularity=85, min_plays=500, max_deviation=85)
    assert q.ok(row())
    assert not q.ok({**row(), "Popularity": "70"})
    assert not q.ok({**row(), "NbPlays": "100"})
    assert not q.ok({**row(), "RatingDeviation": "120"})


def test_selection_is_reproducible_spread_and_one_per_game():
    cands = [row(pid=f"p{i:03d}", rating=400 + 10 * i, game=f"g{i // 2:07d}") for i in range(60)]  # 2 puzzles per game
    cands.sort(key=lambda r: pack.order_key("sha", 1, r["PuzzleId"]))
    a = pack.spread_pick(cands, 5, 400, 1000, set(), set())
    b = pack.spread_pick(list(cands), 5, 400, 1000, set(), set())
    assert [r["PuzzleId"] for r in a] == [r["PuzzleId"] for r in b]             # deterministic
    assert len({game_id(r) for r in a}) == 5                                     # one per source game
    assert [int(r["Rating"]) for r in a] == sorted(int(r["Rating"]) for r in a)  # ascending
    assert int(a[-1]["Rating"]) - int(a[0]["Rating"]) >= 300                     # spread over the band
    assert pack.order_key("sha", 1, "x") != pack.order_key("sha", 2, "x")        # version changes the order


def test_lesson_validation_rejects_bad_teaching_positions(tmp_path, monkeypatch):
    monkeypatch.setattr(pack, "LESSONS", tmp_path)
    (tmp_path / "ok.md").write_text("# T\n\nText **bold**.\n\n::: example\nfen: 6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1\nmoves: a1a8\ncaption: c\n:::\n")
    paras, exs, figs = pack.parse_lesson("ok", 1)
    assert [p["type"] for p in paras] == ["Text", "Figure"] and paras[0]["text"] == "Text bold."
    assert exs[0]["solution"] == ["Ra8#"] and figs[0]["kind"] == "example"
    (tmp_path / "bad.md").write_text("::: example\nfen: 6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1\nmoves: a1a9\ncaption: c\n:::\n")
    with pytest.raises(ValueError):
        pack.parse_lesson("bad", 1)
    (tmp_path / "mate-in-one.md").write_text("::: example\nfen: 6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1\nmoves: a1a7\ncaption: c\n:::\n")
    with pytest.raises(ValueError, match="checkmate"):
        pack.parse_lesson("mate-in-one", 1)
