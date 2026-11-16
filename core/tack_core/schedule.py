"""Review history is separate from the immutable answer key."""
from datetime import datetime, timedelta
import sqlite3
from . import clock

MAX_INTERVAL = 60


def next_due(interval_d: int, score: int, *, now: int | None = None) -> tuple[int, str]:
    if type(score) is not int or not 0 <= score <= 3:
        raise ValueError("score 必须为 0 到 3 的整数")
    stamp = clock.now() if now is None else now
    if score == 0:
        return 0, clock.iso(stamp + 4 * 3600)
    if score == 3:
        nxt = 1 if interval_d <= 0 else max(2, round(interval_d * 2.2))
    elif score == 2:
        nxt = 1 if interval_d <= 0 else max(1, round(interval_d * 1.4))
    else:
        nxt = 1
    nxt = min(nxt, MAX_INTERVAL)
    # Resolve the future local midnight afresh (DST can change the UTC offset).
    target = datetime.fromtimestamp(stamp).date() + timedelta(days=nxt)
    due = int(datetime.combine(target, datetime.min.time()).astimezone().timestamp())
    return nxt, clock.iso(due)


def apply_review(conn: sqlite3.Connection, card_id: int, score: int, *,
                 answer: str | None = None, method: str = "self",
                 commit: bool = True, now: int | None = None) -> dict:
    row = conn.execute("SELECT * FROM cards WHERE id=?", (card_id,)).fetchone()
    if row is None:
        raise KeyError(f"card {card_id} not found")
    if row["state"] not in ("new", "learning", "review"):
        raise ValueError("卡片已暂停或标准答案待核对，不能直接复习")
    stamp = clock.now() if now is None else now
    interval, due = next_due(int(row["interval_d"]), score, now=stamp)
    due_at = int(datetime.fromisoformat(due).timestamp())
    lapses = int(row["lapses"]) + (score == 0)
    ease = max(1.3, float(row["ease"]) - 0.2) if score == 0 else float(row["ease"])
    state = "review" if score >= 2 else "learning"
    try:
        conn.execute("""UPDATE cards SET state=?,ease=?,interval_d=?,due=?,due_at=?,
                     lapses=?,reviewed_at=? WHERE id=?""",
                     (state, ease, interval, due, due_at, lapses, clock.iso(stamp), card_id))
        conn.execute("""INSERT INTO reviews(card_id,answer,score,method,reviewed_at,due_at)
                        VALUES(?,?,?,?,?,?)""", (card_id, answer, score, method, stamp, due_at))
        if commit:
            conn.commit()
    except Exception:
        if commit:
            conn.rollback()
        raise
    return {"state": state, "interval_d": interval, "due": due, "due_at": due_at}
