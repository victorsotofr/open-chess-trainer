"""Build the versioned puzzle pack: curriculum (engine-judged) + lessons + Rush pool (reference-judged).

  python pipeline/pack.py            # select, convert, judge (cached), validate, write
  STOCKFISH=/path/to/stockfish       # native engine for verdicts (default: engine/Stockfish/src/stockfish)

Outputs (untracked; published as a pinned artifact):
  app/public/data/pack.json           app format {chapters, exercises}
  pipeline/out/pack-manifest.json     dump checksum/date, selection version, engine + node budget, pack checksum, counts
Selection is deterministic for a given (dump sha256, selection_version): candidates are taken in
sha256(dump:version:PuzzleId) order (each bucket keeps its lowest keys), allocated scarcest-chapter-first,
one puzzle per source game.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

import chess
import chess.engine
import yaml

sys.path.insert(0, str(Path(__file__).parent))
from judge import NODES, judge_position  # noqa: E402
from lichess import OUT, ROOT, Quality, convert, game_id, iter_rows, load_pin  # noqa: E402

PACK = ROOT / "app" / "public" / "data" / "pack.json"
LESSONS = ROOT / "content" / "lessons"
STOCKFISH = Path(os.environ.get("STOCKFISH", ROOT / "engine" / "Stockfish" / "src" / "stockfish"))
SECTIONS = [("guided", "Guided practice", "guided"), ("independent", "On your own", "test"),
            ("recognize", "Recognize it", "test"), ("boss", "Boss", "test")]
RECOGNIZE_HINT = "Nobody says what to look for: check every check, capture and threat."


def _neg(hexkey: str) -> int:
    return -int(hexkey[:16], 16)


def order_key(dump_sha: str, version: int, pid: str) -> str:
    return hashlib.sha256(f"{dump_sha}:{version}:{pid}".encode()).hexdigest()


def solver_moves(row: dict) -> int:
    return len(row["Moves"].split()) // 2


def matches(row: dict, theme: str, ch: dict, lo: int, hi: int) -> bool:
    themes = row["Themes"].split()
    return (theme in themes and not any(x in themes for x in ch.get("exclude", []))
            and solver_moves(row) <= ch.get("max_solver_moves", 3) and lo <= int(row["Rating"]) < hi)


def spread_pick(cands: list[dict], n: int, lo: int, hi: int, used: set, games: set) -> list[dict]:
    """n puzzles spread evenly over [lo, hi): one sub-band each, first unused candidate in key order."""
    out = []
    step = (hi - lo) / n
    for k in range(n):
        a, b = lo + k * step, lo + (k + 1) * step
        for c in cands:
            if a <= int(c["Rating"]) < b and c["PuzzleId"] not in used and game_id(c) not in games:
                out.append(c); used.add(c["PuzzleId"]); games.add(game_id(c))
                break
    if len(out) < n:  # thin sub-band: fill from anywhere in range
        for c in cands:
            if len(out) >= n:
                break
            if c["PuzzleId"] not in used and game_id(c) not in games:
                out.append(c); used.add(c["PuzzleId"]); games.add(game_id(c))
    return sorted(out, key=lambda c: int(c["Rating"]))


# ── lessons ──────────────────────────────────────────────────────────────────────────────
EX_RE = re.compile(r"^::: example\n(.*?)\n:::$", re.S | re.M)


def parse_lesson(slug: str, chapter: int) -> tuple[list[dict], list[dict], list[dict]]:
    """Markdown -> (paragraphs with Figure markers, worked examples, figure entries). Validates every position."""
    text = (LESSONS / f"{slug}.md").read_text()
    paragraphs, examples, figures = [], [], []
    blocks = re.split(r"(^::: example\n.*?\n:::$)", text, flags=re.S | re.M)
    for blk in blocks:
        m = EX_RE.match(blk.strip())
        if m:
            fields = dict(line.split(": ", 1) for line in m.group(1).strip().split("\n"))
            ex_id = f"{slug}-{len(examples) + 1}"
            board = chess.Board(fields["fen"])
            if not board.is_valid():
                raise ValueError(f"{ex_id}: invalid position ({board.status()})")
            sans, ucis = [], fields["moves"].split()
            for u in ucis:
                mv = chess.Move.from_uci(u)
                if mv not in board.legal_moves:
                    raise ValueError(f"{ex_id}: illegal move {u}")
                sans.append(board.san(mv)); board.push(mv)
            if slug.startswith("mate-in") and not board.is_checkmate():
                raise ValueError(f"{ex_id}: a mate example must end in checkmate")
            examples.append({"id": ex_id, "section": "Worked example", "page": 0, "fen": fields["fen"], "solution": sans,
                             "solution_uci": ucis, "answer_text": fields.get("caption", ""), "inline": True})
            figures.append({"file": ex_id, "page": 0, "width": 0, "height": 0, "source": "image", "kind": "example", "example": ex_id})
            paragraphs.append({"type": "Figure", "page": 0, "idx": 0, "file": ex_id})
            continue
        for para in [p.strip() for p in blk.strip().split("\n\n") if p.strip()]:
            if para.startswith("# "):
                continue  # chapter title comes from the curriculum
            if para.startswith("## "):
                paragraphs.append({"type": "Section Header", "text": para[3:].strip(), "page": 0})
            elif re.match(r"^(\d+\.|-) ", para):
                for item in para.split("\n"):
                    item = re.sub(r"^- ", "• ", item.strip())
                    paragraphs.append({"type": "List Item", "text": re.sub(r"\*\*(.+?)\*\*", r"\1", item), "page": 0})
            else:
                paragraphs.append({"type": "Text", "text": re.sub(r"\*\*(.+?)\*\*", r"\1", " ".join(para.split("\n"))), "page": 0})
    return paragraphs, examples, figures


# ── build ────────────────────────────────────────────────────────────────────────────────
def main() -> None:
    cfg = yaml.safe_load((ROOT / "pipeline" / "curriculum.yaml").read_text())
    pin = load_pin()
    version = cfg["selection_version"]
    q = Quality(**cfg["quality"])
    chapters_cfg = [(part["name"], ch) for part in cfg["parts"] for ch in part["chapters"]]

    # 1. one pass over the dump: candidates per (chapter, section) and for Rush
    # Each bucket keeps its KEEP lowest hash keys (exact, deterministic, bounded memory):
    # selection takes candidates in key order, so nothing beyond the first KEEP can ever be picked.
    import heapq
    KEEP, RUSH_KEEP = 400, 12000
    heaps: dict[tuple[int, str], list] = {}
    rush_heap: list = []

    def offer(h: list, cap: int, k: str, r: dict) -> None:
        item = (_neg(k), r["PuzzleId"], r)  # max-heap on key via negation
        if len(h) < cap:
            heapq.heappush(h, item)
        elif item[0] > h[0][0]:
            heapq.heapreplace(h, item)

    rcfg = cfg["rush"]
    t0 = time.time()
    for row in iter_rows():
        if not q.ok(row):
            continue
        hkey = order_key(pin["sha256"], version, row["PuzzleId"])
        row["_key"] = hkey
        for ci, (_, ch) in enumerate(chapters_cfg):
            for sec, _, _ in SECTIONS:
                lo, hi = ch[sec]["rating"]
                if matches(row, ch["theme"], ch, lo, hi):
                    offer(heaps.setdefault((ci, sec), []), KEEP, hkey, row)
                if sec == "recognize":
                    for other in ch[sec].get("mix_with", []):
                        if matches(row, other, {"max_solver_moves": ch.get("max_solver_moves", 3)}, lo, hi):
                            offer(heaps.setdefault((ci, "mix"), []), KEEP, hkey, row)
        if rcfg["rating"][0] <= int(row["Rating"]) < rcfg["rating"][1] and solver_moves(row) <= rcfg["max_solver_moves"]:
            offer(rush_heap, RUSH_KEEP, hkey, row)
    print(f"scanned dump in {time.time() - t0:.0f}s")
    want = {k: sorted((r for _, _, r in h), key=lambda r: r["_key"]) for k, h in heaps.items()}
    rush_cands = sorted((r for _, _, r in rush_heap), key=lambda r: r["_key"])
    print({f"{chapters_cfg[ci][1]['slug']}/{k}": len(v) for (ci, k), v in sorted(want.items())}, "rush", len(rush_cands))

    # 2. global allocation, scarcest chapter first
    used: set = set(); games: set = set()
    picks: dict[tuple[int, str], list[dict]] = {}
    order = sorted(range(len(chapters_cfg)), key=lambda ci: min(len(want.get((ci, k), [])) for k, _, _ in SECTIONS))
    for ci in order:
        ch = chapters_cfg[ci][1]
        for key in ("boss", "guided", "independent"):
            lo, hi = ch[key]["rating"]
            picks[(ci, key)] = spread_pick(want.get((ci, key), []), ch[key]["n"], lo, hi, used, games)
        rc = ch["recognize"]; lo, hi = rc["rating"]
        own = spread_pick(want.get((ci, "recognize"), []), rc["n"] - rc["n"] // 2, lo, hi, used, games)
        mix = spread_pick(want.get((ci, "mix"), []), rc["n"] // 2, lo, hi, used, games)
        picks[(ci, "recognize")] = sorted(own + mix, key=lambda r: order_key(pin["sha256"], version, "mix:" + r["PuzzleId"]))
        for key, _, _ in SECTIONS:
            need = ch[key]["n"]
            if len(picks[(ci, key)]) < need:
                sys.exit(f"chapter {ch['slug']} / {key}: only {len(picks[(ci, key)])} of {need} puzzles — widen the band (see coverage.md)")

    # 3. convert + judge (cached by id+fen+line)
    cache_p = OUT / "verdicts.json"
    cache = json.loads(cache_p.read_text()) if cache_p.exists() else {}
    exercises, chapters = [], []
    engine = None
    judged = 0
    t1 = time.time()
    try:
        for ci, (part, ch) in enumerate(chapters_cfg):
            n = ci + 1
            for key, label, mode in SECTIONS:
                for row in picks[(ci, key)]:
                    p = convert(row)
                    ck = f"{p['id']}:{p['fen']}:{' '.join(p['solution_uci'])}"
                    if ck not in cache:
                        if engine is None:
                            engine = chess.engine.SimpleEngine.popen_uci(str(STOCKFISH))
                            engine.configure({"Threads": 4, "Hash": 256})
                        b = chess.Board(p["fen"]); plies = []
                        for i, u in enumerate(p["solution_uci"]):
                            mv = chess.Move.from_uci(u)
                            if i % 2 == 0:
                                plies.append(judge_position(engine, b, mv))
                            b.push(mv)
                        cache[ck] = plies
                        judged += 1
                        cache_p.write_text(json.dumps(cache))
                        print(f"judged {p['id']} ({judged}) {time.time() - t1:.0f}s", flush=True)
                    exercises.append({
                        **{k: p[k] for k in ("id", "initialFen", "setup", "fen", "solution", "solution_uci", "rating", "themes", "gameUrl")},
                        "chapter": n, "section": label, "mode": mode,
                        "hint": RECOGNIZE_HINT if key == "recognize" else ch["hint"],
                        "solution_text": "", "flags": [], "judging": "engine", "plies": cache[ck],
                        **({"boss": True} if key == "boss" else {}),
                    })
            paragraphs, examples, figures = parse_lesson(ch["slug"], n)
            chapters.append({"chapter": n, "name": ch["name"], "part": part, "page": 0, "slug": ch["slug"],
                             "paragraphs": paragraphs, "sections": [label for _, label, _ in SECTIONS],
                             "examples": examples, "figures": figures, "completeAfter": ch["complete_after"]})
        engine_name = None
        if engine is not None:
            engine_name = engine.id.get("name")
        elif STOCKFISH.exists():
            with chess.engine.SimpleEngine.popen_uci(str(STOCKFISH)) as e:
                engine_name = e.id.get("name")
    finally:
        if engine is not None:
            engine.quit()

    # 4. Rush pool: reference judging (solution + any mate), spread over ratings
    rush = spread_pick(rush_cands, rcfg["n"], *rcfg["rating"], used, games)
    for row in rush:
        p = convert(row)
        exercises.append({**{k: p[k] for k in ("id", "initialFen", "setup", "fen", "solution", "solution_uci", "rating", "themes", "gameUrl")},
                          "chapter": 0, "section": "Rush", "mode": "test", "hint": None, "solution_text": "", "flags": [],
                          "judging": "reference", "plies": []})

    # 5. validate + write
    ids = [e["id"] for e in exercises]
    assert len(ids) == len(set(ids)), "duplicate puzzle ids"
    for e in exercises:
        if e["judging"] == "engine":
            assert len(e["plies"]) == (len(e["solution_uci"]) + 1) // 2, f"{e['id']}: missing verdicts"
    PACK.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps({"chapters": chapters, "exercises": exercises}, separators=(",", ":"))
    PACK.write_text(body)
    manifest = {
        "pack": "pack.json", "pack_sha256": hashlib.sha256(body.encode()).hexdigest(), "bytes": len(body),
        "dump_sha256": pin["sha256"], "dump_date": pin["last_modified"], "selection_version": version,
        "quality": cfg["quality"], "engine": engine_name, "nodes": NODES,
        "counts": {"chapters": len(chapters), "curriculum": sum(1 for e in exercises if e["chapter"] > 0),
                   "rush": sum(1 for e in exercises if e["chapter"] == 0), "examples": sum(len(c["examples"]) for c in chapters)},
    }
    (OUT / "pack-manifest.json").write_text(json.dumps(manifest, indent=1))
    print(json.dumps(manifest["counts"]), f"{len(body) / 1e6:.1f} MB", f"judged {judged} new puzzles in {time.time() - t1:.0f}s")


if __name__ == "__main__":
    main()
