"""tack 内核命令行。

    python -m tack_core.cli init demo
    python -m tack_core.cli ingest demo .\细胞.pdf
    python -m tack_core.cli search demo "钠钾泵"
    python -m tack_core.cli draft demo 1        # 为文档 1 生成卡片草稿
    python -m tack_core.cli quiz demo           # 今天的第一张卡，作答并
    python -m tack_core.cli due demo            # 看今天还剩什么
"""

from __future__ import annotations

import sys
from pathlib import Path

from . import config, grade, ingest, quiz, schedule, store

EXAMPLE = """细胞膜与物质的跨膜运输

钠钾泵每消耗一分子 ATP，把 3 个 Na+ 泵出细胞、2 个 K+ 泵入细胞。两个方向都逆浓度梯度，因此属于主动运输。

ATP 在细胞里被称为能量货币。它不被一次性烧掉，而是在酶的作用下按需水解，把能量分给吸能反应。

有氧呼吸分为三个阶段。第二阶段发生在线粒体基质，丙酮酸被彻底分解为二氧化碳，并生成大量 NADH。
"""


def _conn(subject: str):
    conn = store.connect(subject)
    store.ensure_subject(conn, subject)
    return conn


def cmd_init(subject: str) -> None:
    conn = _conn(subject)
    path = store.db_path(subject)
    n = store.count_due(conn, store.slugify(subject))
    print(f"[ok] 已建库 {path}（今日待复习 {n} 张）")


def cmd_seed(subject: str) -> None:
    """建一个能立刻玩的示例科目（纯本地，无需联网）。"""
    conn = _conn(subject)
    slug = store.slugify(subject)
    demo = config.DATA_DIR / "_examples" / "细胞与能量.md"
    demo.parent.mkdir(parents=True, exist_ok=True)
    demo.write_text(EXAMPLE, "utf-8")
    info = ingest.import_file(conn, slug, demo)
    drafts = quiz.draft_cards_for_doc(conn, info["doc_id"])
    for d in drafts[:4]:
        store.add_card(
            conn,
            subject=slug,
            title=d["title"],
            line=d["line"],
            prompt=d["prompt"],
            answer=d["answer"],
            source=f"file:{demo.name}",
            tier=d["tier"],
            chunk_id=d["chunk_id"],
        )
    print(f"[ok] 示例科目 {slug}：{len(drafts)} 个章块，钉了 {min(4, len(drafts))} 张卡")


def cmd_ingest(subject: str, path: str) -> None:
    conn = _conn(subject)
    slug = store.slugify(subject)
    info = ingest.import_file(conn, slug, Path(path))
    print(
        f"[ok] 导入「{info['title']}」：{info['chunks']} 个章块，"
        f"{info['chars']} 字，立即可搜"
    )


def cmd_search(subject: str, query: str) -> None:
    conn = _conn(subject)
    slug = store.slugify(subject)
    hits = store.search(conn, query)
    if not hits:
        print("没有命中。")
        return
    for h in hits:
        head = f"〔{h['heading']}〕" if h["heading"] else ""
        print(f"- {h['doc']} {head}\n  {h['snippet']}")


def cmd_draft(subject: str, doc_id: str) -> None:
    conn = _conn(subject)
    slug = store.slugify(subject)
    drafts = quiz.draft_cards_for_doc(conn, int(doc_id))
    for d in drafts:
        store.add_card(
            conn,
            subject=slug,
            title=d["title"],
            line=d["line"],
            prompt=d["prompt"],
            answer=d["answer"],
            source=f"chunk:{d['chunk_id']}",
            tier=d["tier"],
            chunk_id=d["chunk_id"],
        )
    print(f"[ok] 为文档 {doc_id} 钉了 {len(drafts)} 张卡")


def cmd_due(subject: str) -> None:
    conn = _conn(subject)
    slug = store.slugify(subject)
    cards = store.due_cards(conn, slug)
    if not cards:
        print("今天没有要复习的卡。")
        return
    print(f"今天还有 {len(cards)} 张：")
    for c in cards:
        print(f"  [{c.id}] T{c.tier} {c.title}")


def cmd_quiz(subject: str) -> None:
    conn = _conn(subject)
    slug = store.slugify(subject)
    cards = store.due_cards(conn, slug, limit=1)
    if not cards:
        print("今天没有要复习的卡。")
        return
    card = cards[0]
    print(f"\n[{card.id}] {card.title}")
    print(f"提示线：{card.line}\n")
    print(card.prompt)
    answer = input("\n你的答案：").strip()
    result = grade.grade_answer(answer, card.answer or card.line)
    print(f"\n评分 {result['score']}/3")
    for n in result["notes"]:
        print("  ·", n)
    nxt = schedule.apply_review(conn, card.id, result["score"], answer=answer, method=result["method"])
    print(f"\n下次出现：{nxt['due']}（间隔 {nxt['interval_d']} 天，状态 {nxt['state']}）")


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in {"-h", "--help"}:
        print(__doc__)
        return 0
    cmd, rest = args[0], args[1:]
    try:
        if cmd == "init":
            cmd_init(rest[0] if rest else "demo")
        elif cmd == "seed":
            cmd_seed(rest[0] if rest else "demo")
        elif cmd == "ingest":
            cmd_ingest(rest[0], rest[1])
        elif cmd == "search":
            cmd_search(rest[0], " ".join(rest[1:]))
        elif cmd == "draft":
            cmd_draft(rest[0], rest[1])
        elif cmd == "due":
            cmd_due(rest[0])
        elif cmd == "quiz":
            cmd_quiz(rest[0])
        else:
            print(f"未知命令：{cmd}", file=sys.stderr)
            print(__doc__)
            return 2
    except (IndexError, KeyError) as exc:
        print(f"[err] 参数不对：{exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # 给小白一句人话，而不是 traceback
        print(f"[err] {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
