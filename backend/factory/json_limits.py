"""Limits on a JSON value a Forja route accepts: how deep it nests and how many bytes it takes.

The depth is walked without recursion and checked before anything serializes or walks the value recursively, so a deeply nested
body is refused with a 422 instead of exhausting the stack further down.
"""
from __future__ import annotations

import json

from factory import definition_rules as rules


def depth(value) -> int:
    """How deep the mapping nests, walked without recursion; stops counting once past the limit."""
    deepest, stack = 0, [(value, 1)]
    while stack:
        node, level = stack.pop()
        deepest = max(deepest, level)
        if level > rules.MAX_YAML_DEPTH:
            return level
        children = node.values() if isinstance(node, dict) else node if isinstance(node, list) else ()
        stack.extend((child, level + 1) for child in children if isinstance(child, (dict, list)))
    return deepest


def bounded(value, max_bytes: int, what: str = 'the value'):
    """`value` when it nests at most `MAX_YAML_DEPTH` levels and takes at most `max_bytes`; a ValueError (422) otherwise."""
    if value is None:
        return value
    if depth(value) > rules.MAX_YAML_DEPTH:
        raise ValueError(f'{what} nests deeper than {rules.MAX_YAML_DEPTH} levels')
    if len(json.dumps(value)) > max_bytes:
        raise ValueError(f'{what} holds at most {max_bytes} bytes')
    return value
