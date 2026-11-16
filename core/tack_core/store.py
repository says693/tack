"""一科一库：SQLite + FTS5（trigram 分词，中文子串可搜）。

不建向量库。500 页级材料用章节结构 + FTS5 足够。
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from . import clock, config

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

SCHEMA_VERSION = "2"


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
    due_at: int
    parent: str
    chunk_id: int | None


def slugify(name: str) -> str:
    s = re.sub(r"[^\w\-]+", "-", name.strip()).strip("-").lower()
    return s or "subject"


def db_path(slug: str) -> Path:
    return config.SUBJECT_DIR / f"{slugify(slug)}.db"


def connect(slug_or_path: str | Path) -> sqlite3.Connection:
    path = slug_or_path if isinstance(slug_or_path, Path) else db_path(slug_or_path)
    config.ensure_dirs()
    conn = sqlite3.connect(path, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    try:
        _migrate(conn)
    except Exception:
        conn.close()
        raise
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    version = conn.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    if version and version[0] not in ("1", SCHEMA_VERSION):
        raise RuntimeError("数据库版本不受支持，拒绝降级写入")
    columns = {r["name"] for r in conn.execute("PRAGMA table_info(cards)")}
    with conn:
        # Python's sqlite3 does not implicitly BEGIN for ALTER TABLE.
        # Include DDL in the same transaction so failed conversions cannot leave
        # half-migrated columns that appear to be a completed migration.
        conn.execute("BEGIN IMMEDIATE")
        if "due_at" not in columns:
            conn.execute("ALTER TABLE cards ADD COLUMN due_at INTEGER NOT NULL DEFAULT 0")
            conn.execute("ALTER TABLE cards ADD COLUMN source_text TEXT NOT NULL DEFAULT ''")
            conn.execute("ALTER TABLE cards ADD COLUMN dedupe_key TEXT")
            for row in conn.execute("SELECT id,due,reviewed_at FROM cards").fetchall():
                stamp = clock.legacy_timestamp(row["due"])
                conn.execute("UPDATE cards SET due_at=?,due=? WHERE id=?",
                             (stamp, clock.iso(stamp), row["id"]))
            # v1 overwrote answer keys during review. Never silently trust them.
            conn.execute("UPDATE cards SET state='needs_verification' WHERE reviewed_at IS NOT NULL")
        doc_columns = {r["name"] for r in conn.execute("PRAGMA table_info(documents)")}
        if "current_version" not in doc_columns:
            conn.execute("ALTER TABLE documents ADD COLUMN current_version INTEGER NOT NULL DEFAULT 1")
            conn.execute("ALTER TABLE documents ADD COLUMN digest TEXT NOT NULL DEFAULT ''")
            conn.execute("ALTER TABLE chunks ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_card_dedupe ON cards(dedupe_key)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_due_at ON cards(subject,due_at,state)")
        conn.execute("""CREATE TABLE IF NOT EXISTS reviews (
          id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id),
          answer TEXT, score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 3),
          method TEXT NOT NULL, reviewed_at INTEGER NOT NULL, due_at INTEGER NOT NULL)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS operations (
          request_id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL)""")
        conn.execute(
            "INSERT INTO meta(key,value) VALUES('schema',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (SCHEMA_VERSION,))


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
    if len(q) >= 3:
        rows = conn.execute(
                """
                SELECT c.id, c.heading, c.body, d.title AS doc
                FROM chunks_fts f
                JOIN chunks c ON c.id = f.rowid
                JOIN documents d ON d.id = c.doc_id
                WHERE chunks_fts MATCH ? AND c.version=d.current_version
                ORDER BY bm25(chunks_fts)
                LIMIT ?
                """,
                ('"' + q.replace('"', '""') + '"', limit),
        ).fetchall()
    else:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        rows = conn.execute(
            """
            SELECT c.id, c.heading, c.body, d.title AS doc
            FROM chunks c
            JOIN documents d ON d.id = c.doc_id
            WHERE c.version=d.current_version AND
              (c.body LIKE ? ESCAPE '\\' OR c.heading LIKE ? ESCAPE '\\')
            LIMIT ?
            """,
            (f"%{escaped}%", f"%{escaped}%", limit),
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
                "body": body,
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
    source_text: str = "",
    dedupe_key: str | None = None,
    commit: bool = True,
) -> int:
    stamp = clock.now()
    cur = conn.execute(
        """
        INSERT INTO cards (subject, chunk_id, title, line, prompt, answer, source, tier,
                           due_at,due,source_text,dedupe_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (subject, chunk_id, title, line, prompt, answer, source, tier,
         stamp, clock.iso(stamp), source_text, dedupe_key),
    )
    if commit:
        conn.commit()
    return int(cur.lastrowid)


def due_cards(conn: sqlite3.Connection, subject: str, limit: int = 30, *, now: int | None = None) -> list[Card]:
    rows = conn.execute(
        """
        SELECT cards.*,COALESCE(chunks.body,cards.source_text) AS parent
        FROM cards LEFT JOIN chunks ON chunks.id=cards.chunk_id
        WHERE subject = ? AND due_at <= ? AND state IN ('new','learning','review')
        ORDER BY due_at, cards.id
        LIMIT ?
        """,
        (subject, clock.now() if now is None else now, limit),
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
            due_at=r["due_at"],
            parent=r["parent"],
            chunk_id=r["chunk_id"],
        )
        for r in rows
    ]


def count_due(conn: sqlite3.Connection, subject: str, *, now: int | None = None) -> int:
    row = conn.execute(
        """SELECT COUNT(*) AS n FROM cards WHERE subject = ? AND due_at <= ?
           AND state IN ('new','learning','review')""",
        (subject, clock.now() if now is None else now),
    ).fetchone()
    return int(row["n"])
