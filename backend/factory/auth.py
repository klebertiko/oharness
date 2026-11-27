"""Two credential classes (ADR 0055). The class decides who a decision is attributed to; the client never names its actor.

* agent/integration: the ordinary sidecar token (package B, the MCP). It cannot take human-only actions.
* human: a session secret the app shell hands to the webview in memory (`OH_HUMAN_TOKEN` at spawn). It is not the sidecar
  token and not in the token file. Without it configured, no request is human and decisions are unavailable (fail closed);
  `OH_FACTORY_DEV_HUMAN=1` is the explicit, documented development bridge.
"""
from __future__ import annotations

import hmac
import os
import secrets
import sys

from fastapi import Request

HUMAN_HEADER = 'x-oharness-human'
HUMAN_ENV = 'OH_HUMAN_TOKEN'
DEV_ENV = 'OH_FACTORY_DEV_HUMAN'
STDIN_ENV = 'OH_HUMAN_STDIN'  # '1': the shell writes the credential as one line on stdin, so it is never in the environment block of the process
_held: str | None = None


def load_human_credential(stream=None) -> None:
    """Takes the credential out of the environment (and, when the shell says so, off stdin) into memory of this process only, so no child
    process inherits it and it is not in the environment block another process of the same user can read."""
    global _held
    legacy = os.environ.pop(HUMAN_ENV, '')
    if os.environ.pop(STDIN_ENV, '') == '1':
        line = (stream if stream is not None else sys.stdin).readline().strip()
        _held = line or None  # an empty or closed stdin leaves no credential: fail closed
    elif legacy:
        _held = legacy


def _expected() -> str:
    return _held if _held is not None else os.environ.get(HUMAN_ENV, '')


def credential_class(request: Request) -> str:
    expected = _expected()
    presented = request.headers.get(HUMAN_HEADER, '')
    if expected and presented and hmac.compare_digest(presented, expected):
        return 'human'
    return 'agent'


def human_available() -> bool:
    return bool(_expected()) or os.environ.get(DEV_ENV) == '1'


SCORER_HEADER = 'x-oharness-scorer'
# The run loop's own credential for recording scores. Made in this process at import and kept in memory only: it is not in the
# environment, the token file or any child process, so an agent holding the sidecar token cannot present it.
_scorer = secrets.token_urlsafe(32)


def scorer_credential() -> str:
    """For the run loop inside this process. Never hand it to an agent or write it anywhere."""
    return _scorer


def is_scorer(request: Request) -> bool:
    presented = request.headers.get(SCORER_HEADER, '')
    return bool(presented) and hmac.compare_digest(presented, _scorer)


def actor_for(request: Request) -> tuple[str, str | None]:
    cls = credential_class(request)
    if cls == 'human':
        return ('human', 'local-user')
    if os.environ.get(DEV_ENV) == '1' and not _expected():
        return ('human', 'local-user-dev')
    return ('agent', None)
