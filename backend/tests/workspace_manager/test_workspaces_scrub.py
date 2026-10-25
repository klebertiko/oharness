"""scrub_paths: edge cases pinned from the behaviour the first (regex) version had, and a time bound on hostile input.

The expectations below were recorded from that version, so rewriting the scanner cannot silently change what a client sees.
"""
import time

import pytest

from workspaces.errors import scrub_paths

B = chr(92)  # one backslash, spelled out so no quoting layer can eat it

EDGE_CASES = [
    ("fatal: c:/Users/ana/repo not found", "fatal: <path> not found"),
    ("fatal: C:" + B + " is a drive", "fatal: <path> is a drive"),
    ("fatal: C: is not a path", "fatal: C: is not a path"),
    ("fatal: xC:" + B + "a" + B + "b stays", "fatal: xC:" + B + "a" + B + "b stays"),  # a word character before the drive letter: not a drive
    ("fatal: 1:" + B + "x and \u00e9:" + B + "y", "fatal: 1:" + B + "x and \u00e9:" + B + "y"),
    ("fatal: " + B + B + "server" + B + "share" + B + "dir" + B + "x failed", "fatal: <path> failed"),
    ("fatal: (/tmp/ws) failed", "fatal: (<path> failed"),
    ("fatal: path=/tmp/ws/sub, retry", "fatal: path=<path> retry"),
    ("fatal: a/b ./x ../y stay", "fatal: a/b ./x ../y stay"),
    ("fatal: // double", "fatal: <path>/ double"),
    ("fatal: / alone", "fatal: / alone"),
    ("fatal: /tmp/x.", "fatal: <path>"),
    ("fatal: /home/ana/my  projects/x", "fatal: <path>  projects/x"),  # only a single space joins words of one component
    ("fatal: /home/ana/my projects/x y", "fatal: <path> y"),
    ("fatal: /tmp/a\tb/c", "fatal: <path>\tb/c"),
    ("line one /tmp/a\nline two C:" + B + "x" + B + "y z\n", "line one <path>\nline two <path> z\n"),
    ("fatal: 'C:" + B + "Program Files" + B + "x' and '/opt/y z' gone", "fatal: '<path>' and '<path>' gone"),
    ("fatal: '/unterminated path", "fatal: '<path> path"),
    ("fatal: \"/mixed quote'", "fatal: \"<path> quote'"),
    ("fatal: '/a'/b", "fatal: '<path>'<path>"),
    ("fatal: refs/heads/x:/tmp/a", "fatal: refs/heads/<path>"),
    ("fatal: C:/a b/ c", "fatal: <path> c"),
    ("fatal: /a b/ c", "fatal: <path> c"),
    ("fatal: 'x'/y '/z'", "fatal: 'x'<path>'<path>'"),
    ("fatal: /tmp/caf\u00e9 bar/x", "fatal: <path>"),
    ("", ""),
]


@pytest.mark.parametrize("raw,expected", EDGE_CASES)
def test_scrub_paths_edge_cases(raw, expected):
    assert scrub_paths(raw) == expected


def test_scrub_paths_is_idempotent_on_its_own_output():
    for raw, _ in EDGE_CASES:
        once = scrub_paths(raw)
        assert scrub_paths(once) == once


HOSTILE = 100_000
HOSTILE_INPUTS = {
    "posix words, no slash": "/" + "a " * (HOSTILE // 2),
    "posix long component": "/" + "a" * HOSTILE,
    "posix words with slash": "/" + "ab " * (HOSTILE // 3) + "/",
    "posix many components": "/" + "a/" * (HOSTILE // 2) + " end",
    "posix repeated starts": " /a" * (HOSTILE // 3),
    "posix slashes": "/" * HOSTILE,
    "drive words, no slash": "C:" + B + "a " * (HOSTILE // 2),
    "drive words, trailing slash": "C:/" + "ab " * (HOSTILE // 3) + "/",
    "drive repeated starts": ("C:" + B + "a ") * (HOSTILE // 5),
    "drive many components": "C:" + B + ("a" + B) * (HOSTILE // 2) + " end",
    "unc backslashes": B * HOSTILE,
    "unc long": B + B + "s" * HOSTILE,
    "quoted, never closed": "'/" + "a " * (HOSTILE // 2),
    "quotes alternating": "'/a\"/a" * (HOSTILE // 6),
    "quotes only": "'" * HOSTILE,
    "spaces": " " * HOSTILE,
    "mixed": ("fatal: '/a b' C:" + B + "x y " + B + B + "h /z ") * (HOSTILE // 24),
}


@pytest.mark.parametrize("name", list(HOSTILE_INPUTS))
def test_scrub_paths_stays_linear_on_hostile_input(name):
    text = HOSTILE_INPUTS[name]
    started = time.perf_counter()
    result = scrub_paths(text)
    elapsed = time.perf_counter() - started
    assert isinstance(result, str)
    assert elapsed < 0.5, f"{name}: {elapsed:.3f}s for {len(text)} characters"
