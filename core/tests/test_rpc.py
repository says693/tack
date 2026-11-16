import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from uuid import uuid4


class ProcessContractTest(unittest.TestCase):
    def test_new_process_roundtrip_and_failure_envelope(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="tack-rpc-") as tmp:
            env = {**os.environ, "TACK_DATA_DIR": tmp, "TACK_MODE": "offline"}
            def call(request):
                p = subprocess.run([sys.executable, str(root / "desktop_entry.py")],
                                   input=json.dumps(request, ensure_ascii=False), capture_output=True,
                                   text=True, encoding="utf-8", env=env, timeout=30)
                self.assertEqual(p.returncode, 0, p.stderr)
                return json.loads(p.stdout)
            self.assertTrue(call({"op": "subjects"})["ok"])
            req = {"op": "pin", "title": "跨进程持久化", "selected": "跨进程重启后仍存在。",
                   "request_id": str(uuid4())}
            first = call(req)
            self.assertTrue(first["ok"], first)
            self.assertEqual(call(req), first)
            self.assertEqual(len(call({"op": "snapshot"})["result"]["cards"]), 1)
            failed = call({"op": "import", "path": str(Path(tmp) / "missing.pdf"), "request_id": str(uuid4())})
            self.assertFalse(failed["ok"])
            self.assertNotIn("result", failed)


if __name__ == "__main__":
    unittest.main()
