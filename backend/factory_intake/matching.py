"""Filter matching for automations (ADR 0062). Every filter key must match; a list matches if ANY of its values does; ``not_in`` excludes.

Payload patterns mirror the delivery body: a key names a field, an array lists allowed values, an object with only ``in``/``not_in``/
``exists`` is an operator, any other object is a nested pattern. Strings compare exactly (case-sensitive), numbers numerically (``1`` equals
``1.0``, but ``true`` is not ``1``). A missing key fails ``in`` and passes ``not_in``; a nested pattern requires its key; against an array
of objects a nested pattern matches if any element does. Patterns are size- and depth-limited.
"""
from __future__ import annotations

MAX_DEPTH, MAX_NODES = 8, 200
_OPERATORS = {"in", "not_in", "exists"}


class PatternError(ValueError):
    pass


def _same(a, b) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    return type(a) is type(b) and a == b


def _any_equal(value, allowed: list) -> bool:
    """True when ``value`` (or, for an array, any element) equals any allowed value."""
    candidates = value if isinstance(value, list) else [value]
    return any(_same(c, a) for c in candidates for a in allowed)


def check_pattern(pattern, depth: int = 0, counter: list | None = None) -> None:
    """Reject patterns that are malformed or too big before they are stored."""
    counter = counter if counter is not None else [0]
    counter[0] += 1
    if depth > MAX_DEPTH or counter[0] > MAX_NODES:
        raise PatternError("payload filter is too large or too deep")
    if not isinstance(pattern, dict):
        raise PatternError("payload filter must be an object")
    for key, sub in pattern.items():
        if not isinstance(key, str):
            raise PatternError("payload filter keys must be strings")
        if isinstance(sub, dict):
            if sub and set(sub) <= _OPERATORS:
                for op in ("in", "not_in"):
                    if op in sub and not isinstance(sub[op], list):
                        raise PatternError(f"{op} takes a list")
                if "exists" in sub and not isinstance(sub["exists"], bool):
                    raise PatternError("exists takes true or false")
            else:
                check_pattern(sub, depth + 1, counter)
        elif not isinstance(sub, (list, str, int, float, bool, type(None))):
            raise PatternError("unsupported value in payload filter")


def match_payload(pattern: dict, payload, depth: int = 0) -> bool:
    if isinstance(payload, list):  # an array of objects: the pattern matches if any element does
        return any(match_payload(pattern, element, depth) for element in payload if isinstance(element, dict))
    if not isinstance(payload, dict) or depth > MAX_DEPTH:
        return False
    for key, sub in pattern.items():
        present, value = key in payload, payload.get(key)
        if isinstance(sub, dict) and sub and set(sub) <= _OPERATORS:
            if "exists" in sub and sub["exists"] != present:
                return False
            if "in" in sub and not (present and _any_equal(value, sub["in"])):
                return False
            if "not_in" in sub and present and _any_equal(value, sub["not_in"]):
                return False
        elif isinstance(sub, dict):
            if not present or not match_payload(sub, value, depth + 1):
                return False
        elif isinstance(sub, list):
            if not (present and _any_equal(value, sub)):
                return False
        elif not (present and _same(value, sub)):
            return False
    return True


def match_field(rule, value) -> bool:
    """A provider filter value: a list (any of), an operator object, or a scalar, against a field that may itself be a list (labels)."""
    if isinstance(rule, dict):
        if "in" in rule and not _any_equal(value, rule["in"]):
            return False
        if "not_in" in rule and value is not None and _any_equal(value, rule["not_in"]):
            return False
        return True
    if isinstance(rule, list):
        return not rule or _any_equal(value, rule)  # an empty list does not restrict
    return _same(value, rule)
