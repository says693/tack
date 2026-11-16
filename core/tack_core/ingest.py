"""导入：文件 → 文本 → 章块 → 落库 → 立即可搜。

格式支持（G0）：
- .txt / .md  纯文本
- .pdf        文本型 PDF（pypdf，MIT 许可；不引入 AGPL 的 PyMuPDF）

扫描版 PDF 会在状态里标 needs_ocr，G1 再加视觉兜底。
"""

from __future__ import annotations

import re
import sqlite3
import hashlib
from pathlib import Path
from semantic_text_splitter import TextSplitter

from . import config

HEADING_RE = re.compile(r"^(#{1,6}\s+.+|第[一二三四五六七八九十百零〇\d]+[章节篇部].{0,40})$")
SENT_SPLIT = re.compile(r"(?<=[。！？；.!?;])\s*")


def read_file(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md"}:
        return path.read_text("utf-8-sig")
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader  # 延迟导入，没装时给清楚提示
        except ImportError as exc:
            raise RuntimeError("读取 PDF 需要 pypdf：pip install pypdf") from exc
        reader = PdfReader(str(path))
        pages = [(page.extract_text() or "").strip() for page in reader.pages]
        text = "\n".join(p for p in pages if p)
        if len(text.strip()) < 40 and len(pages) > 0:
            raise ValueError(
                "这个 PDF 几乎提取不到文字，可能是扫描版；请先进行 OCR 或使用文本型 PDF。"
            )
        return text
    raise ValueError(f"暂不支持 {suffix}，请使用 .txt / .md / .pdf")


def clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_chunks(text: str, size: int = 800, overlap: int = 120) -> list[dict]:
    """按标题优先、段落其次切块；块间保留少量重叠，避免句子被腰斩。"""
    if type(size) is not int or type(overlap) is not int or size <= 0 or not 0 <= overlap < size:
        raise ValueError("要求 size > 0 且 0 <= overlap < size")
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

    # Mature semantic splitter handles sentence boundaries AND oversized sentences.
    chunks: list[dict] = []
    splitter = TextSplitter(size, overlap=overlap)
    for heading, body in sections:
        chunks.extend({"heading": heading, "body": chunk} for chunk in splitter.chunks(body))
    return chunks


def import_file(conn: sqlite3.Connection, subject: str, path: Path, *, commit: bool = True) -> dict:
    if path.stat().st_size > 50 * 1024 * 1024:
        raise ValueError("单个文件不能超过 50 MB")
    text = read_file(path)
    cfg = config.load().learn
    chunks = split_chunks(
        text,
        size=cfg.chunk_chars, overlap=cfg.chunk_overlap,
    )
    if not chunks:
        raise ValueError("文件中没有可导入的正文")
    if len(chunks) > 2000:
        raise ValueError("文件超过 2000 个文本块，请按章节拆分后导入")
    title = path.stem
    digest = hashlib.sha256((str((cfg.chunk_chars, cfg.chunk_overlap)) + text).encode()).hexdigest()
    existing = conn.execute("SELECT * FROM documents WHERE subject=? AND path=?",
                            (subject, str(path.resolve()))).fetchone()
    if existing and existing["digest"] == digest:
        return {"doc_id": existing["id"], "title": title, "chunks": len(chunks),
                "chars": len(text), "version": existing["current_version"], "unchanged": True}
    version = existing["current_version"] + 1 if existing else 1
    try:
        cur = conn.execute(
            """INSERT INTO documents(subject,path,title,status,digest,current_version)
               VALUES(?,?,?,'ready',?,?)
               ON CONFLICT(subject,path) DO UPDATE SET title=excluded.title,status='ready',
               digest=excluded.digest,current_version=excluded.current_version RETURNING id""",
            (subject, str(path.resolve()), title, digest, version))
        doc_id = int(cur.fetchone()["id"])
        for i, ch in enumerate(chunks):
            conn.execute("INSERT INTO chunks(doc_id,ord,heading,body,version) VALUES(?,?,?,?,?)",
                         (doc_id, i, ch["heading"], ch["body"], version))
        if commit:
            conn.commit()
    except Exception:
        if commit:
            conn.rollback()
        raise
    return {"doc_id": doc_id, "title": title, "chunks": len(chunks), "chars": len(text),
            "version": version, "unchanged": False}
