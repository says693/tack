"""One explicit online path. Failure never triggers local grading."""
import json
from . import config


class ModelError(RuntimeError):
    pass


def available() -> bool:
    return config.load().online


def _client():
    from openai import OpenAI
    cfg = config.load().llm
    key = config.read_api_key()
    if not key:
        raise ModelError("在线模式未配置 tack 专用 API Key")
    return OpenAI(base_url=cfg.base_url, api_key=key, timeout=cfg.timeout_s, max_retries=0)


def chat_json(system: str, user: str, *, fast: bool = False) -> dict:
    cfg = config.load()
    if not cfg.online:
        raise ModelError("离线模式不能调用在线模型")
    try:
        with _client() as client:
            response = client.chat.completions.create(
                model=cfg.llm.fast_model if fast else cfg.llm.model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.3, response_format={"type": "json_object"},
            )
        raw = response.choices[0].message.content
        if not isinstance(raw, str):
            raise ModelError("模型没有返回文本")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ModelError("模型必须返回 JSON 对象")
        return data
    except ModelError:
        raise
    except Exception as exc:
        # Provider response bodies/headers can include credentials.
        raise ModelError(f"模型调用失败（{type(exc).__name__}）；本次结果未保存，请检查配置后重试") from exc
