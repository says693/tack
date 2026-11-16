"""导入：文件 → 文本 → 章块 → 落库 → 立即可搜。

格式支持（G0）：
- .txt / .md  纯文本
- .pdf        文本型 PDF（pypdf，MIT 许可；不引入 AGPL 的 PyMuPDF）

扫描版 PDF 会在状态里标 needs_ocr，G1 再加视觉兜底。
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from . import config

HEADING_RE = re.compile(r"^(#{1,6}\s+.+|第[一二三四五六七八九十百零〇\d]+[章节篇部].{0,40})$")
SENT_SPLIT = re.compile(r"(?<=[。！？；.!?;])\s*")


def read_file(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md"}:
        return path.read_text("utf-8", errors="replace")
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader  # 延迟导入，没装时给清楚提示
        except ImportError as exc:
            raise RuntimeError("读取 PDF 需要 pypdf：pip install pypdf") from exc
        reader = PdfReader(str(path))
        pages = [(page.extract_text() or "").strip() for page in reader.pages]
        text = "\n".join(p for p in pages if p)
        if len(text.strip()) < 40 and len(pages) > 0:
            raise RuntimeError(
                "这个 PDF 几乎提取不到文字，可能是扫描版；G1 会加视觉兜底，先用 txt 代替。"
            )
        return text
    raise RuntimeError(f"暂不支持 {suffix}，G0 支持 .txt / .md / .pdf")


def clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_chunks(text: str, size: int = 800, overlap: int = 120) -> list[dict]:
    """按标题优先、段落其次切块；块间保留少量重叠，避免句子被腰斩。"""
    text = clean(text)
    if not text:
        return []

    # 1) 先按标题行切成"节"
    sections: list[tuple[str, str]] = []
    heading = ""
    buf: list[str] = []
    for line in text.split("\n"):
        if HEADING_RE.match(line.strip()):
            if buf:
                sections.append((heading, "\n".join(buf).strip()))
                buf = []
            heading = re.sub(r"^#+\s*", "", line.strip())
        else:
            buf.append(line)
    if buf:
        sections.append((heading, "\n".join(buf).strip()))

    # 2) 每节内按句切，再拼到目标尺寸
    chunks: list[dict] = []
    for heading, body in sections:
        sentences = [s for s in SENT_SPLIT.split(body) if s.strip()]
        current = ""
        for sent in sentences:
            if len(current) + len(sent) <= size:
                current += sent
            else:
                if current.strip():
                    chunks.append({"heading": heading, "body": current.strip()})
                current = (current[-overlap:] if len(current) > overlap else "") + sent
        if current.strip():
            chunks.append({"heading": heading, "body": current.strip()})
    return chunks


def import_file(conn: sqlite3.Connection, subject: str, path: Path) -> dict:
    text = read_file(path)
    chunks = split_chunks(
        text,
        size=config.load().learn.chunk_chars,
        overlap=config.load().learn.chunk_overlap,
    )
    title = path.stem
    cur = conn.execute(
        """
        INSERT INTO documents (subject, path, title, status)
        VALUES (?, ?, ?, 'ready')
        ON CONFLICT(subject, path) DO UPDATE SET title=excluded.title, status='ready'
        RETURNING id
        """,
        (subject, str(path.resolve()), title),
    )
    doc_id = int(cur.fetchone()["id"])
    conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
    for i, ch in enumerate(chunks):
        conn.execute(
            "INSERT INTO chunks (doc_id, ord, heading, body) VALUES (?, ?, ?, ?)",
            (doc_id, i, ch["heading"], ch["body"]),
        )
    conn.commit()
    return {"doc_id": doc_id, "title": title, "chunks": len(chunks), "chars": len(text)}
