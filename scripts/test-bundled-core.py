"""Exercise the exact distributable executable without relying on installed Python."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
SUFFIX = ".exe" if os.name == "nt" else ""
EXE = ROOT / "core" / "dist" / ("tack-core" + SUFFIX)

with tempfile.TemporaryDirectory(prefix="tack-bundle-") as temp:
    env = {**os.environ, "TACK_DATA_DIR": temp, "TACK_MODE": "offline"}
    def call(op, **args):
        request = {"op": op, "request_id": str(uuid4()), **args}
        p = subprocess.run([str(EXE)], input=json.dumps(request, ensure_ascii=False) + "\n",
                           encoding="utf-8", text=True, capture_output=True, env=env, timeout=90)
        assert p.returncode == 0, p.stderr
        result = json.loads(p.stdout)
        assert result["ok"], result
        return result["result"]
    call("subjects")
    source = Path(temp) / "中文资料.md"
    source.write_text("# 细胞膜\n细胞膜具有选择透过性。", encoding="utf-8")
    first = call("import", path=str(source))
    assert first["cards_added"] == 1, first
    assert call("import", path=str(source))["cards_added"] == 0
    card = call("snapshot")["cards"][0]
    original = card["answer"]
    result = call("review", card_id=card["id"], answer=original)
    assert result["score"] == 3, result
    assert call("snapshot")["due"] == 0
    call("pin", title="新的概念", selected="细胞核控制遗传。")
    assert call("snapshot")["due"] == 1
    assert call("search", query="细胞膜")["hits"]
    conn = sqlite3.connect(Path(temp) / "subjects" / "default.db")
    try:
        assert conn.execute("SELECT answer FROM cards WHERE id=?", (card["id"],)).fetchone()[0] == original
        assert conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0] == 1
    finally:
        conn.close()
    from pypdf import PdfWriter
    pdf = Path(temp) / "blank.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.write(str(pdf))
    p = subprocess.run([str(EXE)], input=json.dumps({"op":"import","path":str(pdf),
                           "request_id":str(uuid4())}) + "\n",
                       text=True, encoding="utf-8", capture_output=True, env=env, timeout=90)
    rejected = json.loads(p.stdout)
    assert not rejected["ok"] and "扫描版" in rejected["error"], rejected
print("PASS: frozen core import, search, review, restart persistence, pin, dedupe and PDF error path")
