"""出题：从章块生成一张"提取练习"卡。

顺序：
1. 在线：让模型读章块，产出一句话提炼 + 一道题 + 采分点（JSON）。
2. 显式离线模式：取标题和首句做提炼，题目为"用自己的话复述下面的要点"。

在线失败直接报错，不进入离线制卡。
"""

from __future__ import annotations

import re
import sqlite3

from pydantic import Field
from . import config, llm


class CardDraft(config.StrictModel):
    title: str = Field(min_length=1, max_length=60)
    line: str = Field(min_length=1, max_length=4000)
    prompt: str = Field(min_length=1, max_length=4000)
    answer: str = Field(min_length=1, max_length=4000)
    tier: int = Field(ge=1, le=3)

SYSTEM = (
    "You are a concise study coach. Read the passage and produce ONE active-recall card. "
    "Reply with JSON only: "
    '{"title": string (<=14 Chinese chars), "line": string (one-sentence takeaway), '
    '"prompt": string (a question answerable from the passage), '
    '"answer": string (the key points, joined by 中文分号), "tier": 1|2|3}. '
    "Tier 1 means core concept that others depend on; tier 3 means detail. No emoji."
)


def card_from_chunk(chunk: dict) -> dict:
    """chunk: {heading, body, source} -> 卡片草稿。"""
    body = re.sub(r"\s+", " ", chunk["body"]).strip()
    heading = re.sub(r"\s+", " ", (chunk.get("heading") or "")).strip()

    if llm.available():
        user = f"章节：{heading or '（无标题）'}\n\n{body}"
        data = llm.chat_json(SYSTEM, user)
        try:
            return CardDraft.model_validate(data).model_dump()
        except Exception as exc:
            raise llm.ModelError("模型制卡结构不合法；本次导入未提交") from exc

    return {
        "title": (heading or _first_sentence(body))[:14].strip(),
        "line": _first_sentence(body),
        "prompt": _fallback_prompt(heading),
        "answer": _key_points(body),
        "tier": 3,
    }


def _key_points(body: str, max_points: int = 3, point_len: int = 30) -> str:
    """离线路径的采分点：取前几句，按句切；过长的句子在逗号处再断一次。"""
    text = re.sub(r"\s+", " ", body).strip()
    sentences = [s.strip() for s in re.split(r"(?<=[。！？.!?])", text) if s.strip()]
    points: list[str] = []
    for sent in sentences:
        clauses = [c.strip() for c in re.split(r"[，,；;]", sent.rstrip("。！？.!?")) if len(c.strip()) >= 4]
        for clause in clauses:
            if clause and clause not in points:
                points.append(clause[:point_len])
            if len(points) >= max_points:
                break
        if len(points) >= max_points:
            break
    return "；".join(points) if points else _first_sentence(text)


def _first_sentence(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    for sep in ("。", "！", "？", ".", "!", "?"):
        i = text.find(sep)
        if 6 <= i <= 80:
            return text[: i + 1].strip()
    return text[:60].strip()


def _fallback_prompt(heading: str) -> str:
    if heading:
        return f"不看原文，用一句话说清「{heading}」的要点。"
    return "不看原文，用一句话复述这段的要点。"


def draft_cards_for_doc(conn: sqlite3.Connection, doc_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT c.id, c.heading, c.body FROM chunks c JOIN documents d ON d.id=c.doc_id
           WHERE c.doc_id = ? AND c.version=d.current_version ORDER BY c.ord""", (doc_id,)
    ).fetchall()
    out = []
    for r in rows:
        out.append(
            {
                **card_from_chunk(
                    {"heading": r["heading"], "body": r["body"], "source": f"chunk:{r['id']}"}
                ),
                "chunk_id": r["id"],
            }
        )
    return out
