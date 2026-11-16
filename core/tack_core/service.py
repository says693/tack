"""Validated, transactional application operations shared by the desktop and tests."""
from __future__ import annotations

from contextlib import closing
from dataclasses import asdict
from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
from typing import Literal

from pydantic import Field
from . import clock, config, grade, ingest, quiz, schedule, store


class Request(config.StrictModel):
    op: str
    subject: str = Field(default="default", min_length=1, max_length=80)
    request_id: str | None = Field(default=None, min_length=8, max_length=100)


class CreateSubject(Request):
    name: str = Field(min_length=1, max_length=40)


class ImportFile(Request):
    path: str = Field(min_length=1, max_length=4096)


class Search(Request):
    query: str = Field(min_length=1, max_length=300)


class CardAction(Request):
    card_id: int = Field(gt=0)


class Review(CardAction):
    answer: str = Field(default="", max_length=8000)
    kind: Literal["answer", "remembered"] = "answer"


class Defer(CardAction):
    when: Literal["tonight", "tomorrow"]


class Pin(Request):
    selected: str = Field(min_length=1, max_length=4000)
    title: str = Field(min_length=1, max_length=60)


MODELS = {
    "subjects": Request, "snapshot": Request, "create_subject": CreateSubject,
    "import": ImportFile, "search": Search, "review": Review,
    "defer": Defer, "suspend": CardAction, "pin": Pin, "restore": CardAction,
}
WRITES = {"import", "review", "defer", "suspend", "pin", "restore"}


def _subjects() -> list[dict]:
    config.ensure_dirs()
    if not any(config.SUBJECT_DIR.glob("*.db")):
        with closing(store.connect("default")) as conn:
            store.ensure_subject(conn, "default", "我的学习")
    result = []
    for path in sorted(config.SUBJECT_DIR.glob("*.db")):
        with closing(store.connect(path)) as conn:
            for row in conn.execute("SELECT slug,name FROM subjects ORDER BY slug"):
                result.append({"slug": row["slug"], "name": row["name"],
                               "due": store.count_due(conn, row["slug"])})
    return result


def snapshot(conn, subject: str) -> dict:
    cfg = config.load()
    stamp = clock.now()
    return {
        "cards": [asdict(card) for card in store.due_cards(conn, subject, cfg.learn.daily_limit, now=stamp)],
        "due": store.count_due(conn, subject, now=stamp),
        "mode": cfg.llm.mode,
        "suspended": [dict(r) for r in conn.execute(
            "SELECT id,title,state FROM cards WHERE subject=? AND state IN ('suspended','needs_verification')",
            (subject,))],
        "next_due": conn.execute(
            """SELECT MIN(due_at) FROM cards WHERE subject=? AND due_at>?
               AND state IN ('new','learning','review')""", (subject, stamp)).fetchone()[0],
    }


def dispatch(raw: dict) -> dict:
    if not isinstance(raw, dict) or raw.get("op") not in MODELS:
        raise ValueError("未知操作")
    req = MODELS[raw["op"]].model_validate(raw)
    if req.subject != store.slugify(req.subject):
        raise ValueError("科目标识无效")
    if req.op == "subjects":
        return {"subjects": _subjects(), "data_dir": str(config.DATA_DIR), "config_file": str(config.LOCAL_CFG)}
    if req.op == "create_subject":
        name = req.name.strip()
        if not name:
            raise ValueError("科目名称不能为空")
        slug = store.slugify(name)
        with closing(store.connect(slug)) as conn:
            old = conn.execute("SELECT name FROM subjects WHERE slug=?", (slug,)).fetchone()
            if old and old["name"] != name:
                raise ValueError("名称与已有科目标识冲突，请换一个名称")
            store.ensure_subject(conn, slug, name)
        return {"slug": slug, "name": name}
    path = store.db_path(req.subject)
    if not path.exists():
        raise ValueError("科目不存在")
    with closing(store.connect(path)) as conn:
        if not conn.execute("SELECT 1 FROM subjects WHERE slug=?", (req.subject,)).fetchone():
            raise ValueError("科目不存在")
        if req.op == "snapshot":
            return snapshot(conn, req.subject)
        if req.op == "search":
            return {"hits": store.search(conn, req.query)}
        if not req.request_id:
            raise ValueError("写操作必须包含 request_id")
        canonical = req.model_dump(exclude={"request_id"})
        digest = hashlib.sha256(json.dumps(canonical, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        with conn:
            # Serialize the idempotency check with the write, including across processes.
            conn.execute("BEGIN IMMEDIATE")
            old = conn.execute("SELECT * FROM operations WHERE request_id=?", (req.request_id,)).fetchone()
            if old:
                if old["digest"] != digest:
                    raise ValueError("请求标识已用于不同操作，请刷新后重试")
                return json.loads(old["result"])
            result = _write(conn, req)
            conn.execute("INSERT INTO operations(request_id,digest,result) VALUES(?,?,?)",
                         (req.request_id, digest, json.dumps(result, ensure_ascii=False)))
            return result


def _write(conn, req) -> dict:
    if req.op == "import":
        info = ingest.import_file(conn, req.subject, Path(req.path), commit=False)
        chunks = conn.execute("""SELECT c.* FROM chunks c JOIN documents d ON d.id=c.doc_id
                                 WHERE c.doc_id=? AND c.version=d.current_version ORDER BY c.ord""",
                              (info["doc_id"],)).fetchall()
        if config.load().online and len(chunks) > 10:
            raise ValueError("在线制卡每次最多 10 个文本块，请拆分文件，或显式选择离线模式")
        added = 0
        for chunk in chunks:
            dedupe = f"chunk:{chunk['id']}"
            if conn.execute("SELECT 1 FROM cards WHERE dedupe_key=?", (dedupe,)).fetchone():
                continue
            draft = quiz.card_from_chunk(dict(chunk))
            store.add_card(conn, subject=req.subject, **draft, chunk_id=chunk["id"],
                           source=f"{info['title']} · v{info['version']}",
                           dedupe_key=dedupe, commit=False)
            added += 1
        return {**info, "cards_added": added}
    if req.op == "pin":
        if not req.title.strip() or not req.selected.strip():
            raise ValueError("概念名和原文不能为空")
        draft = quiz.card_from_chunk({"heading": req.title, "body": req.selected})
        draft["title"] = req.title
        cid = store.add_card(conn, subject=req.subject, **draft, source="选中文字",
                             source_text=req.selected, dedupe_key="pin:" + req.request_id, commit=False)
        return {"id": cid, "title": req.title}
    row = conn.execute("SELECT * FROM cards WHERE id=? AND subject=?",
                       (req.card_id, req.subject)).fetchone()
    if row is None:
        raise ValueError("卡片不存在")
    if req.op == "review":
        if req.kind == "answer":
            if not req.answer.strip():
                raise ValueError("请先填写答案")
            result = grade.grade_answer(req.answer, row["answer"])
        else:
            result = {"score": 3, "notes": ["已按你的自评安排下次复习。"], "method": "self"}
        due = schedule.apply_review(conn, req.card_id, result["score"],
                                    answer=req.answer, method=result["method"], commit=False)
        return {**result, **due}
    if req.op == "restore":
        if row["state"] == "needs_verification":
            raise ValueError("旧版标准答案可能已损坏，请对照来源重新制卡；不能直接恢复")
        conn.execute("UPDATE cards SET state='new',due_at=?,due=? WHERE id=?",
                     (clock.now(), clock.iso(clock.now()), req.card_id))
        return {"restored": req.card_id}
    if req.op == "suspend":
        conn.execute("UPDATE cards SET state='suspended' WHERE id=?", (req.card_id,))
        return {"suspended": req.card_id}
    if req.op == "defer":
        local = datetime.fromtimestamp(clock.now())
        if req.when == "tonight":
            target = local.replace(hour=20, minute=0, second=0, microsecond=0)
            if target <= local:
                raise ValueError("今天 20:00 已过，请选择明天")
        else:
            target = datetime.combine(local.date() + timedelta(days=1), datetime.min.time())
        stamp = int(target.astimezone().timestamp())
        conn.execute("UPDATE cards SET due_at=?,due=? WHERE id=?", (stamp, clock.iso(stamp), req.card_id))
        return {"due_at": stamp, "due": clock.iso(stamp)}
    raise ValueError("未知写操作")
