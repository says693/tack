"""批改：告诉你答对在哪、漏了哪。

在线：模型按采分点给 0-3 分 + 逐条点评。
离线：关键词覆盖率启发式（速度快，够用），同样输出 0-3 分。
"""

from __future__ import annotations

import re

from . import llm

SYSTEM = (
    "You grade a recall answer against an answer key. "
    "Reply with JSON only: "
    '{"score": 0|1|2|3, "hit": [strings the answer got right], '
    '"missed": [strings from the key that were missing], '
    '"note": one short sentence in Chinese, warm but precise}. '
    "Score 3 = complete and correct; 0 = off topic or empty. No emoji."
)

STOP = set("的了是在和有与或这那一个我你他她它们之其所以因此因为如果但是就是不是".split())


def _tokens(text: str) -> set[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9\-]*|\d+|[一-鿿]", text)
    return {w.lower() for w in words if w not in STOP}


def grade_answer(answer: str, key: str) -> dict:
    answer = answer.strip()
    if not answer:
        return {"score": 0, "notes": ["没有作答。别急，先写下你记得的哪怕半句。"]}

    if llm.available():
        data = llm.chat_json(
            SYSTEM, f"采分点：{key}\n\n学生作答：{answer}", fast=True
        )
        if data:
            try:
                score = int(data.get("score", 0))
            except (TypeError, ValueError):
                score = 0
            notes = []
            hit = data.get("hit") or []
            missed = data.get("missed") or []
            if hit:
                notes.append("答到了：" + "、".join(map(str, hit[:4])))
            if missed:
                notes.append("漏了：" + "、".join(map(str, missed[:4])))
            if data.get("note"):
                notes.append(str(data["note"]))
            if not notes:
                notes.append("参考这条：" + key.split("；")[0])
            return {"score": max(0, min(3, score)), "notes": notes}

    return _heuristic(answer, key)


def _heuristic(answer: str, key: str) -> dict:
    key_parts = [p for p in re.split(r"[；;，,、]", key) if p.strip()]
    a_tokens = _tokens(answer)
    details = []
    hit, missed = 0, []
    for part in key_parts or [key]:
        p_tokens = _tokens(part)
        if not p_tokens:
            continue
        overlap = p_tokens & a_tokens
        ratio = len(overlap) / len(p_tokens)
        if ratio >= 0.34:
            hit += 1
            details.append(f"「{part[:18]}」答到了")
        else:
            missed.append(part[:18])
    score = min(3, hit)
    notes = details[:3]
    if missed:
        notes.append("这几处还没说清：" + "、".join(missed[:3]))
    if not notes:
        notes.append("参考这条：" + (key_parts[0] if key_parts else key)[:40])
    return {"score": score, "notes": notes}
