"""Two credential classes (ADR 0055). The class decides who a decision is attributed to; the client never names its actor.

* agent/integration: the ordinary sidecar token (package B, the MCP). It cannot take human-only actions.
* human: a session secret the app shell hands to the webview in memory (`OH_HUMAN_TOKEN` at spawn). It is not the sidecar
  token and not in the token file. Without it configured, no request is human and decisions are unavailable (fail closed);
  `OH_FACTORY_DEV_HUMAN=1` is the explicit, documented development bridge.
"""
from __future__ import annotations

import hmac
import os

from fastapi import Request

HUMAN_HEADER = 'x-oharness-human'
HUMAN_ENV = 'OH_HUMAN_TOKEN'
DEV_ENV = 'OH_FACTORY_DEV_HUMAN'


def credential_class(request: Request) -> str:
    expected = os.environ.get(HUMAN_ENV, '')
    presented = request.headers.get(HUMAN_HEADER, '')
    if expected and presented and hmac.compare_digest(presented, expected):
        return 'human'
    return 'agent'


def human_available() -> bool:
    return bool(os.environ.get(HUMAN_ENV)) or os.environ.get(DEV_ENV) == '1'


def actor_for(request: Request) -> tuple[str, str | None]:
    cls = credential_class(request)
    if cls == 'human':
        return ('human', 'local-user')
    if os.environ.get(DEV_ENV) == '1' and not os.environ.get(HUMAN_ENV):
        return ('human', 'local-user-dev')
    return ('agent', None)
