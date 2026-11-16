"""一科一库：SQLite + FTS5（trigram 分词，中文子串可搜）。

不建向量库。500 页级材料用章节结构 + FTS5 足够。
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

from . import config

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subjects (
  slug  TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id         INTEGER PRIMARY KEY,
  subject    TEXT NOT NULL REFERENCES subjects(slug) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ready',
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (subject, path)
);

CREATE TABLE IF NOT EXISTS chunks (
  id        INTEGER PRIMARY KEY,
  doc_id    INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord       INTEGER NOT NULL,
  heading   TEXT NOT NULL DEFAULT '',
  body      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id          INTEGER PRIMARY KEY,
  subject     TEXT NOT NULL REFERENCES subjects(slug) ON DELETE CASCADE,
  chunk_id    INTEGER REFERENCES chunks(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  line        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  answer      TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  tier        INTEGER NOT NULL DEFAULT 3 CHECK (tier BETWEEN 1 AND 3),
  state       TEXT NOT NULL DEFAULT 'new',
  ease        REAL NOT NULL DEFAULT 2.5,
  interval_d  INTEGER NOT NULL DEFAULT 0,
  due         TEXT NOT NULL DEFAULT (date('now')),
  lapses      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cards_due ON cards (subject, due, state);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
USING fts5(body, heading, content='chunks', content_rowid='id', tokenize='trigram');

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts (rowid, body, heading) VALUES (new.id, new.body, new.heading);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts (chunks_fts, rowid, body, heading) VALUES ('delete', old.id, old.body, old.heading);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts (chunks_fts, rowid, body, heading) VALUES ('delete', old.id, old.body, old.heading);
  INSERT INTO chunks_fts (rowid, body, heading) VALUES (new.id, new.body, new.heading);
END;
"""

SCHEMA_VERSION = "1"


@dataclass
class Card:
    id: int
    title: str
    line: str
    prompt: str
    answer: str
    source: str
    tier: int
    state: str
    due: str


def slugify(name: str) -> str:
    s = re.sub(r"[^\w\-]+", "-", name.strip()).strip("-").lower()
    return s or "subject"


def db_path(slug: str) -> Path:
    return config.SUBJECT_DIR / f"{slugify(slug)}.db"


def connect(slug_or_path: str | Path) -> sqlite3.Connection:
    path = Path(slug_or_path)
    if not path.suffix:
        path = db_path(str(slug_or_path))
    config.ensure_dirs()
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (SCHEMA_VERSION,),
    )
    return conn


def ensure_subject(conn: sqlite3.Connection, slug: str, name: str | None = None) -> str:
    conn.execute(
        "INSERT INTO subjects (slug, name) VALUES (?, ?) ON CONFLICT(slug) DO NOTHING",
        (slugify(slug), name or slug),
    )
    conn.commit()
    return slugify(slug)


def search(conn: sqlite3.Connection, query: str, limit: int = 10) -> list[dict]:
    """FTS5 trigram 搜索；短于 3 字的查询退回 LIKE。"""
    q = query.strip()
    if not q:
        return []
    rows: list[sqlite3.Row] = []
    if len(q) >= 3:
        try:
            rows = conn.execute(
                """
                SELECT c.id, c.heading, c.body, d.title AS doc
                FROM chunks_fts f
                JOIN chunks c ON c.id = f.rowid
                JOIN documents d ON d.id = c.doc_id
                WHERE chunks_fts MATCH ?
                ORDER BY bm25(chunks_fts)
                LIMIT ?
                """,
                ('"' + q.replace('"', '""') + '"', limit),
            ).fetchall()
        except sqlite3.OperationalError:
            rows = []
    if not rows:
        rows = conn.execute(
            """
            SELECT c.id, c.heading, c.body, d.title AS doc
            FROM chunks c
            JOIN documents d ON d.id = c.doc_id
            WHERE c.body LIKE ? OR c.heading LIKE ?
            LIMIT ?
            """,
            (f"%{q}%", f"%{q}%", limit),
        ).fetchall()
    out = []
    for r in rows:
        body = r["body"]
        i = body.find(q[:max(1, min(len(q), 6))])
        start = max(0, i - 40) if i >= 0 else 0
        out.append(
            {
                "chunk_id": r["id"],
                "doc": r["doc"],
                "heading": r["heading"],
                "snippet": ("…" if start else "") + body[start : start + 140] + "…",
            }
        )
    return out


def add_card(
    conn: sqlite3.Connection,
    *,
    subject: str,
    title: str,
    line: str,
    prompt: str,
    answer: str = "",
    source: str = "",
    tier: int = 3,
    chunk_id: int | None = None,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO cards (subject, chunk_id, title, line, prompt, answer, source, tier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (subject, chunk_id, title, line, prompt, answer, source, tier),
    )
    conn.commit()
    return int(cur.lastrowid)


def due_cards(conn: sqlite3.Connection, subject: str, limit: int = 30) -> list[Card]:
    rows = conn.execute(
        """
        SELECT * FROM cards
        WHERE subject = ? AND due <= date('now')
        ORDER BY due, id
        LIMIT ?
        """,
        (subject, limit),
    ).fetchall()
    return [
        Card(
            id=r["id"],
            title=r["title"],
            line=r["line"],
            prompt=r["prompt"],
            answer=r["answer"],
            source=r["source"],
            tier=r["tier"],
            state=r["state"],
            due=r["due"],
        )
        for r in rows
    ]


def count_due(conn: sqlite3.Connection, subject: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM cards WHERE subject = ? AND due <= date('now')",
        (subject,),
    ).fetchone()
    return int(row["n"])
