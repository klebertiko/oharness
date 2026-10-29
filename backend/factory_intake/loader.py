"""Find the factory foundation's ``FactoryPort`` (package A) without importing it at build time.

``OH_FACTORY_PORT=module:callable`` names a zero-argument callable returning a ``FactoryPort``; without it the foundation's own adapter
``factory.port_adapter:build_port`` is tried. Until the foundation ships one, the intake CLI/server say so instead of failing obscurely.
"""
from __future__ import annotations

import importlib
import os

from .port import FactoryPort

DEFAULT_TARGET = "factory.port_adapter:build_port"


class FoundationMissing(RuntimeError):
    """The factory foundation is not available in this installation."""


def load_port(target: str | None = None) -> FactoryPort:
    target = target or os.environ.get("OH_FACTORY_PORT") or DEFAULT_TARGET
    module_name, _, attr = target.partition(":")
    try:
        module = importlib.import_module(module_name)
        port = getattr(module, attr)()
    except (ImportError, AttributeError, TypeError):
        raise FoundationMissing(f"the factory foundation is not available here ({target} not found); install it or set OH_FACTORY_PORT=module:callable") from None
    if not isinstance(port, FactoryPort):
        raise FoundationMissing(f"{target} did not return a FactoryPort")
    return port
