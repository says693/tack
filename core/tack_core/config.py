"""配置与密钥。

原则：
- data/ 目录零密钥。
- Key 只从两处来：环境变量（TACK_API_KEY / DEEPSEEK_API_KEY），
  或 Windows 凭据管理器（target = "tack/llm"，由 keyring 读取）。
- 模型端点写在 core/tack.local.json（已 gitignore），或直接给环境变量 TACK_BASE_URL。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # repo 根
DATA_DIR = Path(os.environ.get("TACK_DATA_DIR", ROOT / "data"))
SUBJECT_DIR = DATA_DIR / "subjects"
LOCAL_CFG = Path(__file__).resolve().parents[1] / "tack.local.json"

DEFAULTS = {
    "llm": {
        "base_url": "",
        "model": "deepseek-chat",
        "fast_model": "deepseek-chat",
        "timeout_s": 60,
    },
    "learn": {
        "chunk_chars": 800,
        "chunk_overlap": 120,
        "quiz_per_review": 1,
        "daily_limit": 30,
    },
}


@dataclass
class LLMConfig:
    base_url: str = ""
    model: str = "deepseek-chat"
    fast_model: str = "deepseek-chat"
    timeout_s: int = 60


@dataclass
class LearnConfig:
    chunk_chars: int = 800
    chunk_overlap: int = 120
    quiz_per_review: int = 1
    daily_limit: int = 30


@dataclass
class Config:
    llm: LLMConfig = field(default_factory=LLMConfig)
    learn: LearnConfig = field(default_factory=LearnConfig)

    @property
    def online(self) -> bool:
        """有 base_url 且拿得到 key 才算在线；否则全部走本地启发式。"""
        return bool(self.llm.base_url) and bool(read_api_key())


def _deep_merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load() -> Config:
    raw = json.loads(json.dumps(DEFAULTS))
    if LOCAL_CFG.exists():
        try:
            raw = _deep_merge(raw, json.loads(LOCAL_CFG.read_text("utf-8")))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[tack] tack.local.json 读不动，按默认配置跑：{exc}")
    if os.environ.get("TACK_BASE_URL"):
        raw["llm"]["base_url"] = os.environ["TACK_BASE_URL"]
    if os.environ.get("TACK_MODEL"):
        raw["llm"]["model"] = os.environ["TACK_MODEL"]
    return Config(
        llm=LLMConfig(**{k: raw["llm"].get(k, v) for k, v in DEFAULTS["llm"].items()}),
        learn=LearnConfig(**{k: raw["learn"].get(k, v) for k, v in DEFAULTS["learn"].items()}),
    )


def read_api_key() -> str:
    for env in ("TACK_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY"):
        v = os.environ.get(env, "").strip()
        if v:
            return v
    try:
        import keyring  # 可选依赖；没装就静默跳过

        return (keyring.get_password("tack", "llm") or "").strip()
    except Exception:
        return ""


def ensure_dirs() -> None:
    SUBJECT_DIR.mkdir(parents=True, exist_ok=True)
