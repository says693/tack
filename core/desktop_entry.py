"""One JSON request on stdin, one JSON envelope on stdout; bundled with PyInstaller."""
import json
import sys

from tack_core.service import dispatch
from tack_core.llm import ModelError


def main() -> int:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        line = sys.stdin.readline(1_000_001)
        if len(line) > 1_000_000:
            raise ValueError("请求过大")
        result = dispatch(json.loads(line))
        response = {"ok": True, "result": result}
    except (ValueError, ModelError) as exc:
        response = {"ok": False, "error": str(exc)[:800]}
    except Exception as exc:
        # No successful-looking placeholder and no credential-bearing exception body.
        response = {"ok": False, "error": f"内核操作失败（{type(exc).__name__}），未提交本次修改"}
    print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
