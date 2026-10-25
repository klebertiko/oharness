"""Restricted YAML 1.2 profile codec for OHM bundles, plus legacy JSON import.

Pipeline (ADR 0003 / docs/product/ohm-yaml-migration.md P1):

    decode_bytes(raw)   -> dict   restricted-profile parse; no schema validation yet
    normalize(data)     -> dict   schema + graph + Pydantic validation, deterministic
                                  key ordering; never drops a JSON-compatible field
    encode(normalized)  -> bytes  canonical, deterministic YAML emission

JSON is accepted as-is by decode_bytes(): a JSON document that only uses double
quotes and flow-style `{}`/`[]` (which is how every producer in this codebase
emits JSON) is syntactically valid YAML, so there is exactly one restricted
parser and it does not branch on file extension -- "extensao nao determina o
parser" (ohm-yaml-migration.md P1 step 3). Legacy `.oharness`/`.ohm` JSON files
therefore go through the same duplicate-key/anchor/tag/limit checks as native
YAML instead of a permissive `json.loads`.

Restricted profile (ADR 0003):
  - exactly one, non-empty YAML document
  - document root MUST be a mapping
  - mapping keys are always taken as their literal decoded string value --
    never coerced from/interpreted as int/bool/null, regardless of style
  - no duplicate keys within a mapping, including keys that only differ by
    escape sequence: a plain `a` and a double-quoted, backslash-u-escaped
    key both collide, since the scanner already decodes both to the same
    string before we ever see them (see test_codec.py and
    tests/fixtures/ohm/negative/duplicate-keys-escaped.yaml)
  - no explicit tags (including `!!str`), no anchors, no aliases, no merge
    keys (a literal `<<` mapping key is rejected outright)
  - no `%YAML`/`%TAG` directives other than the implicit YAML 1.2 default
  - scalar resolution uses a YAML-1.2-Core-schema-shaped resolver, filtered to
    JSON-compatible values, and only for *plain* (unquoted, non-block)
    scalars -- quoted and block scalars are always strings:
      null:  ~ | null | Null | NULL | <empty>
      bool:  true | True | TRUE | false | False | FALSE   (1.1 words like
             `yes`/`on`/`off`/`no` are Core-1.2-unambiguous and stay strings)
      int:   [-+]?[0-9]+ | 0o[0-7]+ | 0x[0-9a-fA-F]+        (1.2 forms only;
             a decimal with leading zeros, e.g. "007", is decimal 7, never
             1.1-style octal)
      float: [-+]?(\\.[0-9]+|[0-9]+(\\.[0-9]*)?)([eE][-+]?[0-9]+)?
      `.inf`/`-.inf`/`.nan` (any case) are rejected outright -- NaN/Infinity
             are not JSON-compatible, so they are a parse error rather than a
             silent string/float downgrade.
      anything else stays a string, verbatim, with no truncation.
  - resource limits (see ResourceLimits) are enforced *while* walking the
    event stream, before the corresponding Python object is materialized.

These restrictions are OHM's own authoring profile, not a general limitation
of YAML (ADR 0003), and this module is the only place that is allowed to
decide them -- callers should never post-process a decoded value to "fix up"
a type.
"""

from __future__ import annotations

import io
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.events import (
    AliasEvent,
    DocumentEndEvent,
    DocumentStartEvent,
    MappingEndEvent,
    MappingStartEvent,
    ScalarEvent,
    SequenceEndEvent,
    SequenceStartEvent,
    StreamEndEvent,
    StreamStartEvent,
)
from ruamel.yaml.scalarstring import DoubleQuotedScalarString, LiteralScalarString

from .validate import validate_dict

__all__ = [
    "CodecError",
    "ResourceLimits",
    "DEFAULT_LIMITS",
    "decode_bytes",
    "decode_path",
    "normalize",
    "encode",
    "load_bytes",
    "load_path",
    "dump_path",
    "ENVELOPE_ORDER",
]


# ---------------------------------------------------------------------------
# Resource limits
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ResourceLimits:
    """Cost ceilings applied *before* a document is turned into a Python
    object. These are OHarness's own limits, proposed in
    ohm-yaml-migration.md P1 step 3 and not yet an approved contract number --
    the defaults below were measured against this repo's real default bundle
    (``backend/oharness/fixtures/default-agile.ohm``, ~120 KiB decoded, 9
    nodes, 8 edges, ~30 syntax nodes deep at most) which uses well under 1% of
    every ceiling. They are deliberately generous relative to that one real
    fixture; tests exercise the *enforcement code path* with scaled-down
    overrides rather than multi-megabyte fixtures (see test_codec.py).
    """

    max_bytes: int = 8 * 1024 * 1024
    max_depth: int = 64
    max_syntax_nodes: int = 100_000
    max_scalar_bytes: int = 1 * 1024 * 1024
    max_parse_seconds: float = 2.0


DEFAULT_LIMITS = ResourceLimits()


class CodecError(ValueError):
    """A restricted-profile violation, a resource-limit breach, or a
    normalize()/encode() failure. ``path`` is a list of mapping keys / list
    indices from the document root; ``line``/``column`` are 0-based source
    positions when the underlying YAML event carried a mark.
    """

    def __init__(
        self,
        message: str,
        *,
        path: list[Any] | None = None,
        line: int | None = None,
        column: int | None = None,
    ) -> None:
        self.path = path or []
        self.line = line
        self.column = column
        located = message
        if line is not None:
            located = f"{located} (line {line + 1}, column {(column or 0) + 1})"
        if self.path:
            located = f"{'/'.join(str(p) for p in self.path)}: {located}"
        super().__init__(located)


# ---------------------------------------------------------------------------
# Core YAML 1.2 scalar resolution, filtered to JSON-compatible values
# ---------------------------------------------------------------------------

_NULL_RE = re.compile(r"^(~|null|Null|NULL)$")
_TRUE_RE = re.compile(r"^(true|True|TRUE)$")
_FALSE_RE = re.compile(r"^(false|False|FALSE)$")
_INT_DEC_RE = re.compile(r"^[-+]?[0-9]+$")
_INT_OCT_RE = re.compile(r"^0o[0-7]+$")
_INT_HEX_RE = re.compile(r"^0x[0-9a-fA-F]+$")
_FLOAT_RE = re.compile(r"^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$")
_FLOAT_SPECIAL_RE = re.compile(r"^[-+]?\.(inf|Inf|INF|nan|NaN|NAN)$")

# Defensive-only: YAML-1.1 boolean words. Our own decoder never treats these
# as anything but strings (Core 1.2 does not define them), but the emitter
# still quotes them so a generic (1.1-aware) YAML tool reads this file the
# same way we do -- see module docstring "bool" note.
_YAML_1_1_WORDS = {
    "y", "Y", "yes", "Yes", "YES",
    "n", "N", "no", "No", "NO",
    "on", "On", "ON", "off", "Off", "OFF",
}


def _core_1_2_plain(value: str) -> Any:
    if value == "" or _NULL_RE.match(value):
        return None
    if _TRUE_RE.match(value):
        return True
    if _FALSE_RE.match(value):
        return False
    if _FLOAT_SPECIAL_RE.match(value):
        raise CodecError(
            f"non-interoperable numeric literal '{value}': NaN/Infinity are not "
            "JSON-compatible and are rejected rather than silently coerced"
        )
    if _INT_DEC_RE.match(value):
        return int(value)
    if _INT_OCT_RE.match(value):
        return int(value[2:], 8)
    if _INT_HEX_RE.match(value):
        return int(value, 16)
    if _FLOAT_RE.match(value):
        return float(value)
    return value


def _is_ambiguous_plain_string(value: str) -> bool:
    """True when emitting `value` unquoted would change its decoded type
    under the profile above (or under a generic YAML 1.1 reader)."""
    if value in _YAML_1_1_WORDS:
        return True
    if value == "" or _NULL_RE.match(value) or _TRUE_RE.match(value) or _FALSE_RE.match(value):
        return True
    if _FLOAT_SPECIAL_RE.match(value) or _INT_DEC_RE.match(value):
        return True
    if _INT_OCT_RE.match(value) or _INT_HEX_RE.match(value) or _FLOAT_RE.match(value):
        return True
    return False


# ---------------------------------------------------------------------------
# decode(): restricted-profile parse via the low-level YAML event stream
# ---------------------------------------------------------------------------

_END = object()  # sentinel: "the container currently being composed just ended"


class _ParseState:
    __slots__ = ("limits", "deadline", "node_count")

    def __init__(self, limits: ResourceLimits) -> None:
        self.limits = limits
        self.deadline = time.monotonic() + limits.max_parse_seconds
        self.node_count = 0

    def tick(self) -> None:
        if time.monotonic() >= self.deadline:
            raise CodecError(f"parsing exceeded {self.limits.max_parse_seconds}s")
        self.node_count += 1
        if self.node_count > self.limits.max_syntax_nodes:
            raise CodecError(
                f"document exceeds {self.limits.max_syntax_nodes} syntax nodes"
            )


def _mark(ev) -> tuple[int | None, int | None]:
    mark = getattr(ev, "start_mark", None)
    if mark is None:
        return None, None
    return getattr(mark, "line", None), getattr(mark, "column", None)


def _next(events, state: _ParseState):
    try:
        ev = next(events)
    except StopIteration as ex:
        raise CodecError("unexpected end of input") from ex
    except CodecError:
        raise
    except Exception as ex:
        # ruamel's scanner/parser raises lazily, one event at a time, not at
        # the yaml.parse(text) call itself -- surface every syntax error
        # (bad flow mapping, tab indentation, unterminated quote, ...) as a
        # CodecError instead of leaking a ruamel-internal exception type.
        raise CodecError(f"YAML syntax error: {ex}") from ex
    if time.monotonic() >= state.deadline:
        raise CodecError(f"parsing exceeded {state.limits.max_parse_seconds}s")
    return ev


def _check_no_tag_anchor(ev) -> None:
    tag = getattr(ev, "tag", None)
    if tag is not None:
        line, col = _mark(ev)
        raise CodecError(f"explicit tags are not allowed ('{tag}')", line=line, column=col)
    anchor = getattr(ev, "anchor", None)
    if anchor is not None:
        line, col = _mark(ev)
        raise CodecError(f"anchors are not allowed ('&{anchor}')", line=line, column=col)


def _compose(events, state: _ParseState, depth: int):
    ev = _next(events, state)
    if isinstance(ev, (SequenceEndEvent, MappingEndEvent)):
        return _END
    state.tick()

    if isinstance(ev, AliasEvent):
        line, col = _mark(ev)
        raise CodecError("aliases are not allowed", line=line, column=col)

    if isinstance(ev, ScalarEvent):
        _check_no_tag_anchor(ev)
        value = ev.value
        if len(value.encode("utf-8")) > state.limits.max_scalar_bytes:
            raise CodecError(f"scalar exceeds {state.limits.max_scalar_bytes} bytes")
        if ev.style is not None:  # quoted or block scalar: always a string
            return value
        return _core_1_2_plain(value)

    if depth > state.limits.max_depth:
        line, col = _mark(ev)
        raise CodecError(
            f"structure exceeds max depth {state.limits.max_depth}", line=line, column=col
        )

    if isinstance(ev, SequenceStartEvent):
        _check_no_tag_anchor(ev)
        items: list[Any] = []
        while True:
            item = _compose(events, state, depth + 1)
            if item is _END:
                return items
            items.append(item)

    if isinstance(ev, MappingStartEvent):
        _check_no_tag_anchor(ev)
        result: dict[str, Any] = {}
        while True:
            key_ev = _next(events, state)
            if isinstance(key_ev, MappingEndEvent):
                return result
            state.tick()
            if not isinstance(key_ev, ScalarEvent):
                line, col = _mark(key_ev)
                raise CodecError(
                    "mapping keys must be plain scalars (strings)", line=line, column=col
                )
            _check_no_tag_anchor(key_ev)
            key = key_ev.value
            if key == "<<":
                line, col = _mark(key_ev)
                raise CodecError("merge keys ('<<') are not allowed", line=line, column=col)
            if key in result:
                line, col = _mark(key_ev)
                raise CodecError(f"duplicate key '{key}'", line=line, column=col)
            result[key] = _compose(events, state, depth + 1)
        # unreachable

    line, col = _mark(ev)
    raise CodecError(f"unexpected YAML event: {type(ev).__name__}", line=line, column=col)


def _decode_text(text: str, *, limits: ResourceLimits) -> dict:
    yaml = YAML(typ="safe", pure=True)
    try:
        events = yaml.parse(text)
    except Exception as ex:  # pragma: no cover - defensive: scanner/parser errors
        raise CodecError(f"YAML syntax error: {ex}") from ex

    state = _ParseState(limits)

    start_ev = _next(events, state)
    if not isinstance(start_ev, StreamStartEvent):  # pragma: no cover - defensive
        raise CodecError("expected start of stream")

    doc_ev = _next(events, state)
    if isinstance(doc_ev, StreamEndEvent):
        raise CodecError("document is empty")
    if not isinstance(doc_ev, DocumentStartEvent):  # pragma: no cover - defensive
        raise CodecError("expected a YAML document")
    if doc_ev.version is not None and tuple(doc_ev.version) != (1, 2):
        version = ".".join(str(p) for p in doc_ev.version)
        raise CodecError(f"unsupported YAML directive '%YAML {version}'; only YAML 1.2 is accepted")
    if doc_ev.tags:
        raise CodecError("%TAG directives are not allowed")

    root = _compose(events, state, depth=1)
    if root is _END:  # pragma: no cover - defensive
        raise CodecError("document is empty")

    end_ev = _next(events, state)
    if not isinstance(end_ev, DocumentEndEvent):  # pragma: no cover - defensive
        raise CodecError("malformed document end")

    trailing_ev = _next(events, state)
    if not isinstance(trailing_ev, StreamEndEvent):
        raise CodecError(
            "multiple YAML documents are not allowed; exactly one document is required"
        )

    if not isinstance(root, dict):
        raise CodecError("document root must be a mapping")
    return root


def decode_bytes(raw: bytes, *, limits: ResourceLimits = DEFAULT_LIMITS) -> dict:
    """Parse `raw` (a whole .ohm/.oharness/.yaml file's bytes) under the
    restricted YAML 1.2 profile. Accepts native YAML and legacy pretty-printed
    JSON alike (see module docstring). Never mutates `raw`; never guesses an
    encoding other than strict UTF-8.
    """
    if len(raw) > limits.max_bytes:
        raise CodecError(f"input exceeds {limits.max_bytes} bytes ({len(raw)} bytes)")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as ex:
        raise CodecError(f"input is not valid UTF-8: {ex}") from ex
    return _decode_text(text, limits=limits)


def decode_path(path: Path, *, limits: ResourceLimits = DEFAULT_LIMITS) -> dict:
    return decode_bytes(Path(path).read_bytes(), limits=limits)


# ---------------------------------------------------------------------------
# normalize(): schema/model validation + deterministic key ordering
# ---------------------------------------------------------------------------

#: Declared key order for the envelope and its direct known object children,
#: taken from the JSON Schema's `required` lists (ohm-yaml-migration.md P1
#: step 4: "ordem do envelope declarada no schema"). Keys not listed here
#: (extension fields the schema doesn't forbid, or free-form objects such as
#: node/edge data) fall back to an alphabetical comparator -- see
#: `_ordered_mapping`. Nothing in this table causes a field to be dropped;
#: unknown keys are always kept, just sorted after the known ones.
ENVELOPE_ORDER: dict[str, tuple[str, ...]] = {
    "bundle": ("schemaVersion", "manifest", "graph", "content", "runtime", "validation"),
    "manifest": ("id", "name", "version", "description", "license", "tags"),
    "graph": ("nodes", "edges"),
    "content": ("prompts", "agents", "skills", "hooks", "commands", "scripts"),
    "runtime": ("preferred", "cli", "env", "secrets"),
    "validation": ("mockProfile",),
}

# shape name of a mapping value found at bundle[key] -- used to keep
# recursing with the *right* known order instead of falling back to
# alphabetical for these five well-known envelope children.
_CHILD_SHAPE: dict[tuple[str, str], str] = {
    ("bundle", "manifest"): "manifest",
    ("bundle", "graph"): "graph",
    ("bundle", "content"): "content",
    ("bundle", "runtime"): "runtime",
    ("bundle", "validation"): "validation",
}


def _ordered_mapping(d: dict, known_order: tuple[str, ...] | None) -> list[str]:
    if known_order:
        head = [k for k in known_order if k in d]
        tail = sorted(k for k in d if k not in known_order)
        return head + tail
    return sorted(d.keys())


def _reorder(value: Any, shape: str | None) -> Any:
    if isinstance(value, dict):
        keys = _ordered_mapping(value, ENVELOPE_ORDER.get(shape or ""))
        return {k: _reorder(value[k], _CHILD_SHAPE.get((shape, k))) for k in keys}
    if isinstance(value, list):
        # Arrays keep their original element order -- never sorted. Provider
        # fallback order and predecessor order can affect execution (P1 step
        # 4), so only each element's *own* keys get reordered.
        return [_reorder(v, None) for v in value]
    return value


def normalize(data: dict) -> dict:
    """decode -> normalize -> validate: validates `data` (already parsed by
    decode_bytes, or a legacy dict from anywhere) against the OHM JSON
    Schema, the structural graph rules, and the Pydantic model, without
    dropping or defaulting a single JSON-compatible field the caller
    provided. Raises CodecError with every diagnostic on the first failing
    stage instead of silently coercing or discarding incompatible data.
    Returns a value with deterministic key order at every level, ready for
    encode().
    """
    if not isinstance(data, dict):
        raise CodecError("document root must be a mapping")
    result = validate_dict(data)
    if not result.ok:
        raise CodecError("; ".join(result.errors))
    return _reorder(data, "bundle")


# ---------------------------------------------------------------------------
# encode(): canonical, deterministic YAML emission
# ---------------------------------------------------------------------------


def _prepare_scalar(value: str):
    if "\r" in value:
        # A literal block scalar is normalized to LF-only by the YAML spec
        # itself on decode, so any string containing CR cannot round-trip
        # through `|` -- fall back to a quoted scalar with explicit escapes
        # (P1 step 4: "usar aspas/escapes para CRLF e casos nao
        # representaveis fielmente em bloco").
        return DoubleQuotedScalarString(value)
    if "\n" in value:
        return LiteralScalarString(value)
    if _is_ambiguous_plain_string(value):
        return DoubleQuotedScalarString(value)
    return value


def _prepare_for_emit(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _prepare_for_emit(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_prepare_for_emit(v) for v in value]
    if isinstance(value, str):
        return _prepare_scalar(value)
    return value


def _new_emitter() -> YAML:
    yaml = YAML(typ="rt", pure=True)
    yaml.default_flow_style = False
    yaml.sort_base_mapping_type_on_output = False
    yaml.allow_unicode = True
    yaml.width = 2**31 - 1  # never soft-wrap a long scalar/line
    yaml.indent(mapping=2, sequence=4, offset=2)
    return yaml


def encode(normalized: dict) -> bytes:
    """Emit `normalized` (the output of normalize()) as canonical UTF-8 YAML:
    LF line breaks, 2-space indentation, the envelope's schema-declared key
    order, every other mapping alphabetically ordered, arrays in their
    original order, and exactly one trailing newline. No aliases are ever
    emitted (`_prepare_for_emit` always deep-copies into plain dict/list, so
    the rt representer has no repeated-object identity to alias)."""
    prepared = _prepare_for_emit(normalized)
    yaml = _new_emitter()
    buf = io.StringIO()
    yaml.dump(prepared, buf)
    text = buf.getvalue()
    if not text.endswith("\n"):
        text += "\n"
    return text.encode("utf-8")


# ---------------------------------------------------------------------------
# Convenience combinators
# ---------------------------------------------------------------------------


def load_bytes(raw: bytes, *, limits: ResourceLimits = DEFAULT_LIMITS) -> dict:
    """decode_bytes() + normalize() in one call."""
    return normalize(decode_bytes(raw, limits=limits))


def load_path(path: Path, *, limits: ResourceLimits = DEFAULT_LIMITS) -> dict:
    return load_bytes(Path(path).read_bytes(), limits=limits)


def dump_path(path: Path, normalized: dict) -> None:
    Path(path).write_bytes(encode(normalized))
