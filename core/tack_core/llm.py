"""模型层：任何 OpenAI 兼容端点，走 LiteLLM；没有就优雅地返回 None。

设计要点：
- 在线/离线同一条代码路径：调用方拿到 None 就自己走启发式，不抛异常。
- 只做一次调用拿结构化结果；不重试到天荒地老（离线优先的产品）。
- Key 永不落盘；这里只读 config.read_api_key()。
"""

from __future__ import annotations

import json
import re

from . import config


def available() -> bool:
    return config.load().online


def _client():
    try:
        from openai import OpenAI  # LiteLLM 的 1.x 底层也用这个形态；二者接口一致
    except ImportError:
        try:
            from litellm import completion as _completion  # noqa: F401

            return "litellm"
        except ImportError:
            return None
    cfg = config.load().llm
    return OpenAI(base_url=cfg.base_url, api_key=config.read_api_key(), timeout=cfg.timeout_s)


def chat(system: str, user: str, *, fast: bool = False, json_mode: bool = False) -> str | None:
    """返回纯文本；不可用或出错返回 None。"""
    cfg = config.load()
    if not config.load().online:
        return None
    model = cfg.llm.fast_model if fast else cfg.llm.model
    client = _client()
    if client is None:
        return None

    kwargs = dict(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.3,
    )
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    try:
        if client == "litellm":
            from litellm import completion

            resp = completion(**kwargs)
            return resp.choices[0].message.content
        resp = client.chat.completions.create(**kwargs)
        return resp.choices[0].message.content
    except Exception as exc:  # 网络/额度/模型名错误都收敛成"离线"
        print(f"[tack] 模型暂不可用，走本地启发式：{exc.__class__.__name__}: {exc}")
        return None


def chat_json(system: str, user: str, *, fast: bool = False) -> dict | None:
    raw = chat(system, user, fast=fast, json_mode=True)
    if not raw:
        return None
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M).strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    return data if isinstance(data, dict) else None
