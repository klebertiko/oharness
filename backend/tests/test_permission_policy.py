"""Pure policy seam for the chat permission mode: decide(mode, call, workspace, trusted)."""
import os
import re
import shutil
import subprocess
import sys

import pytest

from sandbox.permission import MODES, decide, effective_mode, hardened_git
from sandbox.schemas import Discover, Exec, Read

SAFE_GIT_CONFIG = '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://example.com/x.git\n[branch "main"]\n\tremote = origin\n'


def ex(*argv, cwd='.'):
    return Exec(argv=list(argv), cwd=cwd)


@pytest.fixture()
def ws(tmp_path):
    (tmp_path / 'sub').mkdir()
    (tmp_path / 'notes.txt').write_text('x', encoding='utf-8')
    (tmp_path / '.git').mkdir()
    (tmp_path / '.git' / 'config').write_text(SAFE_GIT_CONFIG, encoding='utf-8')
    return tmp_path


def auto(call, workspace, trusted=False):
    return decide('auto_workspace', call, workspace, trusted=trusted)


def link_dir_or_skip(link, target):
    """Directory symlink; on Windows without symlink rights, fall back to a junction (same resolve() semantics)."""
    try:
        os.symlink(target, link, target_is_directory=True)
        return
    except (OSError, NotImplementedError):
        pass
    if os.name == 'nt':
        done = subprocess.run(['cmd', '/c', 'mklink', '/J', str(link), str(target)], capture_output=True)
        if done.returncode == 0:
            return
    pytest.skip('neither symlinks nor junctions are available on this machine')


# -- modes other than auto_workspace ----------------------------------------
def test_modes_are_exactly_the_three_and_there_is_no_bypass():
    assert MODES == ('plan', 'ask', 'auto_workspace')


def test_ask_mode_asks_for_every_exec(ws):
    assert decide('ask', ex('git', 'status'), ws) == 'ask'
    assert decide('ask', ex('pytest'), ws, trusted=True) == 'ask'


def test_plan_mode_denies_exec_even_without_workspace(ws):
    assert decide('plan', ex('git', 'status'), ws) == 'deny'
    assert decide('plan', ex('git', 'status'), None) == 'deny'


@pytest.mark.parametrize('mode', ['plan', 'ask', 'auto_workspace'])
def test_read_only_tools_are_not_gated_by_the_mode(mode, ws):
    assert decide(mode, Read(path='notes.txt'), ws) == 'allow'
    assert decide(mode, Discover(), ws) == 'allow'


@pytest.mark.parametrize('mode', [None, '', 'bypass', 'AUTO_WORKSPACE', 'auto', 'yolo', 7, ['plan']])
def test_unknown_mode_falls_back_to_ask(mode, ws):
    assert decide(mode, ex('git', 'status'), ws, trusted=True) == 'ask'


# -- auto_workspace, untrusted workspace: only read-only git and listings ----
@pytest.mark.parametrize('argv', [('git', 'status'), ('git', 'status', '--porcelain', '-b'), ('git', 'diff', '--stat'), ('git', 'diff', 'HEAD~1', '--', 'notes.txt'),
                                  ('git', 'log', '--oneline', '-5'), ('git', 'log', 'main..feature'), ('git', 'show', 'HEAD'),
                                  ('git', 'rev-parse', '--show-toplevel'), ('git', 'ls-files'), ('git', '--version'),
                                  ('ls',), ('ls', 'sub'), ('ls', '-la'), ('pwd',)])
def test_auto_allows_read_only_commands_in_an_untrusted_workspace(argv, ws):
    assert auto(ex(*argv), ws) == 'allow'


def test_auto_allows_a_cwd_that_is_a_subdirectory(ws):
    assert auto(ex('ls', cwd='sub'), ws) == 'allow'


def test_auto_without_workspace_asks():
    assert auto(ex('git', 'status'), None) == 'ask'


def test_auto_with_missing_workspace_directory_asks(tmp_path):
    assert auto(ex('git', 'status'), tmp_path / 'gone') == 'ask'


@pytest.mark.parametrize('cwd', ['..', '../sibling', 'sub/../..', 'C:/', 'C:\\Windows', '/etc', '\\\\host\\share', 'nope', 'notes.txt'])
def test_auto_asks_when_cwd_leaves_or_misses_the_workspace(cwd, ws):
    assert auto(ex('ls', cwd=cwd), ws) == 'ask'


def test_auto_asks_when_cwd_is_a_symlink_out_of_the_workspace(ws, tmp_path_factory):
    outside = tmp_path_factory.mktemp('outside')
    link_dir_or_skip(ws / 'escape', outside)
    assert auto(ex('ls', cwd='escape'), ws) == 'ask'


@pytest.mark.parametrize('arg', ['../secret', 'sub/../../secret', '..', '..\\secret', '--out=../x', '--file=sub/../../x',
                                 '/etc/passwd', 'C:\\Users\\x', 'c:/x', '\\\\host\\share\\f', '~/.ssh/id_rsa', '~',
                                 'file:///etc/passwd', 'https://example.com/x',
                                 # a value glued to a flag, a doubled '=' and mixed separators
                                 '-o../x', '-la../x', '-o/etc/x', '--a=b=../x', '--a=b=/etc/x', 'a=..\\x', 'x:../y'])
def test_auto_asks_when_an_argument_escapes_the_workspace_or_reaches_the_network(arg, ws):
    assert auto(ex('ls', arg), ws) == 'ask'
    assert auto(ex('git', 'diff', arg), ws) == 'ask'


def test_auto_asks_when_an_argument_is_a_symlink_out_of_the_workspace(ws, tmp_path_factory):
    outside = tmp_path_factory.mktemp('outside2')
    (outside / 'secret.txt').write_text('s', encoding='utf-8')
    link_dir_or_skip(ws / 'linked', outside)
    assert auto(ex('ls', 'linked/secret.txt'), ws) == 'ask'


# -- git: read-only subcommands only; nothing that can start another program --
@pytest.mark.parametrize('argv', [
    ('git', 'grep', 'needle'), ('git', 'grep', '-Ovim', 'x'), ('git', 'grep', '-O', 'sh', 'x'), ('git', 'grep', '--open-files-in-pager=sh', 'x'),
    ('git', 'blame', 'notes.txt'), ('git',), ('git', 'push'), ('git', 'clone', 'x'), ('git', 'fetch'), ('git', 'reset', '--hard'),
    ('git', 'checkout', 'x'), ('git', 'config', 'core.pager', 'sh'), ('git', 'branch', '-D', 'x'), ('git', 'stash'),
    ('git', '-c', 'core.pager=x', 'log'), ('git', '--exec-path=x', 'log'), ('git', '-C', '..', 'log'),
    ('git', 'diff', '--output=x'), ('git', 'diff', '--ext-diff'), ('git', 'log', '--textconv'), ('git', 'diff', '--no-index', 'a', 'b'),
    ('git', 'log', '--format=%H', '-p'), ('git', 'show', '--pretty=x'), ('git', 'status', '--ignore-submodules=x'),
    ('git', 'diff', '-O', 'orderfile'), ('git', 'diff', '--upload-pack=x'),
])
def test_auto_asks_for_git_that_can_run_other_programs_or_write(argv, ws):
    assert auto(ex(*argv), ws, trusted=True) == 'ask'


@pytest.mark.parametrize('config', [
    '[filter "lfs"]\n\tclean = sh -c x\n', '[diff "x"]\n\ttextconv = sh\n', '[diff]\n\texternal = sh\n', '[core]\n\tfsmonitor = sh\n',
    '[core]\n\thooksPath = ../hooks\n', '[core]\n\tpager = sh\n', '[include]\n\tpath = ../evil\n', '[includeIf "gitdir:/"]\n\tpath = x\n',
    '[merge "x"]\n\tdriver = sh\n', '[core]\n\tsshCommand = sh\n', '[credential]\n\thelper = sh\n',
])
def test_auto_asks_for_git_when_the_repo_config_can_execute_programs(config, ws):
    (ws / '.git' / 'config').write_text(SAFE_GIT_CONFIG + config, encoding='utf-8')
    assert auto(ex('git', 'status'), ws, trusted=True) == 'ask'


def test_auto_asks_for_git_without_a_repo_config_at_the_workspace_root(tmp_path):
    assert auto(ex('git', 'status'), tmp_path) == 'ask'


def test_auto_asks_for_git_when_dot_git_is_a_file(tmp_path):
    (tmp_path / '.git').write_text('gitdir: ../elsewhere', encoding='utf-8')
    assert auto(ex('git', 'status'), tmp_path) == 'ask'


# -- workspace trust: repo-defined code runs unprompted only when trusted ----
@pytest.mark.parametrize('argv', [('npm', 'test'), ('npm', 'run', 'lint'), ('npm', 'run-script', 'build'), ('pnpm', 'test'), ('pnpm', 'run', 'x'),
                                  ('yarn', 'test'), ('yarn', 'run', 'build:prod'), ('pytest',), ('pytest', '-q'), ('pytest', '-q', '-x', 'tests/test_a.py::test_b')])
def test_project_scripts_ask_until_the_workspace_is_trusted(argv, ws):
    assert auto(ex(*argv), ws, trusted=False) == 'ask'
    assert auto(ex(*argv), ws, trusted=True) == 'allow'


@pytest.mark.parametrize('argv', [
    ('npm', 'test', '--script-shell=bash'), ('npm', 'test', '--node-options=--require=x'), ('npm', 'test', '--'), ('npm', 'test', 'x'),
    ('npm', 'run', 'lint', '--', '--fix'), ('npm', 'run', 'lint', '--script-shell=sh'), ('npm', 'run', '--script-shell=sh', 'lint'),
    ('npm', 'run'), ('npm', 'run', '-x'), ('npm', 'run', 'a', 'b'), ('npm', 'run', '../x'), ('npm', 'run', 'a;b'),
    ('pnpm', 'test', '--x'), ('yarn', 'test', 'x'), ('npm', '--version', 'x'), ('npm', 'ls'), ('npm', 'exec', 'x'),
    ('npm', 'install'), ('npm', 'i', 'left-pad'), ('npm', 'publish'), ('npm',), ('pnpm', 'dlx', 'x'), ('yarn', 'add', 'x'), ('yarn',),
    ('pytest', '-p', 'evil'), ('pytest', '-c', 'x.ini'), ('pytest', '--rootdir=/x'), ('pytest', '--basetemp=../x'), ('pytest', '--pyargs', 'os'),
    ('pytest', '-o', 'x=y'), ('pytest', '-qp', 'evil'), ('pytest', '--import-mode=x'), ('pytest', '--confcutdir=..'),
])
def test_project_scripts_never_take_flags_or_extra_arguments(argv, ws):
    assert auto(ex(*argv), ws, trusted=True) == 'ask'


# -- explicit program allowlist: anything else asks, trusted or not ----------
@pytest.mark.parametrize('program', [
    'wmic', 'msbuild', 'pcalua', 'explorer', 'schtasks', 'forfiles', 'cscript', 'regsvr32', 'installutil', 'cmstp', 'bash', 'sh', 'zsh', 'cmd',
    'cmd.exe', 'CMD.EXE', 'powershell', 'powershell.exe', 'pwsh', 'wsl', 'python', 'python3', 'python3.12', 'py', 'pythonw.exe', 'node', 'node.exe',
    'deno', 'bun', 'ruby', 'perl', 'php', 'osascript', 'env', 'sudo', 'xargs', 'nohup', 'start', 'find', 'make', 'tsc', 'cargo', 'go', 'pip', 'uv',
    'cat', 'head', 'tail', 'type', 'echo', 'rm', 'rmdir', 'del', 'format', 'dd', 'chmod', 'icacls', 'reg', 'taskkill', 'kill', 'shutdown', 'mv',
    'curl', 'wget', 'iwr', 'ssh', 'scp', 'nc', 'certutil', 'npx', 'pnpx', 'bunx', 'docker', 'gh', 'az', 'code', 'cursor', 'vim', 'unknown-tool',
    sys.executable,
])
def test_auto_asks_for_every_program_that_is_not_on_the_allowlist(program, ws):
    assert auto(ex(program, 'notes.txt'), ws, trusted=False) == 'ask'
    assert auto(ex(program, 'notes.txt'), ws, trusted=True) == 'ask'


@pytest.mark.parametrize('program', ['./run.sh', 'bin/tool', '.\\tool.exe', 'sub/pytest', '../pytest', '/usr/bin/git', 'C:\\Git\\git.exe', '~/git'])
def test_auto_requires_a_bare_program_name(program, ws):
    assert auto(ex(program, 'status'), ws, trusted=True) == 'ask'


@pytest.mark.parametrize('planted', ['git.exe', 'git.cmd', 'git.bat', 'git', 'GIT.EXE'])
def test_auto_asks_when_the_workspace_can_shadow_the_program(planted, ws):
    # shutil.which() on Windows looks in the current directory first.
    (ws / planted).write_text('', encoding='utf-8')
    assert auto(ex('git', 'status'), ws) == 'ask'


# -- git config reached by other paths than .git/config (#112) ------------------
FILTER_CONFIG = '[core]\n\trepositoryformatversion = 0\n[filter "x"]\n\tclean = sh -c evil\n\tsmudge = sh -c evil\n'


def test_auto_asks_when_commondir_points_to_an_external_config_with_a_filter(ws, tmp_path_factory):
    common = tmp_path_factory.mktemp('common')
    (common / 'config').write_text(FILTER_CONFIG, encoding='utf-8')
    (ws / '.git' / 'commondir').write_text(str(common), encoding='utf-8')
    assert auto(ex('git', 'status'), ws, trusted=True) == 'ask'


@pytest.mark.parametrize('target', ['.', '../sibling', 'objects'])
def test_auto_asks_for_any_commondir_even_a_relative_one_inside_the_repo(ws, target):
    (ws / '.git' / 'commondir').write_text(target, encoding='utf-8')
    assert auto(ex('git', 'status'), ws, trusted=True) == 'ask'


def test_auto_asks_when_config_worktree_defines_a_filter(ws):
    (ws / '.git' / 'config').write_text(SAFE_GIT_CONFIG + '[extensions]\n\tworktreeConfig = true\n', encoding='utf-8')
    (ws / '.git' / 'config.worktree').write_text(FILTER_CONFIG, encoding='utf-8')
    assert auto(ex('git', 'status'), ws, trusted=True) == 'ask'


def test_auto_asks_for_any_config_worktree_even_without_the_extension(ws):
    (ws / '.git' / 'config.worktree').write_text('', encoding='utf-8')
    assert auto(ex('git', 'status'), ws, trusted=True) == 'ask'


def test_auto_asks_when_dot_git_holds_a_gitdir_pointer(ws):
    (ws / '.git' / 'gitdir').write_text(str(ws / 'elsewhere'), encoding='utf-8')
    assert auto(ex('git', 'status'), ws, trusted=True) == 'ask'


@pytest.mark.parametrize('rule', ['* filter=x', '*.txt diff=x', '*.txt merge=x', '*.TXT   filter=lfs -text', '[attr]foo filter=x', '* text eol=lf filter=x'])
def test_auto_asks_when_info_attributes_activates_a_driver(ws, rule):
    (ws / '.git' / 'info').mkdir()
    (ws / '.git' / 'info' / 'attributes').write_text(rule + '\n', encoding='utf-8')
    assert auto(ex('git', 'status'), ws, trusted=True) == 'ask'


def test_auto_asks_when_info_attributes_is_not_a_plain_file(ws, tmp_path_factory):
    outside = tmp_path_factory.mktemp('attr') / 'attributes'
    outside.write_text('', encoding='utf-8')
    (ws / '.git' / 'info').mkdir()
    try:
        os.symlink(outside, ws / '.git' / 'info' / 'attributes')
    except (OSError, NotImplementedError):
        pytest.skip('file symlinks are not available on this machine')
    assert auto(ex('git', 'status'), ws, trusted=True) == 'ask'


def test_auto_asks_when_dot_git_is_a_file_with_a_gitdir_pointer_to_a_real_repo(tmp_path, tmp_path_factory):
    real = tmp_path_factory.mktemp('real')
    (real / 'config').write_text(SAFE_GIT_CONFIG, encoding='utf-8')
    (tmp_path / '.git').write_text(f'gitdir: {real}\n', encoding='utf-8')
    assert auto(ex('git', 'status'), tmp_path, trusted=True) == 'ask'


def test_auto_still_allows_plain_info_attributes_and_a_normal_repo(ws):
    (ws / '.git' / 'info').mkdir()
    (ws / '.git' / 'info' / 'attributes').write_text('# comment\n*.bin binary\n*.txt text eol=lf\n', encoding='utf-8')
    assert auto(ex('git', 'status'), ws, trusted=True) == 'allow'


def test_hardened_git_pins_the_git_directories_to_the_workspace(tmp_path):
    _, env = hardened_git(['git', 'status'], tmp_path)
    root = str(tmp_path.resolve())
    git_dir = os.path.join(root, '.git')
    assert env['GIT_DIR'] == git_dir and env['GIT_COMMON_DIR'] == git_dir
    assert env['GIT_WORK_TREE'] == root


# -- the config is parsed by git itself, not line by line (#112 SEC findings) ------
real_git = pytest.mark.skipif(shutil.which('git') is None, reason='git is not installed')
EVIL_CMD = 'echo pwned >> {marker}; cat'


def _hostile_repo(tmp_path, name, config_text, extra=None):
    """A real repo whose versioned .gitattributes binds `*` to filter x and whose .git/config is `config_text`."""
    repo = tmp_path / name
    repo.mkdir()
    subprocess.run(['git', 'init', '-q', str(repo)], check=True)
    (repo / 'a.txt').write_text('one\n', encoding='utf-8')
    subprocess.run(['git', '-C', str(repo), 'add', 'a.txt'], check=True)
    (repo / 'a.txt').write_text('two changed\n', encoding='utf-8')
    (repo / '.gitattributes').write_text('* filter=x\n', encoding='utf-8')
    marker = (tmp_path / (name + '.MARKER')).as_posix()
    with open(repo / '.git' / 'config', 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(config_text.replace('MARK', marker))
    for rel, text in (extra or {}).items():
        (repo / '.git' / rel).write_text(text.replace('MARK', marker), encoding='utf-8')
    return repo, marker


def _run_hardened(repo, argv):
    cmd, env = hardened_git(argv, repo)
    base = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit
    return subprocess.run(cmd, cwd=repo, env={**base, **env}, capture_output=True, text=True)  # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-subprocess-use-audit


_BASE_CFG = '[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n'
_EVIL = EVIL_CMD.format(marker='MARK')
HOSTILE_CONFIGS = {
    'two_headers_one_line': _BASE_CFG + f'[core][filter "x"]clean = {_EVIL}\n',
    'bom_first_line': '﻿' + f'[filter "x"]clean = {_EVIL}\n' + _BASE_CFG,
    'include_same_line': _BASE_CFG + '[core][include]path = evil.cfg\n',
}
HOSTILE_EXTRA = {'include_same_line': {'evil.cfg': f'[filter "x"]\n\tclean = {_EVIL}\n'}}


@real_git
@pytest.mark.parametrize('name', sorted(HOSTILE_CONFIGS))
def test_auto_asks_for_configs_that_the_line_parser_misreads(name, tmp_path):
    repo, _ = _hostile_repo(tmp_path, name, HOSTILE_CONFIGS[name], HOSTILE_EXTRA.get(name))
    assert auto(ex('git', 'diff'), repo) == 'ask'
    assert auto(ex('git', 'status'), repo, trusted=True) == 'ask'


@real_git
@pytest.mark.parametrize('name', sorted(HOSTILE_CONFIGS))
def test_hardened_git_does_not_run_a_filter_even_if_the_policy_were_bypassed(name, tmp_path):
    repo, marker = _hostile_repo(tmp_path, name, HOSTILE_CONFIGS[name], HOSTILE_EXTRA.get(name))
    version = subprocess.run(['git', '--version'], capture_output=True, text=True).stdout
    numbers = [int(n) for n in re.findall(r'\d+', version)[:2]]
    if numbers < [2, 42]:
        pytest.skip('GIT_ATTR_SOURCE needs git 2.42 or newer')
    _run_hardened(repo, ['git', 'diff'])
    assert not os.path.exists(marker)


@real_git
def test_auto_still_allows_a_repo_created_by_git_init(tmp_path):
    repo = tmp_path / 'clean'
    repo.mkdir()
    subprocess.run(['git', 'init', '-q', str(repo)], check=True)
    assert auto(ex('git', 'status'), repo) == 'allow'


@pytest.mark.parametrize('config', [
    '[core]\n\tfsmonitor = true\n', '[Core]\n\tPager = sh\n', '[core "sub"]\n\tx = y\n', '[extensions]\n\tworktreeConfig = true\n',
    '[core]\n\tsomethingnew = 1\n', '[alias]\n\tst = !sh\n', '[url "x"]\n\tinsteadOf = y\n', '[core]\n\tattributesFile = x\n',
    '[include]\n\tpath = x\n', '[includeIf "gitdir:/"]\n\tpath = x\n', '[core]\n  bare = false\n  [filter "x"] clean = sh\n',
])
@real_git
def test_auto_asks_for_any_config_key_outside_the_allowlist(config, ws):
    (ws / '.git' / 'config').write_text(SAFE_GIT_CONFIG + config, encoding='utf-8')
    assert auto(ex('git', 'status'), ws, trusted=True) == 'ask'


@real_git
def test_auto_asks_when_the_config_is_not_parseable_by_git(ws):
    (ws / '.git' / 'config').write_text('[core\n\tbare = false\n', encoding='utf-8')
    assert auto(ex('git', 'status'), ws, trusted=True) == 'ask'


def test_auto_asks_when_objects_use_alternates(ws):
    (ws / '.git' / 'objects' / 'info').mkdir(parents=True)
    (ws / '.git' / 'objects' / 'info' / 'alternates').write_text(str(ws.parent), encoding='utf-8')
    assert auto(ex('git', 'status'), ws, trusted=True) == 'ask'


def test_auto_asks_when_objects_is_a_link(ws, tmp_path_factory):
    outside = tmp_path_factory.mktemp('objects')
    link_dir_or_skip(ws / '.git' / 'objects', outside)
    assert auto(ex('git', 'status'), ws, trusted=True) == 'ask'


def test_hardened_git_ignores_working_tree_attributes(tmp_path):
    _, env = hardened_git(['git', 'status'], tmp_path)
    assert env['GIT_ATTR_SOURCE'] == '4b825dc642cb6eb9a060e54bf8d69288fbee4904'


def test_auto_asks_when_the_cwd_can_shadow_the_program(ws):
    (ws / 'sub' / 'pytest.cmd').write_text('', encoding='utf-8')
    assert auto(ex('pytest', cwd='sub'), ws, trusted=True) == 'ask'


# -- hardened git: the neutral configuration the broker runs auto git with ---
def test_hardened_git_disables_repo_controlled_execution(tmp_path):
    argv, env = hardened_git(['git', 'diff', '--stat', 'a.txt'], tmp_path)
    assert argv[0] == 'git'
    pairs = {argv[i + 1] for i, token in enumerate(argv) if token == '-c'}
    assert {'core.fsmonitor=', 'core.pager=cat', 'diff.external=', f'core.hooksPath={os.devnull}'} <= pairs
    assert '--no-pager' in argv and '--no-optional-locks' in argv
    sub = argv.index('diff')
    assert argv.index('--no-ext-diff') > sub and argv.index('--no-textconv') > sub
    assert argv[-2:] == ['--stat', 'a.txt'] and argv.index('--no-textconv') < argv.index('--stat')
    assert env['GIT_CONFIG_NOSYSTEM'] == '1' and env['GIT_CONFIG_GLOBAL'] == os.devnull
    assert env['GIT_PAGER'] == 'cat' and env['GIT_TERMINAL_PROMPT'] == '0' and env['GIT_OPTIONAL_LOCKS'] == '0'
    assert env['GIT_CEILING_DIRECTORIES'] == str(tmp_path.resolve().parent)
    assert 'GIT_EXTERNAL_DIFF' not in env  # the run's environment is scrubbed; nothing inherited reaches git


@pytest.mark.parametrize('sub,diffy', [('status', False), ('rev-parse', False), ('ls-files', False), ('log', True), ('show', True), ('diff', True)])
def test_hardened_git_only_adds_diff_flags_where_the_subcommand_accepts_them(sub, diffy, tmp_path):
    argv, _ = hardened_git(['git', sub], tmp_path)
    assert ('--no-ext-diff' in argv) is diffy and ('--no-textconv' in argv) is diffy


def test_hardened_git_leaves_other_programs_alone(tmp_path):
    assert hardened_git(['ls', '-la'], tmp_path) == (['ls', '-la'], {})


# -- effective mode: a request can only tighten the stored mode ---------------
@pytest.mark.parametrize('stored,requested,expected', [
    ('ask', 'auto_workspace', 'ask'), ('plan', 'auto_workspace', 'plan'), ('plan', 'ask', 'plan'),
    ('auto_workspace', 'ask', 'ask'), ('auto_workspace', 'plan', 'plan'), ('auto_workspace', None, 'auto_workspace'),
    ('auto_workspace', 'auto_workspace', 'auto_workspace'), (None, 'auto_workspace', 'ask'), (None, None, 'ask'),
    ('bypass', 'auto_workspace', 'ask'), ('auto_workspace', 'bypass', 'ask'), ('', 'plan', 'plan'),
])
def test_effective_mode_is_never_laxer_than_stored_or_requested(stored, requested, expected):
    assert effective_mode(stored, requested) == expected


# -- SEC round-2 regression: package-manager `--version` bypasses trust -------
def test_yarn_version_in_untrusted_workspace_must_ask_when_yarnrc_present(ws):
    """Yarn Berry's global shim re-executes the JS named by `yarnPath` in a
    workspace `.yarnrc.yml` for EVERY subcommand, including `--version`.
    `_package_manager_ok` allows `['--version']` regardless of `trusted`, so an
    untrusted repo gets no-prompt code execution. This must be `ask`, not `allow`."""
    (ws / '.yarnrc.yml').write_text('yarnPath: ./.evil.cjs\n', encoding='utf-8')
    (ws / '.evil.cjs').write_text('// repo-controlled code yarn would run\n', encoding='utf-8')
    assert auto(ex('yarn', '--version'), ws, trusted=False) == 'ask'


@pytest.mark.parametrize('argv', [('npm', '--version'), ('npm', '-v'), ('pnpm', '--version'), ('pnpm', '-v'), ('yarn', '--version'), ('yarn', '-v')])
def test_every_package_manager_invocation_needs_trust_even_for_version(argv, ws):
    # npm/pnpm/yarn shims read repo-controlled files (.yarnrc.yml yarnPath, .npmrc...) before any subcommand.
    assert auto(ex(*argv), ws, trusted=False) == 'ask'
    assert auto(ex(*argv), ws, trusted=True) == 'allow'


@pytest.mark.parametrize('where,name', [('.', '.yarnrc.yml'), ('.', '.yarnrc'), ('.', '.YARNRC.YML'), ('sub', '.yarnrc.yml'), ('sub', '.yarnrc')])
@pytest.mark.parametrize('argv', [('yarn', 'test'), ('yarn', 'run', 'build'), ('yarn', '--version')])
def test_yarn_asks_even_in_a_trusted_workspace_when_a_yarnrc_can_redirect_the_binary(where, name, argv, ws):
    (ws / where / name).write_text('yarnPath: ./.evil.cjs', encoding='utf-8')
    cwd = 'sub' if where == 'sub' else '.'
    assert auto(ex(*argv, cwd=cwd), ws, trusted=True) == 'ask'


def test_a_yarnrc_does_not_affect_other_programs(ws):
    (ws / '.yarnrc.yml').write_text('yarnPath: ./.evil.cjs', encoding='utf-8')
    assert auto(ex('npm', 'test'), ws, trusted=True) == 'allow'
    assert auto(ex('git', 'status'), ws) == 'allow'


@pytest.mark.parametrize('name', ['.yarnrc.yml', '.yarnrc'])
@pytest.mark.parametrize('argv', [('yarn', 'test'), ('yarn', '--version')])
def test_yarn_asks_when_a_yarnrc_sits_in_any_directory_between_cwd_and_the_root(name, argv, ws):
    # Yarn searches upward from the cwd, so a rc in an intermediate directory counts too.
    (ws / 'a' / 'b').mkdir(parents=True)
    (ws / 'a' / name).write_text('yarnPath: ./.evil.cjs', encoding='utf-8')
    assert auto(ex(*argv, cwd='a/b'), ws, trusted=True) == 'ask'
    assert auto(ex('npm', 'test', cwd='a/b'), ws, trusted=True) == 'allow'


# -- the policy never touches the disk outside the workspace (CodeQL py/path-injection) ------------------
def test_decide_never_stats_lists_or_opens_a_path_outside_the_workspace(ws, tmp_path_factory, monkeypatch):
    outside = tmp_path_factory.mktemp('never-touched')
    (outside / 'secret.txt').write_text('s', encoding='utf-8')
    root = os.path.realpath(ws)
    touched = []

    def spy(name, original):
        def wrapper(path, *args, **kwargs):
            touched.append((name, os.path.abspath(path)))
            return original(path, *args, **kwargs)
        return wrapper

    for owner, name in ((os, 'listdir'), (os, 'stat'), (os.path, 'lexists'), (os.path, 'isdir'), (os.path, 'isfile'), (os.path, 'islink'), (os.path, 'exists')):
        monkeypatch.setattr(owner, name, spy(name, getattr(owner, name)))
    monkeypatch.setattr('builtins.open', spy('open', open))
    link_dir_or_skip(ws / 'hop', outside)
    hostile = [ex('ls', '../x'), ex('ls', str(outside)), ex('ls', 'hop'), ex('ls', 'hop/secret.txt'), ex('ls', '-o../x'), ex('ls', 'sub/../../x'),
               ex('git', 'status', cwd='..'), ex('git', 'status', cwd=str(outside)), ex('git', 'diff', 'hop/secret.txt'),
               ex('yarn', 'test', cwd='hop'), ex('pytest', 'hop/secret.txt'), ex('ls', cwd='hop'), ex('ls', cwd='sub/../..')]
    for call in hostile:
        auto(call, ws, trusted=True)
    escaped = [(name, path) for name, path in touched if not (path == root or path.startswith(root + os.sep))]
    assert escaped == []


RESERVED = ['CON', 'con', 'NUL', 'nul.txt', 'PRN', 'AUX.log', 'COM1', 'com9.txt', 'LPT1', 'lpt9.tar.gz', 'CONIN$', 'CONOUT$', 'COM¹', 'sub/NUL', 'sub\\aux.txt',
            'NUL.', 'NUL ', 'con.txt.']


@pytest.mark.parametrize('name', RESERVED)
@pytest.mark.parametrize('argv', [('ls',), ('git', 'status', '--'), ('git', 'diff', '--'), ('git', 'log', '--'), ('git', 'ls-files')])
def test_auto_asks_for_a_windows_reserved_device_name_as_operand(argv, name, ws):
    """CON/NUL/COM1... (with or without an extension) open a device on Windows and can hang the command until its timeout."""
    assert auto(ex(*argv, name), ws) == 'ask'


@pytest.mark.parametrize('name', ['console', 'nullable.txt', 'com10', 'lpt0', 'comm', 'sub/connect', 'aux_file', 'notes.txt'])
def test_auto_still_allows_names_that_only_start_like_a_device(name, ws):
    assert auto(ex('ls', name), ws) == 'allow'
