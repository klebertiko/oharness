"""Errors the Workspace Manager raises; the router maps each to an HTTP status and a stable ``code``."""
from __future__ import annotations

import re
import string

# An ABSOLUTE path in quotes ('C:/Users/a b/x', "/home/u/my dir"), then bare drive, UNC and POSIX absolute paths. A path component may
# hold single spaces (C:\Program Files\My App\ws); the last one ends at whitespace. Quoted refs ('feature/x') are not absolute: they stay.
#
# The drive and POSIX forms are walked by hand rather than matched by one regex: "a component, a separator", repeated, is the shape of a
# pattern that can backtrack badly. The walk reads each character a bounded number of times, so hostile text costs time proportional to its
# length. The regexes left are single character runs with no nested quantifier.
_QUOTED = re.compile(r"""(['"])(?:[A-Za-z]:[\\/]|[\\/])[^'"\r\n]*\1""")
_UNC = re.compile(r"\\\\[^\s'\"]+|(?<![\w./:-])//(?=[^\s/'\"])[^\s'\"]+")
_COMPONENT_RUN = re.compile(r"""[^\s'"\\/]*""")  # the characters of one path component: no whitespace, quote or separator
_SEPARATORS = "\\/"
_DRIVE_LETTERS = frozenset(string.ascii_letters)
_PLACEHOLDER = "<path>"


def _is_word_char(ch: str) -> bool:
    return ch.isalnum() or ch == "_"  # what the regex class \w means for str


def _component_end(text: str, pos: int) -> int:
    """End of the component run starting at ``pos`` (``pos`` itself when it starts with whitespace, a quote, a separator or the end)."""
    return _COMPONENT_RUN.match(text, pos).end()


def _path_end(text: str, pos: int, separators: str) -> int:
    """Where an absolute path whose prefix ends at ``pos`` ends: whole components (words joined by single spaces) for as long as a
    separator (``separators``) follows each, then a last component that stops at the first whitespace or separator."""
    size = len(text)
    while True:
        end = _component_end(text, pos)
        if end == pos:
            break  # no component here: nothing more to take
        while end + 1 < size and text[end] == " " and _component_end(text, end + 1) > end + 1:
            end = _component_end(text, end + 1)  # a single space joins the next word to this component
        if end < size and text[end] in separators:
            pos = end + 1
        else:
            break  # not followed by a separator: this is the last component, so only its first word counts
    return _component_end(text, pos)


def _scrub_drive(text: str) -> str:
    """Replace ``C:\\...`` and ``c:/...`` paths; a drive letter glued to a word (``xC:\\a``) is not a drive."""
    out: list[str] = []
    copied = i = 0
    size = len(text)
    while i + 2 < size:
        if text[i] in _DRIVE_LETTERS and text[i + 1] == ":" and text[i + 2] in _SEPARATORS and (i == 0 or not _is_word_char(text[i - 1])):
            out += (text[copied:i], _PLACEHOLDER)
            copied = i = _path_end(text, i + 3, _SEPARATORS)
        else:
            i += 1
    out.append(text[copied:])
    return "".join(out)


def _scrub_posix(text: str) -> str:
    """Replace ``/abs/paths``; a slash after a word character, ``.``, ``/``, ``:`` or ``-`` (``a/b``, ``./x``, ``refs/heads/x``) is no root."""
    out: list[str] = []
    copied = i = 0
    size = len(text)
    while i + 1 < size:
        after = text[i + 1]
        starts_path = text[i] == "/" and not after.isspace() and after not in "'\""
        if starts_path and (i == 0 or not (_is_word_char(text[i - 1]) or text[i - 1] in "./:-")):
            out += (text[copied:i], _PLACEHOLDER)
            copied = i = _path_end(text, i + 1, "/")
        else:
            i += 1
    out.append(text[copied:])
    return "".join(out)


def scrub_paths(text: str) -> str:
    """Replace filesystem paths in git's stderr with ``<path>`` so an error never tells a client where things live.

    Ref names such as ``refs/heads/x`` (and any quoted name that is not an absolute path) stay readable.
    """
    text = _QUOTED.sub(lambda m: f"{m.group(1)}{_PLACEHOLDER}{m.group(1)}", text)
    return _scrub_posix(_UNC.sub(_PLACEHOLDER, _scrub_drive(text)))


class WorkspaceError(Exception):
    """A refusal or failure with a machine-readable ``code`` the client can branch on."""

    def __init__(self, code: str, message: str, status: int = 400, **details):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, **self.details}
