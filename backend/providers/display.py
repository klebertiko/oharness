"""Shared display-safe renderers for provider data: the endpoint and filesystem paths.

One implementation for `GET /providers/diagnostics` and the `oharness providers` CLI, so
the two cannot drift on what they let through.
"""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urlsplit

_OTHER_PROFILE = re.compile(r"^(?P<root>(?:[A-Za-z]:)?/(?:Users|home)/)[^/]+", re.IGNORECASE)


def safe_endpoint(raw: str) -> str:
    """scheme://host[:port]/path for a plain http(s) URL, else "".

    No userinfo, query or fragment; an IPv6 literal keeps its brackets.
    """
    if not raw:
        return ""
    try:
        parts = urlsplit(raw.strip())
        host, port = parts.hostname, parts.port
    except ValueError:
        return ""
    if parts.scheme not in ("http", "https") or not host:
        return ""
    shown = f"[{host}]" if ":" in host else host
    return f"{parts.scheme}://{shown}{f':{port}' if port else ''}{parts.path}"


def mask_home(path: str, *, other_profiles: bool = True) -> str:
    """Spell the user's home as ``~`` (either slash style).

    With ``other_profiles`` a path outside the home under ``<drive>:/Users/<name>`` or
    ``/home/<name>`` gets the name masked as ``<user>``; without it such a path is returned as given.
    """
    norm = path.replace("\\", "/")
    home_norm = str(Path.home()).replace("\\", "/").rstrip("/")
    if home_norm:
        if norm.lower() == home_norm.lower():
            return "~"
        if norm.lower().startswith(home_norm.lower() + "/"):
            return "~" + norm[len(home_norm):]
    if other_profiles:
        return _OTHER_PROFILE.sub(lambda m: m.group("root") + "<user>", norm)
    return path
