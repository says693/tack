"""G0 冒烟测试：不联网、不起 Tauri 也能验证闭环。

    cd core
    python -m unittest discover -s tests -v
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

# 测试用临时库，别碰真实 data/
_TMP = tempfile.mkdtemp(prefix="tack-test-")
os.environ["TACK_DATA_DIR"] = _TMP

from tack_core import grade, ingest, quiz, schedule, store  # noqa: E402


SAMPLE = """细胞膜与物质的跨膜运输

钠钾泵每消耗一分子 ATP，把 3 个 Na+ 泵出细胞、2 个 K+ 泵入细胞。两个方向都逆浓度梯度，因此属于主动运输。

ATP 在细胞里被称为能量货币。它不被一次性烧掉，而是在酶的作用下按需水解，把能量分给吸能反应。
"""


class CoreTest(unittest.TestCase):
    def setUp(self):
        self.conn = store.connect("test-subject")
        store.ensure_subject(self.conn, "test-subject", "测试科目")
        p = Path(_TMP) / "sample.md"
        p.write_text(SAMPLE, "utf-8")
        self.info = ingest.import_file(self.conn, "test-subject", p)

    def tearDown(self):
        self.conn.close()

    def test_ingest_splits(self):
        self.assertGreaterEqual(self.info["chunks"], 1)

    def test_search_cjk(self):
        hits = store.search(self.conn, "钠钾泵")
        self.assertTrue(hits)
        self.assertIn("钠钾泵", hits[0]["snippet"])

    def test_search_short_query(self):
        self.assertTrue(store.search(self.conn, "ATP"))

    def test_card_roundtrip_and_schedule(self):
        card_id = store.add_card(
            self.conn,
            subject="test-subject",
            title="钠钾泵",
            line="逆浓度梯度，耗 ATP",
            prompt="钠钾泵为什么属于主动运输？",
            answer="逆浓度梯度；消耗 ATP",
            tier=1,
        )
        due = store.due_cards(self.conn, "test-subject")
        self.assertIn(card_id, [c.id for c in due])

        r = schedule.apply_review(self.conn, card_id, 3)
        self.assertEqual(r["state"], "review")
        # 新卡第一次答对：明天再来（1 天），不跳跃
        self.assertEqual(r["interval_d"], 1)
        # 第二次答对才进入 2.2× 增长
        r2 = schedule.apply_review(self.conn, card_id, 3)
        self.assertGreaterEqual(r2["interval_d"], 2)
        # 答对后今天不再出现
        self.assertNotIn(card_id, [c.id for c in store.due_cards(self.conn, "test-subject")])

    def test_grade_heuristic(self):
        key = "逆浓度梯度；消耗 ATP"
        good = grade.grade_answer("它是逆浓度梯度运输，还消耗 ATP", key)
        self.assertGreaterEqual(good["score"], 2)
        bad = grade.grade_answer("不知道", key)
        self.assertLessEqual(bad["score"], 1)

    def test_quiz_offline(self):
        drafts = quiz.draft_cards_for_doc(self.conn, self.info["doc_id"])
        self.assertTrue(drafts)
        for key in ("title", "line", "prompt", "answer", "tier"):
            self.assertIn(key, drafts[0])


if __name__ == "__main__":
    unittest.main()
