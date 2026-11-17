"""Download the Lichess puzzle dump (CC0) into data/ and pin it.

Writes data/lichess_db_puzzle.csv.zst and data/dump.json {url, bytes, sha256, last_modified, fetched_at}.
Every later step reads the pinned checksum, so a pack can always say which dump it came from.
"""
from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def main() -> None:
    DATA.mkdir(exist_ok=True)
    out = DATA / "lichess_db_puzzle.csv.zst"
    tmp = out.with_suffix(".part")
    req = urllib.request.Request(URL, headers={"user-agent": "open-chess-trainer-pipeline"})
    h = hashlib.sha256()
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("content-length") or 0)
        last_modified = r.headers.get("last-modified")
        done = 0
        while chunk := r.read(1 << 20):
            f.write(chunk)
            h.update(chunk)
            done += len(chunk)
            if total and done % (32 << 20) < (1 << 20):
                print(f"{done / total:6.1%}", flush=True)
    if total and done != total:
        sys.exit(f"incomplete download: {done} of {total} bytes")
    tmp.replace(out)
    meta = {"url": URL, "bytes": done, "sha256": h.hexdigest(), "last_modified": last_modified,
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    (DATA / "dump.json").write_text(json.dumps(meta, indent=1))
    print("pinned:", meta["sha256"][:16], meta["last_modified"])


if __name__ == "__main__":
    main()
