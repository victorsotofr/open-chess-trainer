"""Coverage report: how many good puzzles exist per theme x rating band (after quality filters).

Read this BEFORE fixing chapter quotas: rare themes (named mates, interference...) get fewer or
wider bands; a chapter ships only if it has enough material.
Writes pipeline/out/coverage.json and pipeline/out/coverage.md.
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict

from lichess import OUT, Quality, iter_rows, load_pin

BANDS = list(range(400, 2400, 200))  # 400-599, 600-799, ... 2200+


def band(r: int) -> int:
    return max(b for b in BANDS if r >= b) if r >= BANDS[0] else BANDS[0]


def length(row: dict) -> int:
    return len(row["Moves"].split()) // 2  # solver moves


def main() -> None:
    q = Quality()
    total = kept = 0
    by = defaultdict(Counter)        # theme -> band -> n
    by_len = defaultdict(Counter)    # theme -> solver moves -> n
    for row in iter_rows():
        total += 1
        if not q.ok(row):
            continue
        kept += 1
        b, n = band(int(row["Rating"])), length(row)
        for t in row["Themes"].split():
            by[t][b] += 1
            by_len[t][n] += 1
    OUT.mkdir(parents=True, exist_ok=True)
    pin = load_pin()
    data = {"dump_sha256": pin["sha256"], "dump_date": pin["last_modified"], "quality": q.__dict__,
            "total": total, "kept": kept,
            "themes": {t: {"bands": dict(sorted(c.items())), "lengths": dict(sorted(by_len[t].items())), "n": sum(c.values())}
                       for t, c in sorted(by.items(), key=lambda kv: -sum(kv[1].values()))}}
    (OUT / "coverage.json").write_text(json.dumps(data, indent=1))
    head = "| theme | total | " + " | ".join(f"{b}" for b in BANDS) + " |\n|---|---|" + "---|" * len(BANDS) + "\n"
    rows = "".join(f"| {t} | {v['n']} | " + " | ".join(str(v['bands'].get(b, 0)) for b in BANDS) + " |\n" for t, v in data["themes"].items())
    (OUT / "coverage.md").write_text(
        f"# Coverage (dump {pin['sha256'][:12]}, {pin['last_modified']})\n\n"
        f"{kept:,} of {total:,} puzzles pass the quality filter {q.__dict__}.\n\n"
        "Counts per theme and rating band (lower bound of each 200-point band).\n\n" + head + rows)
    print(f"kept {kept:,} of {total:,}; {len(by)} themes -> pipeline/out/coverage.md")


if __name__ == "__main__":
    main()
