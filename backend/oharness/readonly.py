"""Look at the OHarness data directory without touching it.

`oharness providers list|test|doctor` and `oharness doctor` promise to only look. The sidecar's own start-up does more than that: it creates the data
directory, restricts its ACL, runs `create_all` (an empty `harness.db` with every table) and builds the secrets store (the `secrets/` folder).
None of it may happen here: a first run with nothing on disk must still have nothing on disk afterwards.

Every failure is a fixed `Unreadable`, never the driver's own text (it carries a path).
"""
from __future__ import annotations

import os
from pathlib import Path

CONNECTIONS_TABLE = "provider_connections"
_BACKENDS = {"": "memory", "mem": "memory", "memory": "memory", "file": "file", "keychain": "keychain", "keyring": "keychain", "os": "keychain"}  # what `secret_store.factory` accepts


class Unreadable(RuntimeError):
    """The database (or the secrets folder) cannot be read. The message never contains a path."""


def backend_on_path() -> None:
    """Make the backend's top-level modules importable, and nothing else (`headless._backend_on_path` would also configure, i.e. create, the data directory)."""
    import sys

    backend = str(Path(__file__).resolve().parent.parent)
    if backend not in sys.path:
        sys.path.insert(0, backend)


def database_path() -> Path:
    """Where the sidecar would keep `harness.db`: `DATABASE_URL` when it is a sqlite one, else `<data directory>/harness.db`. Nothing is created."""
    backend_on_path()
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if url:
        if not url.startswith("sqlite") or ":///" not in url:
            raise Unreadable("the database is not a sqlite file")
        return Path(url.split(":///", 1)[1].split("?", 1)[0])
    from data_dir import DataDirError, resolve_data_dir

    try:
        return resolve_data_dir(create=False) / "harness.db"
    except DataDirError:
        raise Unreadable("the data directory is not usable") from None


def read_connections() -> tuple[dict, str]:
    """`(connections, state)`: state is `missing` when there is no database yet (a first run: `{}`), else `ok`. The database is opened read-only."""
    path = database_path()
    if not path.is_file():
        return {}, "missing"
    from sqlalchemy import create_engine, inspect, select
    from sqlalchemy.orm import Session

    engine = None
    try:
        engine = create_engine(f"sqlite:///{path.as_uri()}?mode=ro&uri=true")  # mode=ro: a missing table is an error, never a created one
        if not inspect(engine).has_table(CONNECTIONS_TABLE):
            return {}, "ok"
        from models import ProviderConnection
        from providers.store import _to_dict

        with Session(engine) as session:
            return {row.id: _to_dict(row) for row in session.scalars(select(ProviderConnection)).all()}, "ok"
    except Exception:  # never echo it: it carries the database path
        raise Unreadable("the connections database cannot be read") from None
    finally:
        if engine is not None:
            engine.dispose()


def secrets_backend() -> str | None:
    """The secrets backend the installed sidecar runs with: `memory`, `file` or `keychain`, or `None` for a value the app does not know.

    `OH_SECRETS` unset is the packaged sidecar's own default (`sidecar_entry.configure_environment`): a file store. Set (even empty), it is read the way
    `secret_store.factory` reads it. Only the fixed name is ever returned: the variable's own text is never echoed.
    """
    raw = os.environ.get("OH_SECRETS")
    return "file" if raw is None else _BACKENDS.get(raw.strip().lower())


def secrets_folder() -> Path:
    """Where a file store keeps its keys: `OH_SECRETS_DIR`, else the sidecar's default `<data directory>/secrets`. Nothing is created."""
    folder = os.environ.get("OH_SECRETS_DIR")
    if folder:
        return Path(folder)
    from data_dir import DataDirError, resolve_data_dir

    try:
        return resolve_data_dir(create=False) / "secrets"
    except DataDirError:
        raise Unreadable("the data directory is not usable") from None


def secrets_state() -> str:
    """`ok`, `missing` (a first run: no secrets folder yet) or raise `Unreadable`. The store is not built: no folder is created and no value is read."""
    backend = secrets_backend()
    if backend is None:
        raise Unreadable("the secrets backend is not one the app knows")
    if backend != "file":
        return "ok"
    path = secrets_folder()
    if not path.exists():
        return "missing"
    if not path.is_dir() or not os.access(path, os.R_OK):
        raise Unreadable("the secrets folder cannot be read")
    return "ok"


class LazySecrets:
    """The secrets store, built only when a value is actually asked for (a probe with a stored key): looking never builds it."""

    def __init__(self) -> None:
        self._store = None

    def get(self, ref: str):
        if self._store is None:
            from data_dir import resolve_data_dir
            from secret_store.factory import build_secrets_store

            os.environ.setdefault("OH_SECRETS", "file")  # the sidecar's own defaults, applied only now that a value is really needed
            os.environ.setdefault("OH_SECRETS_DIR", str(resolve_data_dir(create=False) / "secrets"))

            self._store = build_secrets_store()
        return self._store.get(ref)
