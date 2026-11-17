"""Lichess puzzle rows: streaming, quality filters and conversion to the app's puzzle record.

A Lichess row's FEN is the position BEFORE the opponent's move; Moves[0] is that opponent move,
the solver plays Moves[1], Moves[3], ... The app record keeps both positions:
  initialFen = row FEN, setup = Moves[0], fen = position after setup (where solving starts),
  solution_uci = Moves[1:]  (applied exactly once here; the app never re-applies `setup`).
"""
from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import chess

ROOT = Path(__file__).resolve().parents[1]
DUMP = ROOT / "data" / "lichess_db_puzzle.csv.zst"
OUT = ROOT / "pipeline" / "out"


def iter_rows(path: Path = DUMP) -> Iterator[dict]:
    import zstandard
    with open(path, "rb") as fh:
        reader = zstandard.ZstdDecompressor().stream_reader(fh)
        yield from csv.DictReader(io.TextIOWrapper(reader, encoding="utf-8", newline=""))


@dataclass(frozen=True)
class Quality:
    min_popularity: int = 80     # -100..100, weighted votes
    min_plays: int = 300         # enough attempts for a stable rating
    max_deviation: int = 90      # Glicko RD of the puzzle rating

    def ok(self, row: dict) -> bool:
        return (int(row["Popularity"]) >= self.min_popularity and int(row["NbPlays"]) >= self.min_plays
                and int(row["RatingDeviation"]) <= self.max_deviation)


_GAME = re.compile(r"lichess\.org/(?:game/)?([A-Za-z0-9]{8})")


def game_id(row: dict) -> str:
    """Source game id (one puzzle per game keeps sets varied). Handles both URL formats:
    https://lichess.org/game/<id>/black#48 and https://lichess.org/<id>/black#48."""
    m = _GAME.search(row["GameUrl"])
    if not m:
        raise ValueError(f"{row['PuzzleId']}: unexpected GameUrl {row['GameUrl']}")
    return m.group(1)


def convert(row: dict) -> dict:
    """Row -> app puzzle record (without chapter/section/mode, set by curation)."""
    moves = row["Moves"].split()
    board = chess.Board(row["FEN"])
    setup = chess.Move.from_uci(moves[0])
    if setup not in board.legal_moves:
        raise ValueError(f"{row['PuzzleId']}: illegal setup move {moves[0]}")
    board.push(setup)
    fen = board.fen()
    sans = []
    for u in moves[1:]:
        mv = chess.Move.from_uci(u)
        if mv not in board.legal_moves:
            raise ValueError(f"{row['PuzzleId']}: illegal solution move {u}")
        sans.append(board.san(mv))
        board.push(mv)
    return {
        "id": f"lichess:{row['PuzzleId']}",
        "initialFen": row["FEN"],
        "setup": moves[0],
        "fen": fen,
        "solution": sans,
        "solution_uci": moves[1:],
        "rating": int(row["Rating"]),
        "themes": row["Themes"].split(),
        "gameUrl": row["GameUrl"],
        "popularity": int(row["Popularity"]),
        "plays": int(row["NbPlays"]),
    }


def load_pin() -> dict:
    return json.loads((ROOT / "data" / "dump.json").read_text())
