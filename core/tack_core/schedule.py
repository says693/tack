"""调度：答完一张卡，决定它下一次出现的日子。

规则（温和版 SM-2，刻意简单）：
- 3 分：间隔 ×2.2（1 → 2 → 4 → 9 天），state 进 review
- 2 分：间隔 ×1.4，最少 1 天
- 1 分：明天
- 0 分：今天稍后（隔 4 小时），lapses +1
不催不吓：最长间隔封顶 60 天，错的卡不惩罚，只是更早回来。
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta

MAX_INTERVAL = 60


def next_due(interval_d: int, score: int) -> tuple[int, str]:
    """返回 (新间隔天数, iso 日期)。score 0 时用时间戳精确到小时。"""
    if score >= 3:
        nxt = 1 if interval_d <= 0 else max(2, round(interval_d * 2.2))
    elif score == 2:
        nxt = 1 if interval_d <= 0 else max(1, round(interval_d * 1.4))
    elif score == 1:
        nxt = 1
    else:
        return 0, (datetime.now() + timedelta(hours=4)).strftime("%Y-%m-%d %H:%M:%S")
    return min(nxt, MAX_INTERVAL), (date.today() + timedelta(days=nxt)).isoformat()


def apply_review(
    conn: sqlite3.Connection, card_id: int, score: int, *, answer: str | None = None
) -> dict:
    row = conn.execute(
        "SELECT state, ease, interval_d, lapses FROM cards WHERE id = ?", (card_id,)
    ).fetchone()
    if row is None:
        raise KeyError(f"card {card_id} not found")

    ease = float(row["ease"])
    interval = int(row["interval_d"])
    lapses = int(row["lapses"])

    new_interval, due = next_due(interval, score)
    if score == 0:
        lapses += 1
        ease = max(1.3, ease - 0.2)
        state = "learning"
    elif score >= 2:
        state = "review"
        ease = min(3.0, ease + 0.05)
    else:
        state = "learning"

    conn.execute(
        """
        UPDATE cards
        SET state = ?, ease = ?, interval_d = ?, due = ?, lapses = ?,
            reviewed_at = datetime('now'), answer = COALESCE(?, answer)
        WHERE id = ?
        """,
        (state, ease, new_interval, due, lapses, answer, card_id),
    )
    conn.commit()
    return {"state": state, "interval_d": new_interval, "due": due}
