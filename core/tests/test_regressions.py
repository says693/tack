"""Audit F02-F09 regressions. No user data or external model is touched."""
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch
from uuid import uuid4

from tack_core import clock, config, grade, ingest, llm, quiz, schedule, service, store


class RegressionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="tack-regression-")
        self.root = Path(self.tmp.name)
        self.patches = [
            patch.object(config, "DATA_DIR", self.root),
            patch.object(config, "SUBJECT_DIR", self.root / "subjects"),
            patch.object(config, "LOCAL_CFG", self.root / "config.json"),
            patch.dict(os.environ, {"TACK_MODE": "offline"}),
        ]
        for p in self.patches:
            p.start()
        service.dispatch({"op": "subjects"})
        self.conn = store.connect("default")
        self.source = self.root / "中文教材.md"
        self.source.write_text("# 细胞\n细胞膜具有选择透过性。细胞核控制遗传。", encoding="utf-8")

    def tearDown(self):
        self.conn.close()
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def card(self, answer="细胞膜具有选择透过性"):
        return store.add_card(self.conn, subject="default", title="细胞膜", line=answer,
                              prompt="细胞膜的特点？", answer=answer)

    def call(self, op, **args):
        return service.dispatch({"op": op, "subject": "default", "request_id": str(uuid4()), **args})

    def test_review_preserves_key_and_records_each_answer(self):
        cid = self.card()
        for score, answer in ((0, "不知道"), (3, "细胞膜具有选择透过性")):
            schedule.apply_review(self.conn, cid, score, answer=answer)
        self.assertEqual(self.conn.execute("SELECT answer FROM cards WHERE id=?", (cid,)).fetchone()[0],
                         "细胞膜具有选择透过性")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0], 2)

    def test_due_seconds_boundary_and_count(self):
        cid = self.card()
        due = 1_800_000_000
        self.conn.execute("UPDATE cards SET due_at=? WHERE id=?", (due, cid))
        self.conn.commit()
        self.assertEqual(store.count_due(self.conn, "default", now=due - 1), 0)
        self.assertEqual(store.count_due(self.conn, "default", now=due), 1)
        self.assertEqual(len(store.due_cards(self.conn, "default", now=due)), 1)
        self.assertEqual(len(store.due_cards(self.conn, "default", now=due + 3600)), 1)

    def test_zero_score_is_exactly_four_hours(self):
        interval, due = schedule.next_due(20, 0, now=1_800_000_000)
        self.assertEqual(interval, 0)
        self.assertEqual(int(datetime.fromisoformat(due).timestamp()), 1_800_014_400)

    def test_sixty_day_cap_matches_calendar_due(self):
        stamp = clock.now()
        interval, due = schedule.next_due(60, 3, now=stamp)
        self.assertEqual(interval, 60)
        expected = datetime.fromtimestamp(stamp).date() + timedelta(days=60)
        self.assertEqual(datetime.fromisoformat(due).astimezone().date(), expected)

    def test_invalid_score_does_not_write(self):
        cid = self.card()
        for score in (-1, 4, True, 2.5):
            with self.assertRaises(ValueError):
                schedule.apply_review(self.conn, cid, score)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0], 0)

    def test_exact_single_and_two_point_answers_get_full_score(self):
        for key in ("细胞膜具有选择透过性", "逆浓度梯度；消耗 ATP"):
            self.assertEqual(grade.grade_answer(key, key)["score"], 3)

    def test_negation_is_not_approved(self):
        self.assertEqual(grade.grade_answer("细胞膜不具有选择透过性", "细胞膜具有选择透过性")["score"], 0)

    def test_online_failure_rolls_back_review(self):
        cid = self.card()
        with patch.object(llm, "available", return_value=True), \
             patch.object(llm, "chat_json", side_effect=llm.ModelError("simulated model failure")):
            with self.assertRaises(llm.ModelError):
                self.call("review", card_id=cid, answer="回答")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0], 0)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM operations").fetchone()[0], 0)

    def test_invalid_model_response_is_not_coerced(self):
        with patch.object(llm, "available", return_value=True), \
             patch.object(llm, "chat_json", return_value={"score": "3", "hit": "bad"}):
            with self.assertRaises(llm.ModelError):
                grade.grade_answer("答案", "标准")
            with self.assertRaises(llm.ModelError):
                quiz.card_from_chunk({"body": "正文"})

    def test_llm_network_error_is_explicit(self):
        cfg = config.Config(llm=config.LLMConfig(mode="online", base_url="https://example.invalid/v1"))
        client = MagicMock()
        client.__enter__.return_value = client
        client.chat.completions.create.side_effect = RuntimeError("test-only")
        with patch.object(config, "load", return_value=cfg), patch.object(llm, "_client", return_value=client):
            with self.assertRaises(llm.ModelError):
                llm.chat_json("system", "user")

    def test_long_sentence_is_bounded(self):
        chunks = ingest.split_chunks("甲" * 5000, 800, 120)
        self.assertTrue(chunks)
        self.assertTrue(all(len(c["body"]) <= 800 for c in chunks))

    def test_zero_overlap_does_not_duplicate(self):
        text = "甲" * 390 + "。" + "乙" * 390 + "。" + "丙" * 390 + "。"
        chunks = ingest.split_chunks(text, 800, 0)
        self.assertEqual("".join(c["body"] for c in chunks), text)
        self.assertNotIn("甲", chunks[-1]["body"])

    def test_invalid_chunk_parameters(self):
        for size, overlap in ((0, 0), (10, -1), (10, 10), (10, 11)):
            with self.assertRaises(ValueError):
                ingest.split_chunks("text", size, overlap)

    def test_identical_reimport_keeps_id_and_count(self):
        first = self.call("import", path=str(self.source))
        old = self.conn.execute("SELECT id,chunk_id FROM cards").fetchall()
        second = self.call("import", path=str(self.source))
        self.assertEqual(first["cards_added"], 1)
        self.assertEqual(second["cards_added"], 0)
        self.assertEqual([tuple(r) for r in old],
                         [tuple(r) for r in self.conn.execute("SELECT id,chunk_id FROM cards")])

    def test_changed_document_preserves_old_source(self):
        self.call("import", path=str(self.source))
        original = self.conn.execute("SELECT chunk_id FROM cards").fetchone()[0]
        self.source.write_text("# 新版本\n线粒体产生 ATP。", encoding="utf-8")
        self.call("import", path=str(self.source))
        self.assertIn("选择透过性", self.conn.execute("SELECT body FROM chunks WHERE id=?", (original,)).fetchone()[0])
        self.assertEqual(store.search(self.conn, "选择透过性"), [])
        self.assertTrue(store.search(self.conn, "线粒体"))

    def test_failed_generation_rolls_back_entire_import(self):
        with patch.object(quiz, "card_from_chunk", side_effect=llm.ModelError("test")):
            with self.assertRaises(llm.ModelError):
                self.call("import", path=str(self.source))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0], 0)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0], 0)

    def test_review_idempotency_and_collision(self):
        cid = self.card()
        request = {"op": "review", "subject": "default", "card_id": cid, "kind": "remembered",
                   "request_id": str(uuid4())}
        first = service.dispatch(request)
        self.assertEqual(service.dispatch(request), first)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0], 1)
        with self.assertRaises(ValueError):
            service.dispatch({**request, "kind": "answer", "answer": "different"})

    def test_pin_is_persistent_and_idempotent(self):
        request = {"op": "pin", "subject": "default", "title": "自选知识", "selected": "原文内容足够详细。",
                   "request_id": str(uuid4())}
        first = service.dispatch(request)
        self.assertEqual(service.dispatch(request)["id"], first["id"])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0], 1)
        card = service.dispatch({"op": "snapshot"})["cards"][0]
        self.assertEqual(card["parent"], request["selected"])

    def test_subject_isolation_and_no_demo(self):
        self.assertEqual(service.dispatch({"op": "snapshot"})["cards"], [])
        self.card()
        other = service.dispatch({"op": "create_subject", "name": "微积分"})
        self.assertEqual(service.dispatch({"op": "snapshot", "subject": other["slug"]})["cards"], [])
        self.assertEqual(len(service.dispatch({"op": "snapshot"})["cards"]), 1)

    def test_defer_suspend_restore(self):
        cid = self.card()
        result = self.call("defer", card_id=cid, when="tomorrow")
        self.assertGreater(result["due_at"], clock.now())
        self.assertEqual(service.dispatch({"op": "snapshot"})["due"], 0)
        self.call("suspend", card_id=cid)
        self.assertEqual(len(service.dispatch({"op": "snapshot"})["suspended"]), 1)
        self.call("restore", card_id=cid)
        self.assertEqual(service.dispatch({"op": "snapshot"})["due"], 1)

    def test_late_tonight_is_an_error(self):
        cid = self.card()
        after = datetime.now().replace(hour=21, minute=0, second=0)
        with patch.object(clock, "now", return_value=int(after.timestamp())):
            with self.assertRaises(ValueError):
                self.call("defer", card_id=cid, when="tonight")

    def test_subject_path_traversal_is_rejected(self):
        for subject in ("../outside", "C:\\data", "x.db", "/tmp"):
            with self.assertRaises(ValueError):
                service.dispatch({"op": "snapshot", "subject": subject})

    def test_invalid_configuration_fails_loudly(self):
        config.LOCAL_CFG.write_text("{broken", encoding="utf-8")
        with self.assertRaises(ValueError):
            config.load()

    def test_ambient_provider_key_is_not_borrowed(self):
        with patch.dict(os.environ, {"TACK_API_KEY": "", "OPENAI_API_KEY": "unrelated-test-value",
                                     "DEEPSEEK_API_KEY": "unrelated-test-value"}), \
             patch("keyring.get_password", return_value=None):
            self.assertEqual(config.read_api_key(), "")

    def test_no_fts_error_fallback(self):
        self.call("import", path=str(self.source))
        self.conn.execute("DROP TABLE chunks_fts")
        with self.assertRaises(sqlite3.OperationalError):
            store.search(self.conn, "细胞膜")

    def test_legacy_migration_quarantines_reviewed_keys(self):
        old_path = self.root / "old.db"
        with closing(sqlite3.connect(old_path)) as old:
            old.executescript(store.SCHEMA)
            old.execute("INSERT INTO meta VALUES('schema','1')")
            old.execute("INSERT INTO subjects(slug,name) VALUES('legacy','旧库')")
            old.execute("""INSERT INTO cards(subject,title,line,prompt,answer,due,reviewed_at)
                           VALUES('legacy','旧卡','line','question','possibly corrupted','2026-11-16','2026-11-15')""")
            old.commit()
        with closing(store.connect(old_path)) as migrated:
            row = migrated.execute("SELECT due_at,state,answer FROM cards").fetchone()
            self.assertGreater(row["due_at"], 0)
            self.assertEqual(row["state"], "needs_verification")
            self.assertEqual(row["answer"], "possibly corrupted")
            self.assertEqual(store.due_cards(migrated, "legacy", now=2_000_000_000), [])

    def test_invalid_legacy_date_rolls_back_schema_changes(self):
        old_path = self.root / "invalid-old.db"
        with closing(sqlite3.connect(old_path)) as old:
            old.executescript(store.SCHEMA)
            old.execute("INSERT INTO meta VALUES('schema','1')")
            old.execute("INSERT INTO subjects(slug,name) VALUES('legacy','旧库')")
            old.execute("""INSERT INTO cards(subject,title,line,prompt,due)
                           VALUES('legacy','旧卡','line','question','not-a-date')""")
            old.commit()
        with self.assertRaises(ValueError):
            store.connect(old_path)
        with closing(sqlite3.connect(old_path)) as check:
            self.assertNotIn("due_at", [r[1] for r in check.execute("PRAGMA table_info(cards)")])
            self.assertEqual(check.execute("SELECT value FROM meta WHERE key='schema'").fetchone()[0], "1")


if __name__ == "__main__":
    unittest.main()
