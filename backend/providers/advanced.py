"""Per-connection advanced options. A rejected value is a fixed reason, never the value itself."""
from __future__ import annotations

import json
import unicodedata

POLICIES = ("inherit", "transient", "all")
MAX_NAME = 80
MAX_CONTEXT = 2_000_000
MAX_OUTPUT = 200_000
MAX_MODELS = 40


def _plain(value: object, limit: int, *, spaces: bool = False) -> str | None:
    """Printable text. A display name may hold plain spaces; an id holds none."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or len(text) > limit:
        return None
    if any(unicodedata.category(ch) in ("Cc", "Cf") or (ch.isspace() and not (spaces and ch == " ")) for ch in text):
        return None
    return text


def validate_advanced(body: object) -> tuple[dict | None, str | None]:
    if not isinstance(body, dict):
        return None, "The advanced options could not be read."
    policy = body.get("retryPolicy", "inherit")
    if policy not in POLICIES:
        return None, "Choose inherit, transient, or all."
    cap = body.get("retryCap", 2)
    if isinstance(cap, bool) or not isinstance(cap, int) or not 0 <= cap <= 8:
        return None, "The retry cap must be a whole number from 0 to 8."
    allow = body.get("allowlist", [])
    if not isinstance(allow, list) or len(allow) > MAX_MODELS:
        return None, "The model list is not valid."
    names: list[str] = []
    for item in allow:
        name = _plain(item, 128)
        if name is None:
            return None, "A model id in the list is not valid."
        names.append(name)
    raw_models = body.get("models", {})
    if not isinstance(raw_models, dict) or len(raw_models) > MAX_MODELS:
        return None, "The per-model options are not valid."
    models: dict[str, dict] = {}
    for key, options in raw_models.items():
        model_id = _plain(key, 128)
        if model_id is None or not isinstance(options, dict):
            return None, "A model id in the options is not valid."
        display = options.get("displayName", model_id)
        shown = _plain(display, MAX_NAME, spaces=True)
        if shown is None:
            return None, "A display name is not valid."
        context = options.get("context", 0)
        maximum = options.get("maxOutput", 0)
        if isinstance(context, bool) or not isinstance(context, int) or not 0 <= context <= MAX_CONTEXT:
            return None, "A context window is not valid."
        if isinstance(maximum, bool) or not isinstance(maximum, int) or not 0 <= maximum <= MAX_OUTPUT:
            return None, "A maximum output is not valid."
        models[model_id] = {"displayName": shown, "context": context, "maxOutput": maximum}
    return {"retryPolicy": policy, "retryCap": cap, "allowlist": names, "models": models}, None


def dumps_advanced(clean: dict) -> str:
    return json.dumps(clean, separators=(",", ":"), sort_keys=True)
