"""Explicit modes and app-owned configuration. No implicit credential borrowing."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from platformdirs import user_data_path
from pydantic import BaseModel, ConfigDict, Field, model_validator

DATA_DIR = Path(os.environ.get("TACK_DATA_DIR", user_data_path("app.tack.desktop", appauthor=False, roaming=True)))
SUBJECT_DIR = DATA_DIR / "subjects"
LOCAL_CFG = DATA_DIR / "config.json"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class LLMConfig(StrictModel):
    mode: Literal["offline", "online"] = "offline"
    base_url: str = ""
    model: str = "deepseek-chat"
    fast_model: str = "deepseek-chat"
    timeout_s: int = Field(default=60, ge=1, le=120)

    @model_validator(mode="after")
    def validate_endpoint(self):
        if self.mode == "online":
            url = urlsplit(self.base_url)
            if url.scheme != "https" or not url.hostname or url.username or url.password:
                raise ValueError("在线模式必须配置不含账号密码的 HTTPS base_url")
            if not self.model.strip() or not self.fast_model.strip():
                raise ValueError("模型名称不能为空")
        return self


class LearnConfig(StrictModel):
    chunk_chars: int = Field(default=800, ge=50, le=4000)
    chunk_overlap: int = Field(default=120, ge=0)
    daily_limit: int = Field(default=30, ge=1, le=200)

    @model_validator(mode="after")
    def validate_overlap(self):
        if self.chunk_overlap >= self.chunk_chars:
            raise ValueError("chunk_overlap 必须小于 chunk_chars")
        return self


class Config(StrictModel):
    llm: LLMConfig = Field(default_factory=LLMConfig)
    learn: LearnConfig = Field(default_factory=LearnConfig)

    @property
    def online(self) -> bool:
        return self.llm.mode == "online"


def load() -> Config:
    raw = json.loads(LOCAL_CFG.read_text("utf-8")) if LOCAL_CFG.exists() else {}
    if not isinstance(raw, dict):
        raise ValueError("配置必须是 JSON 对象")
    llm = raw.setdefault("llm", {})
    if not isinstance(llm, dict):
        raise ValueError("llm 必须是 JSON 对象")
    for env, field in (("TACK_MODE", "mode"), ("TACK_BASE_URL", "base_url"), ("TACK_MODEL", "model")):
        if env in os.environ:
            llm[field] = os.environ[env]
    if llm.get("base_url") and "mode" not in llm:
        raise ValueError("配置了模型端点时必须明确设置 llm.mode 为 online 或 offline")
    return Config.model_validate(raw)


def read_api_key() -> str:
    value = os.environ.get("TACK_API_KEY", "").strip()
    if value:
        return value
    import keyring
    # Credential-store errors must not change the selected mode.
    return (keyring.get_password("tack", "llm") or "").strip()


def ensure_dirs() -> None:
    SUBJECT_DIR.mkdir(parents=True, exist_ok=True)
