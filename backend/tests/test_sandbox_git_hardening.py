r"""Hardening of the auto-approved git policy found by the review of #122/#125.

* a `.git` (or `info`/`refs`) that is a Windows junction is a redirect `os.path.islink` cannot see;
* `GIT_CONFIG_GLOBAL` is ignored below git 2.32, so the user's ~/.gitconfig would be read again: such a git asks;
* the operand and count-flag grammars end with `\Z`, not `$` (which also accepts a trailing newline);
* `info/attributes` is read like git does: only a leading space or tab is blank, so a line that starts with a
  non-breaking space is a pattern with attributes, not a comment.
"""
import shutil
import sys

import pytest

from sandbox import permission
from test_sandbox_git_config_allowlist import make_repo, verdict

pytestmark = pytest.mark.skipif(shutil.which('git') is None, reason='git is not installed')

junction = pytest.mark.skipif(sys.platform != 'win32', reason='NTFS junctions exist only on Windows')


def make_junction(link, target):
    import _winapi
    _winapi.CreateJunction(str(target), str(link))


@junction
def test_a_dot_git_that_is_a_junction_to_another_repo_asks(tmp_path):
    outer = make_repo(tmp_path, 'outer')
    ws = tmp_path / 'ws'
    ws.mkdir()
    make_junction(ws / '.git', outer / '.git')
    assert verdict(ws, 'git', 'show', 'HEAD:a.txt') == 'ask'
    assert verdict(ws, 'git', 'status') == 'ask'


@junction
@pytest.mark.parametrize('name', ['info', 'refs'])
def test_a_git_subdirectory_that_is_a_junction_asks(name, tmp_path):
    root = make_repo(tmp_path)
    other = tmp_path / 'elsewhere'
    other.mkdir()
    shutil.rmtree(root / '.git' / name)
    make_junction(root / '.git' / name, other)
    assert verdict(root, 'git', 'status') == 'ask'


def test_an_ordinary_repo_is_still_auto_approved(tmp_path):
    root = make_repo(tmp_path)
    assert verdict(root, 'git', 'status') == 'allow'


@pytest.mark.parametrize('version,expected', [((2, 31, 9), 'ask'), ((2, 30, 0), 'ask'), ((), 'ask'), ((2, 32, 0), 'allow'), ((2, 53, 0), 'allow')])
def test_a_git_that_ignores_git_config_global_asks(version, expected, tmp_path, monkeypatch):
    root = make_repo(tmp_path)
    monkeypatch.setattr(permission, '_git_version', lambda: version)
    assert verdict(root, 'git', 'status') == expected


def test_git_version_itself_needs_no_version_gate(tmp_path, monkeypatch):
    root = make_repo(tmp_path)
    monkeypatch.setattr(permission, '_git_version', lambda: ())
    assert verdict(root, 'git', '--version') == 'allow'


@pytest.mark.parametrize('argv', [('git', 'show', 'HEAD:a.txt\n'), ('git', 'log', '-5\n'), ('git', 'log', '--max-count=5\n'), ('git', 'log', '-n5\n')])
def test_a_trailing_newline_does_not_pass_the_operand_grammars(argv, tmp_path):
    root = make_repo(tmp_path)
    assert verdict(root, *argv[:-1], argv[-1].rstrip('\n')) == 'allow'
    assert verdict(root, *argv) == 'ask'


@pytest.mark.parametrize('text,expected', [
    ('# * filter=x\n', 'allow'), (' # * filter=x\n', 'allow'), ('\t# * diff=x\n', 'allow'),
    ('#\u00a0* filter=x\n', 'allow'),
    ('\u00a0# * filter=x\n', 'ask'), ('\u2003# * diff=x\n', 'ask'),
    ('# a comment\n\u00a0# * merge=x\n', 'ask'),
])
def test_only_a_leading_space_or_tab_makes_an_attributes_line_a_comment(text, expected, tmp_path):
    root = make_repo(tmp_path)
    (root / '.git' / 'info').mkdir(exist_ok=True)
    (root / '.git' / 'info' / 'attributes').write_bytes(text.encode('utf-8'))
    assert verdict(root, 'git', 'status') == expected
