"""Catalog of the example harnesses bundled with the app.

Order is the order the Studio lists them: the default Agile harness first,
then the examples modelled on published projects (each cites its source in
``manifest.description``).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from . import codec

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@dataclass(frozen=True)
class Example:
    id: str
    path: Path


_EXAMPLES: tuple[Example, ...] = (
    Example("oharness.default.agile", FIXTURES / "default-agile.ohm"),
    Example("oharness.example.deepseek-harness", FIXTURES / "deepseek-harness.ohm"),
    Example("oharness.example.mattpocock-skills", FIXTURES / "mattpocock-skills.ohm"),
)


def list_examples() -> tuple[Example, ...]:
    return _EXAMPLES


def get_example(example_id: str) -> Example | None:
    return next((e for e in _EXAMPLES if e.id == example_id), None)


def load_example(example: Example) -> dict:
    return codec.load_path(example.path)
