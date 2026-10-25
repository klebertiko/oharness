"""
Shared test setup — runs before any test module (and before `database`/
`main` are first imported by any of them, since pytest imports conftest.py
before collecting tests).

Two independent concerns live here, merged from two sessions' work on this
suite — keep both, they don't overlap:

1. **DB/secrets/tmp isolation.** `database.py` reads `DATABASE_URL` at
   *import* time and defaults to a relative path,
   ``sqlite+aiosqlite:///./data/harness.db`` — relative to the process's
   current working directory, not the repo. Any test that imports `main`
   (directly, or via a router) and then actually touches the DB (
   ``with TestClient(app) as client:`` triggers the FastAPI lifespan, which
   calls `init_db()`) would silently create/write to whatever
   ``<cwd>/data/harness.db`` happens to resolve to. `secrets/factory.py`
   similarly reads ``OH_SECRETS``/``OH_SECRETS_DIR`` at call time — pinned
   explicitly here too rather than relying on its default.

   Every one of those variables is set to an absolute path inside a fresh
   ``tempfile.mkdtemp()`` directory (created once per test process, never
   reused, never scanned the way pytest's own ``tmp_path_factory`` walks its
   shared ``%TEMP%/pytest-of-<user>`` root — several agent worktrees have run
   this suite concurrently on this machine, and that shared, enumerated root
   is a real, observed `PermissionError` contention point; ``mkdtemp()``
   sidesteps it by construction) *before* importing anything that could read
   them, then hard-asserts the resulting paths do not fall under this repo's
   real `backend/data/` — failing the whole session loudly instead of
   letting a bug silently touch real user data. `pytest_configure` also
   reroutes pytest's own `basetemp` under this same isolation root, so
   `tmp_path`-using tests don't race other worktrees' runs either.

2. **SEC-3 sidecar-token auth** (harness Security Gate, 2026-09-11): the
   sidecar requires ``Authorization: Bearer <token>`` on every route but
   /health (see `security/sidecar_token.py`, `main.py`'s
   `require_sidecar_token` middleware). ``OH_SIDECAR_TOKEN`` is pinned to a
   fixed value *before* `main` (and so `get_or_create_token()`) is ever
   imported, so the whole test session agrees on one token instead of racing
   a freshly-generated one; `TestClient.request` is monkeypatched, once, to
   inject that token's Authorization header on every call — so no individual
   test file needs to know the auth requirement exists at all.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_REAL_DATA_DIR = (_BACKEND_DIR / "data").resolve()

_ISOLATION_ROOT = Path(tempfile.mkdtemp(prefix="oharness-test-")).resolve()
_DB_PATH = _ISOLATION_ROOT / "harness.db"
_SECRETS_DIR = _ISOLATION_ROOT / "secrets"
_SECRETS_DIR.mkdir(parents=True, exist_ok=True)

if not _DB_PATH.is_absolute():
    raise RuntimeError("test isolation failed: computed DATABASE_URL path is not absolute")
if _REAL_DATA_DIR == _DB_PATH.parent or _REAL_DATA_DIR in _DB_PATH.parents:
    raise RuntimeError(
        f"test isolation failed: DATABASE_URL resolved under the real "
        f"{_REAL_DATA_DIR} -- refusing to run the suite"
    )
if str(_ISOLATION_ROOT).startswith(str(_BACKEND_DIR)):
    raise RuntimeError(
        f"test isolation failed: temp root {_ISOLATION_ROOT} is inside the repo checkout"
    )

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_DB_PATH.as_posix()}"
os.environ["OH_SECRETS"] = "memory"
os.environ["OH_SECRETS_DIR"] = str(_SECRETS_DIR)
os.environ.setdefault("OH_SIDECAR_TOKEN", "test-fixed-sidecar-token")


def pytest_configure(config) -> None:
    # Several other agent worktrees run this same suite concurrently on this
    # machine and all default to the *same* shared, per-username temp root
    # (pytest's own `tmp_path`/`tmp_path_factory` fixtures scan and manage
    # ``%TEMP%/pytest-of-<user>``) -- that scan is a real, observed
    # `PermissionError: Access is denied` failure point under concurrency.
    # Route pytest's own basetemp under this process's isolation root instead
    # of the shared one, so `tmp_path`-using tests (e.g. test_compile_default)
    # don't race other worktrees' pytest runs.
    config.option.basetemp = str(_ISOLATION_ROOT / "pytest-tmp")


from starlette.testclient import TestClient  # noqa: E402

_original_request = TestClient.request


def _authenticated_request(self, method, url, **kwargs):
    headers = kwargs.get("headers") or {}
    headers = {**headers, "Authorization": f"Bearer {os.environ['OH_SIDECAR_TOKEN']}"}
    kwargs["headers"] = headers
    return _original_request(self, method, url, **kwargs)


TestClient.request = _authenticated_request
