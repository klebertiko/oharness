"""Chat permission mode: a pure policy seam, decided on the backend only.

`decide(mode, call, workspace, trusted)` answers one question for ONE tool call:

* ``"deny"``  - the call must not run and no person is asked (plan mode).
* ``"ask"``   - park on the run's approval gate, exactly as before.
* ``"allow"`` - the mode itself lets the call proceed without the gate.

For ``read``/``discover`` the mode never adds a gate (``"allow"`` means "the mode
has no objection"); the existing secret-path approval stays in the broker and
applies in every mode. Only ``exec`` is shaped by the mode.

``auto_workspace`` is an EXPLICIT ALLOWLIST, not a denylist: a program that is not
listed below asks, however harmless it looks.

* read-only ``git`` (a short subcommand/flag list, run through `hardened_git`),
  ``ls`` and ``pwd`` run without asking in any workspace;
* anything that executes code the repository defines (``npm|pnpm|yarn`` in ANY form, even
  ``--version``, and ``pytest``) runs without asking ONLY when the workspace is *trusted* (an explicit,
  stored, per-workspace user decision), and only with no flags or extra arguments.

There is deliberately no "bypass" mode, and an unknown mode is ``"ask"``. The mode
is stored per conversation by the sidecar; a run request can only tighten it
(`effective_mode`), never loosen it.
"""
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path, PureWindowsPath
from typing import Literal, NamedTuple

from .paths import PathViolation, resolve_in_root
from .secrets import requires_approval

Decision = Literal['ask', 'allow', 'deny']

# The ONE table of modes (permission_modes.json): ids, copy, and what each mode does with each class of exec call.
# The UI ships a byte-identical copy (frontend/src/lib/permissionModes.json, guarded by a parity test), so a mode cannot be
# shown without a rule here, nor ruled on without being shown. Ordered strictest -> laxest; the index is the strictness rank.
MODE_TABLE = json.loads((Path(__file__).with_name('permission_modes.json')).read_text(encoding='utf-8'))
MODES = tuple(mode['id'] for mode in MODE_TABLE['modes'])
DEFAULT_MODE = MODE_TABLE['default']
_RULES = {mode['id']: mode['rules'] for mode in MODE_TABLE['modes']}
DENY_NOTES = {mode['id']: mode['denyNote'] for mode in MODE_TABLE['modes']}
# What an exec call can be: provably read-only; a project script (needs trust); a file command whose paths all stay in the
# workspace; the same with a path outside it; anything else (cannot be checked).
EXEC_CLASSES = ('exec_read', 'exec_project', 'exec_write_inside', 'exec_write_outside', 'exec_other')


def validate_table(table: dict) -> None:
    """A mode without a rule for every class of exec call (or with an unknown rule) must not load: explicit raises, not `assert`."""
    ids = [mode['id'] for mode in table['modes']]
    if table['default'] not in ids or len(set(ids)) != len(ids):
        raise ValueError('permission_modes.json: bad default or duplicate id')
    for mode in table['modes']:
        if set(mode['rules']) != set(EXEC_CLASSES) or not set(mode['rules'].values()) <= {'allow', 'ask', 'deny', 'allow_if_trusted'}:
            raise ValueError(f"permission_modes.json: mode {mode['id']!r} needs one valid rule per exec class")


validate_table(MODE_TABLE)

_SUFFIXES = ('.exe', '.cmd', '.bat', '.com', '.ps1', '.vbs', '.msc', '.sh')
# What shutil.which() / PATHEXT may pick up from the current directory on Windows.
_SHADOW_SUFFIXES = ('', '.exe', '.cmd', '.bat', '.com', '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.msc')

_DRIVE = re.compile(r'^[A-Za-z]:')
_SCHEME = re.compile(r'^[A-Za-z][A-Za-z0-9+.-]*://')
# '..' used as a path segment, glued to a flag ('-o../x'), after '=' / ':' or before a separator.
_DOTDOT_BEFORE_SEP = re.compile(r'\.\.[\\/]')
_DOTDOT_AT_END = re.compile(r'(^|[\\/=:,]|^-[A-Za-z])\.\.$')

PROGRAM_ALLOWLIST = frozenset({'git', 'ls', 'pwd', 'npm', 'pnpm', 'yarn', 'pytest'})
_PACKAGE_MANAGERS = frozenset({'npm', 'pnpm', 'yarn'})

# File commands whose every operand can be checked lexically. `rm`, shells and interpreters are deliberately absent.
# Flags are exact tokens per program: nothing that follows symlinks (`-L`, `-H`), names a target elsewhere (`-t`, `-r FILE`) or
# rewrites paths (`--parents`) is listed.
_WRITE_PROGRAMS = {'mkdir': frozenset({'-p', '-v'}), 'touch': frozenset({'-c'}), 'cp': frozenset({'-r', '-R', '-n', '-v'}), 'mv': frozenset({'-n', '-v'})}
_GIT_DIR_COMPONENT = re.compile(r'^(?:\.git[. ]*|git~\d+)\Z', re.IGNORECASE)  # `.git.`/`.git ` are `.git` on Windows; `GIT~1` is its short name
_WRITE_OPERAND = re.compile(r'^[\w./ +@-]+\Z')

_GIT_SUBCOMMANDS = frozenset({'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'describe'})
_GIT_FLAGS = frozenset({
    '--', '--stat', '--shortstat', '--numstat', '--name-only', '--name-status', '--oneline', '--short', '--porcelain', '-s', '-b', '--branch',
    '--cached', '--staged', '--no-color', '--graph', '--decorate', '--abbrev-commit', '-p', '--patch', '--show-toplevel', '--abbrev-ref',
    '--is-inside-work-tree', '--git-dir', '--tags', '--always',
})
_GIT_COUNT_FLAG = re.compile(r'^(-\d{1,4}|-n\d{1,4}|--max-count=\d{1,4})\Z')
_GIT_OPERAND = re.compile(r'^[A-Za-z0-9_@{}^~:./+\\-]+\Z')
_DIFFY_SUBCOMMANDS = frozenset({'diff', 'log', 'show'})
_SUBMODULE_SCANNERS = frozenset({'status', 'diff'})

# What the repo's own .git/config may set, as ONE table: `section.variable` as git lists it (section and variable
# lowercased, the subsection - if any - is the middle part and keeps its case), the grammar of its value, and the
# git version it needs. `_GIT_CONFIG_ALLOWED` is built from the keys of this table, so a key cannot be admitted
# without a rule, and a key with no rule fails closed in `_git_config_value_ok`. Anything not here - filters, drivers,
# textconv, hooks, includes, aliases, unknown keys - is refused.
class _ConfigRule(NamedTuple):
    key: re.Pattern
    value: re.Pattern | None  # fullmatch on the value; None = any value (keys admitted before value grammars existed)
    bare: bool                # `[core] fscache` with no `=` is boolean true: accepted only where a boolean is
    min_git: tuple            # promisor keys need a git that has GIT_NO_LAZY_FETCH (2.45.0)


def _rule(key: str, value: str | None = None, bare: bool = False, min_git: tuple = ()) -> _ConfigRule:
    # ASCII only: `\d` and IGNORECASE are Unicode-aware otherwise (Arabic-Indic digits, the Kelvin sign for `k`).
    return _ConfigRule(re.compile(key, re.ASCII), None if value is None else re.compile(value, re.IGNORECASE | re.ASCII), bare, min_git)


_CFG_BOOL = r'(?:true|false|yes|no|on|off|0|1)'
_CFG_NUMBER = r'-?[0-9]{1,12}[kKmMgG]?'
_CFG_DATE = r'(?:now|never|[0-9]{1,10}|[0-9]{1,6}\.(?:second|minute|hour|day|week|month|year)s?\.ago)'
# The name of a remote that may be a promisor is an operand of the `git fetch` a lazy fetch starts: no leading `-` or `.`.
_PROMISOR_REMOTE = r'remote\.[A-Za-z0-9_][A-Za-z0-9._-]*'
# A ref name git would accept as a branch: components of `[A-Za-z0-9_@+][A-Za-z0-9._@+-]*` joined by single `/`, with no
# `..`, no component ending in `.lock`, no trailing `.` and not `@` alone (`@{` and the other ref-name specials are outside the set).
_CFG_REF = (r'(?=[\x21-\x7e]{1,200}\Z)(?!.*\.\.)(?!.*\.lock(?:/|\Z))(?!.*\.\Z)(?!@\Z)'
            r'[A-Za-z0-9_@+][A-Za-z0-9._@+-]*(?:/[A-Za-z0-9_@+][A-Za-z0-9._@+-]*)*')
_LAZY_FETCH_SWITCH = (2, 45, 0)
_GIT_CONFIG_RULES = (
    # as #114 shipped them: any value (nothing the allowed read-only subcommands do with them names a program)
    _rule(r'core\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|symlinks|precomposeunicode|autocrlf|eol|safecrlf|longpaths|protectntfs|trustctime)'),
    _rule(r'user\.(?:name|email)'),
    _rule(r'init\.defaultbranch'),
    _rule(r'pull\.(?:rebase|ff)'),
    _rule(r'push\.default'),
    _rule(r'fetch\.prune'),
    _rule(r'color\.ui'),
    _rule(r'remote\..+\.(?:url|pushurl|fetch|push)'),
    _rule(r'branch\..+\.(?:remote|merge|rebase|description)'),
    _rule(r'submodule\..+\.(?:url|active|branch)'),
    # #117
    _rule(r'core\.(?:fscache|sparsecheckout)', _CFG_BOOL, bare=True),
    _rule(r'core\.untrackedcache', rf'(?:{_CFG_BOOL}|keep)', bare=True),
    _rule(r'branch\..+\.vscode-merge-base', _CFG_REF),
    _rule(_PROMISOR_REMOTE + r'\.promisor', _CFG_BOOL, bare=True, min_git=_LAZY_FETCH_SWITCH),
    # Only the filter specs git documents without a path, an object name or a nested spec (`sparse:`, `combine:`, `object:` stay out).
    _rule(_PROMISOR_REMOTE + r'\.partialclonefilter', r'(?:blob:none|blob:limit=[0-9]{1,12}[kKmMgG]?|tree:[0-9]{1,6})', min_git=_LAZY_FETCH_SWITCH),
    _rule(r'gc\.(?:auto|autopacklimit|aggressivedepth|aggressivewindow|bigpackthreshold)', _CFG_NUMBER),
    _rule(r'gc\.(?:autodetach|writecommitgraph)', _CFG_BOOL, bare=True),
    _rule(r'gc\.packrefs', rf'(?:{_CFG_BOOL}|notbare)', bare=True),
    _rule(r'gc\.(?:pruneexpire|reflogexpire|reflogexpireunreachable|worktreepruneexpire)', _CFG_DATE),
    _rule(r'lfs\.repositoryformatversion', r'0'),
)
_GIT_CONFIG_ALLOWED = re.compile(r'^(?:' + '|'.join(f'(?:{rule.key.pattern})' for rule in _GIT_CONFIG_RULES) + r')\Z', re.ASCII)
_PROMISOR_KEY = re.compile(r'remote\..+\.(?:promisor|partialclonefilter)', re.ASCII)
_REMOTE_URL_KEY = re.compile(r'remote\..+\.(?:url|pushurl)', re.ASCII)
# Where a lazy fetch may reach: no leading `-`, no `\`, no `::` (remote helpers: `ext::`, `fd::`), no `ext:`, no whitespace or
# control characters, and one of: a URL with a known scheme, `user@host:path`, a drive path, or a path with no scheme at all.
_REMOTE_URL = re.compile(
    r'(?:(?:https?|ssh|git|file)://[^\x00-\x20\x7f\\]+'
    r'|[A-Za-z0-9._~+-]+@[A-Za-z0-9][A-Za-z0-9.-]*:[^\x00-\x20\x7f\\:][^\x00-\x20\x7f\\]*'
    r'|[A-Za-z]:/[^\x00-\x20\x7f\\]*'
    r'|[^\x00-\x20\x7f\\:]+)', re.ASCII | re.IGNORECASE)
# Files inside .git that make git read configuration or objects from somewhere else (worktrees, linked repos).
_GIT_EXE = shutil.which('git')  # resolved once, at import: the policy never searches PATH while deciding
_EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
_GIT_REDIRECTS = ('commondir', 'config.worktree', 'gitdir')
# An attribute that binds a path to a driver (clean/smudge/textconv/merge/diff program defined in some config).
_GIT_DRIVER_ATTR = re.compile(r'(?:^|\s)(?:filter|diff|merge)\s*=', re.IGNORECASE)

_SCRIPT_NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}\Z')
_PYTEST_FLAGS = frozenset({'-q', '-qq', '-v', '-vv', '-x', '-s', '--lf', '--ff', '--co', '--collect-only', '--no-header', '-rA'})
_PYTEST_TB = re.compile(r'^--tb=(short|long|line|no|auto|native)\Z')
_PYTEST_NODE = re.compile(r'^[\w./\\:\[\]-]+\Z')
_LS_FLAGS = re.compile(r'^-[A-Za-z]{1,6}\Z')
_LS_OPERAND = re.compile(r'^[\w./\\ +@-]+\Z')


def _normalize_program(name: str) -> str:
    base = name.strip().rstrip(' .').lower()
    for suffix in _SUFFIXES:
        if base.endswith(suffix) and len(base) > len(suffix):
            return base[:-len(suffix)]
    return base


def _looks_like_path_escape(arg: str) -> bool:
    """True when an argument names something outside a relative, in-workspace path
    (including a value glued to a flag or repeated '=')."""
    if not arg:
        return False
    if _DOTDOT_BEFORE_SEP.search(arg) or _DOTDOT_AT_END.search(arg):
        return True
    candidates = {arg}
    parts = arg.split('=')
    candidates.update('='.join(parts[i:]) for i in range(1, len(parts)))  # value after the 1st, 2nd... '='
    candidates.update(parts[1:])
    glued = re.sub(r'^-{1,2}[A-Za-z0-9-]*?(?=[./\\~])', '', arg)  # '-o/x', '-o../x'
    candidates.add(glued)
    for candidate in candidates:
        if not candidate:
            continue
        if (_SCHEME.match(candidate) or candidate.startswith(('~', '/', '\\')) or _DRIVE.match(candidate)
                or any(part == '..' for part in re.split(r'[\\/]', candidate))):
            return True
    return False


def _inside(root: str, candidate: str) -> str | None:
    """CodeQL's path-injection sanitizer, in one place: normalize, then require containment in `root`
    (an already-normalized real path) BEFORE the value is used. Every filesystem call in this module only
    receives what this returns; a candidate outside the root yields None and is never touched."""
    normalized = os.path.normpath(candidate)
    prefix = root if root.endswith(os.sep) else root + os.sep
    if normalized == root or normalized.startswith(prefix):
        return normalized
    return None


def _join_inside(root: str, relative: str) -> str | None:
    return _inside(root, os.path.join(root, relative))


def _real_inside(root: str, path: str) -> str | None:
    """Follow symlinks/junctions of an already-contained path and require the target to stay inside `root`."""
    return _inside(root, os.path.realpath(path))


def _operand_stays_in_root(base: str, arg: str) -> bool:
    """An operand that happens to name an existing path must resolve inside the base (symlinks)."""
    full = _join_inside(base, arg)
    if full is None:
        return False
    # realpath of a missing path is just the normalized path, so this is also True for operands that do not exist.
    return _real_inside(base, full) is not None


def _operand_ok(base: str, arg: str, pattern: re.Pattern) -> bool:
    return (not arg.startswith('-') and pattern.match(arg) is not None and not _looks_like_path_escape(arg)
            and _operand_stays_in_root(base, arg))


def _entries(root: str, directory: str) -> list[str] | None:
    safe = _inside(root, directory)
    if safe is None:
        return None
    try:
        return os.listdir(safe)
    except OSError:
        return None


def _shadowed(program: str, root: str, *directories: str) -> bool:
    """A planted `<program>.exe/.cmd/...` in the workspace could be picked up instead of the real tool."""
    names = {program + suffix for suffix in _SHADOW_SUFFIXES}
    for directory in directories:
        entries = _entries(root, directory)
        if entries is None or any(entry.lower() in names for entry in entries):
            return True
    return False


_YARN_CONFIGS = frozenset({'.yarnrc.yml', '.yarnrc'})


def _chain(root: str, cwd: str) -> list[str]:
    """cwd and every parent up to and including the workspace root (never above it)."""
    chain = [cwd]
    while chain[-1] != root:
        parent = os.path.dirname(chain[-1])
        if parent == chain[-1] or _inside(root, parent) is None:
            break
        chain.append(parent)
    return chain


def _has_entry(names: frozenset, root: str, *directories: str) -> bool:
    for directory in directories:
        entries = _entries(root, directory)
        if entries is None or any(entry.lower() in names for entry in entries):
            return True
    return False


def _git_attributes_are_inert(git_dir: str) -> bool:
    """`.git/info/attributes` must not bind any path to a filter/diff/merge driver. Absent is fine."""
    path = os.path.join(git_dir, 'info', 'attributes')
    try:
        if not os.path.lexists(path):
            return True
        if _is_link(path) or not os.path.isfile(path) or os.stat(path).st_size > 65536:
            return False
        with open(path, encoding='utf-8', errors='replace') as handle:
            return not any(_GIT_DRIVER_ATTR.search(line) for line in handle if not line.lstrip(' 	').startswith('#'))
    except OSError:
        return False


def _is_link(path: str) -> bool:
    """A symlink or a Windows junction. `islink` is False for a junction and `isjunction` needs Python 3.12, so a path
    that does not resolve to itself under its own (resolved) parent is a redirect too."""
    isjunction = getattr(os.path, 'isjunction', None)
    if os.path.islink(path) or bool(isjunction and isjunction(path)):
        return True
    parent, name = os.path.split(os.path.abspath(path))
    return os.path.normcase(os.path.realpath(path)) != os.path.normcase(os.path.join(os.path.realpath(parent), name))


def _git_objects_are_local(git_dir: str) -> bool:
    """No alternates and no linked object store: object reads must stay inside the workspace."""
    objects = os.path.join(git_dir, 'objects')
    if os.path.lexists(objects) and (_is_link(objects) or not os.path.isdir(objects)):
        return False
    return not os.path.lexists(os.path.join(objects, 'info', 'alternates'))


def _git_run(args: list[str], cwd: str) -> bytes | None:
    """stdout of a read-only `git <args>` with the user's configuration scrubbed away, or None when it cannot run or fails.
    The one place the policy starts a program: the executable is the one resolved at import, never searched on PATH."""
    git = _GIT_EXE
    if git is None:
        return None
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith('GIT_')}
    env.update({'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_TERMINAL_PROMPT': '0'})
    try:
        # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit
        # argv is a list (no shell); git is the executable resolved once at import; the callers only parse a file or the version.
        done = subprocess.run([git, *args], cwd=cwd, env=env,  # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-subprocess-use-audit
                              capture_output=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    return done.stdout if done.returncode == 0 else None


_GIT_MIN_VERSION = (2, 32)
_GIT_LINKABLE = ('info', 'refs', 'HEAD')
_GIT_VERSION = re.compile(r'git version ([0-9]+)\.([0-9]+)(?:\.([0-9]+))?', re.ASCII)


def _parse_git_version(text: str) -> tuple[int, ...]:
    """`git version 2.53.0.windows.1` -> (2, 53, 0); anything else -> () (unknown: callers treat it as too old)."""
    found = _GIT_VERSION.match(text.strip())
    return tuple(int(part) for part in found.groups(default='0')) if found else ()


_GIT_VERSION_RETRY_S = 30.0  # a failed probe is retried at most this often; only a success is remembered


class _GitProbe:
    """What the process has learned about the installed git: the version once read, and when a read last failed."""
    version: tuple[int, ...] = ()
    failed_at: float | None = None


_GIT_PROBE = _GitProbe()


def _git_version() -> tuple[int, ...]:
    """The installed git's version as a tuple of ints; () when it cannot be read.
    A version that was read is remembered for the process. A failure (a timeout while an antivirus scans git on
    its first call, say) is not: it is retried, but not more often than every `_GIT_VERSION_RETRY_S` seconds,
    so a git that never answers does not cost a probe per command."""
    if _GIT_PROBE.version:
        return _GIT_PROBE.version
    now = time.monotonic()
    if _GIT_PROBE.failed_at is not None and now - _GIT_PROBE.failed_at < _GIT_VERSION_RETRY_S:
        return ()
    out = _git_run(['--version'], os.path.dirname(_GIT_EXE) if _GIT_EXE else '.')
    version = _parse_git_version(out.decode('utf-8', 'replace')) if out is not None else ()
    if version:
        _GIT_PROBE.version, _GIT_PROBE.failed_at = version, None
    else:
        _GIT_PROBE.failed_at = now
    return version


def _git_config_keys(config: str, git_dir: str) -> list[str] | None:
    """Every key git itself parses out of `config`, or None when git cannot parse it or a value breaks the
    grammar its key is bound to (`_GIT_CONFIG_RULES`). `git config -f --list`
    only reads; with --no-includes it follows nothing and a hostile file cannot make it start a program."""
    out = _git_run(['config', '--file', config, '--no-includes', '--null', '--list'], git_dir)
    if out is None:
        return None
    try:
        text = out.decode('utf-8')
    except UnicodeDecodeError:
        return None
    entries = []
    for entry in text.split('\0'):
        if not entry:
            continue
        key, separator, value = entry.partition('\n')
        value = value if separator else None
        if not _git_config_value_ok(key, value):
            return None
        entries.append((key, value))
    # A promisor remote makes a read-only command able to reach `remote.*.url` (lazy fetch): then every URL needs a grammar.
    if any(_PROMISOR_KEY.fullmatch(key) for key, _ in entries):
        if not all(value is not None and _git_remote_url_ok(value) for key, value in entries if _REMOTE_URL_KEY.fullmatch(key)):
            return None
    return [key for key, _ in entries]


def _git_remote_url_ok(url: str) -> bool:
    return not (url.startswith('-') or '::' in url or url.lower().startswith('ext:')) and _REMOTE_URL.fullmatch(url) is not None


def _git_config_rule(key: str) -> _ConfigRule | None:
    return next((rule for rule in _GIT_CONFIG_RULES if rule.key.fullmatch(key)), None)


def _git_config_value_ok(key: str, value: str | None) -> bool:
    """The key must have a rule, the value must fully match its grammar (`None` is a key written with no `=`), and a rule
    that needs a newer git is not satisfied by an older or unknown one. A key with no rule fails closed."""
    rule = _git_config_rule(key)
    if rule is None:
        return False
    if rule.min_git and _git_version() < rule.min_git:
        return False
    if rule.value is None:
        return True
    return rule.bare if value is None else rule.value.fullmatch(value) is not None


def _git_config_is_inert(root: str) -> bool:
    """Everything git would read for this repo must be unable to start programs (filters, textconv, hooks, includes...).

    Fail-closed: besides `.git/config`, any redirection (`commondir`, `config.worktree`, `gitdir` inside `.git`),
    `objects/info/alternates`, or `info/attributes` driver binding makes the repo unverifiable, so the caller asks
    instead of auto-approving. `.git/config` is parsed by git (a line parser diverges from it: several headers on one
    line, a BOM) and every key must be on an allowlist.
    """
    git_dir = _join_inside(root, '.git')
    config = _join_inside(root, os.path.join('.git', 'config'))
    if git_dir is None or config is None:
        return False
    # GIT_CONFIG_GLOBAL (what keeps ~/.gitconfig out of every run) exists since git 2.32; an older or unknown git reads it again.
    if _git_version() < _GIT_MIN_VERSION:
        return False
    try:
        if _is_link(git_dir) or not os.path.isdir(git_dir) or _is_link(config) or not os.path.isfile(config) or os.stat(config).st_size > 65536:
            return False
        if any(_is_link(os.path.join(git_dir, name)) for name in _GIT_LINKABLE if os.path.lexists(os.path.join(git_dir, name))):
            return False
        if any(os.path.lexists(os.path.join(git_dir, name)) for name in _GIT_REDIRECTS):
            return False
        if not _git_attributes_are_inert(git_dir) or not _git_objects_are_local(git_dir):
            return False
    except OSError:
        return False
    keys = _git_config_keys(config, git_dir)
    return keys is not None and all(_GIT_CONFIG_ALLOWED.match(key) for key in keys)


def _git_ok(args: list[str], root: str, cwd: str) -> bool:
    if args in (['--version'], ['-v']):
        return True
    if not args or args[0] not in _GIT_SUBCOMMANDS or not _git_config_is_inert(root):
        return False
    for arg in args[1:]:
        if arg in _GIT_FLAGS or _GIT_COUNT_FLAG.match(arg):
            continue
        if not _operand_ok(cwd, arg, _GIT_OPERAND):
            return False
    return True


def _package_manager_ok(args: list[str], trusted: bool) -> bool:
    # Every invocation, `--version` included, needs trust: the shims read repo-controlled files
    # (yarn's `.yarnrc.yml` `yarnPath` re-executes a script from the repo for ANY subcommand).
    if not trusted:
        return False
    if args in (['--version'], ['-v']):
        return True
    # Exactly `<pm> test` or `<pm> run <script>`: no flags, no `--`, no extra arguments.
    if args == ['test']:
        return True
    return len(args) == 2 and args[0] in ('run', 'run-script') and _SCRIPT_NAME.match(args[1]) is not None


def _pytest_ok(args: list[str], trusted: bool, cwd: str) -> bool:
    if not trusted:
        return False
    for arg in args:
        if arg in _PYTEST_FLAGS or _PYTEST_TB.match(arg):
            continue
        if not _operand_ok(cwd, arg, _PYTEST_NODE):
            return False
    return True


def _ls_ok(args: list[str], cwd: str) -> bool:
    return all(_LS_FLAGS.match(arg) or _operand_ok(cwd, arg, _LS_OPERAND) for arg in args)


def _exec_context(call, workspace):
    """(root, program, cwd, args) for a call that starts a program inside an existing workspace, else None."""
    if workspace is None:
        return None
    try:
        root = os.path.realpath(str(workspace))
    except (OSError, RuntimeError, ValueError):
        return None
    if not os.path.isdir(root):
        return None
    argv = list(call.argv)
    program_raw = argv[0]
    if any(sep in program_raw for sep in ('/', '\\')) or _DRIVE.match(program_raw) or program_raw.startswith('~'):
        return None
    program = _normalize_program(program_raw)
    if PureWindowsPath(call.cwd).drive or Path(call.cwd).is_absolute() or call.cwd.startswith(('/', '\\')):
        return None
    try:
        # Lexical, reserved-name and symlink checks first; the contained real path is then re-verified below.
        resolved = resolve_in_root(Path(root), call.cwd)
    except (PathViolation, OSError, ValueError):
        return None
    cwd = _real_inside(root, str(resolved))
    if cwd is None or not os.path.isdir(cwd) or _shadowed(program, root, root, cwd):
        return None
    return root, program, cwd, argv[1:]


def _allowed_in_context(context, trusted: bool) -> bool:
    root, program, cwd, args = context
    if program not in PROGRAM_ALLOWLIST:
        return False
    if program == 'git':
        return _git_ok(args, root, cwd)
    if program in _PACKAGE_MANAGERS:
        # Defense in depth: a yarn config anywhere from the cwd up to the root (yarn searches upward) can redirect the binary even in a trusted workspace.
        if program == 'yarn' and _has_entry(_YARN_CONFIGS, root, *_chain(root, cwd)):
            return False
        return _package_manager_ok(args, trusted)
    if program == 'pytest':
        return _pytest_ok(args, trusted, cwd)
    if program == 'ls':
        return _ls_ok(args, cwd)
    return not args  # pwd


def _allowed_exec(call, workspace, trusted: bool) -> bool:
    context = _exec_context(call, workspace)
    return context is not None and _allowed_in_context(context, trusted)


def _touches_git_dir(arg: str) -> bool:
    return any(_GIT_DIR_COMPONENT.match(part) for part in re.split(r'[\\/]', arg))


def _destination_ok(program: str, root: str, cwd: str, operands: list[str], flags_used: list[str]) -> bool:
    """`cp`/`mv` into an existing directory write `dir/<name of each source>`: that path (an existing symlink there is written through)
    must also resolve inside the workspace, and a recursive copy into an existing tree is not proven (links may sit deeper)."""
    if program not in ('cp', 'mv') or len(operands) < 2:
        return True
    dest = os.path.join(cwd, operands[-1])
    if not os.path.isdir(dest):
        return True
    recursive = any(flag in ('-r', '-R') for flag in flags_used)
    for source in operands[:-1]:
        target = os.path.join(dest, os.path.basename(source.rstrip('/\\')))
        if _inside(root, os.path.realpath(target)) is None or (recursive and os.path.lexists(target)):
            return False
    return True


def _write_class(context) -> str:
    """`exec_write_inside` when the program is a listed file command with only its listed flags and every operand is a plain
    relative path that stays in the workspace, is not inside `.git` and does not name a secret; `exec_write_outside` for a
    listed command with an operand that escapes the workspace."""
    root, program, cwd, args = context
    flags = _WRITE_PROGRAMS.get(program)
    if flags is None:
        return 'exec_other'
    operands = [arg for arg in args if arg not in flags]
    if not operands or any(arg.startswith('-') or _touches_git_dir(arg) or requires_approval(Path(arg)) for arg in operands):
        return 'exec_other'
    if any(_looks_like_path_escape(arg) for arg in operands):
        return 'exec_write_outside'
    if all(_operand_ok(cwd, arg, _WRITE_OPERAND) for arg in operands) and _destination_ok(program, root, cwd, operands, flags_used=[a for a in args if a in flags]):
        return 'exec_write_inside'
    return 'exec_other'


def exec_class(call, workspace) -> str:
    """Which of `EXEC_CLASSES` this validated exec call is. Anything that cannot be proven is `exec_other`."""
    context = _exec_context(call, workspace)
    if context is None:
        return 'exec_other'
    if _allowed_in_context(context, False):
        return 'exec_read'
    if context[1] in _PACKAGE_MANAGERS | {'pytest'} and _allowed_in_context(context, True):
        return 'exec_project'
    return _write_class(context)


_RM_LONG_FLAGS = {'--recursive': 'r', '--force': 'f'}
_ALWAYS_ASK_PROGRAMS = frozenset({'sudo', 'su', 'doas', 'dd', 'mkfs', 'shutdown', 'reboot', 'halt', 'poweroff',
                                  # wrappers and shells hide the real command from this check
                                  'env', 'nice', 'nohup', 'xargs', 'time', 'timeout', 'command', 'exec', 'sh', 'bash', 'zsh', 'dash', 'fish', 'cmd', 'powershell', 'pwsh'})


def needs_confirmation_even_when_allowed(argv: list[str]) -> bool:
    """Commands that ask even in a mode that otherwise lets them run (Full): privilege escalation, raw disk writes,
    recursive-force deletes however the flags are spelled, forced git pushes, recursive chmod/chown, and any argument that
    names a secret path (`.env`, keys, credentials): the secret gate of `read` also covers a command that would print one."""
    if not argv:
        return False
    program = _normalize_program(argv[0].replace('\\', '/').rsplit('/', 1)[-1])
    args = argv[1:]
    if program in _ALWAYS_ASK_PROGRAMS or program.startswith('mkfs.'):
        return True
    short = {ch for arg in args if arg.startswith('-') and not arg.startswith('--') for ch in arg[1:]}
    long_ = {_RM_LONG_FLAGS[arg] for arg in args if arg in _RM_LONG_FLAGS}
    if program == 'rm' and {'r', 'R'} & (short | long_):  # a recursive delete asks, with or without -f
        return True
    if program in ('chmod', 'chown', 'chgrp') and ({'R'} & short or '--recursive' in args):
        return True
    if program == 'git':
        # git's global options (`-C dir`, `-c k=v`) come before the subcommand
        rest, skip = [], False
        for a in args:
            if skip:
                skip = False
            elif a in ('-C', '-c', '--git-dir', '--work-tree', '--namespace'):
                skip = True
            elif not a.startswith('-') or rest:
                rest.append(a)
        if rest[:1] == ['push'] and any(a in ('-f', '--force') or a.startswith('--force-') or (a.startswith('-') and not a.startswith('--') and 'f' in a) or a.startswith('+') or ':+' in a for a in rest[1:]):
            return True
    return any(requires_approval(Path(arg)) for arg in args if arg and not arg.startswith('-'))


def hardened_git(argv: list[str], root) -> tuple[list[str], dict[str, str]]:
    """Argv and extra environment for an auto-approved `git`: a neutral configuration so the
    repository's own config (fsmonitor, pager, external diff, textconv, hooks) cannot start a
    program. Other programs are returned untouched."""
    if not argv or _normalize_program(argv[0]) != 'git':
        return list(argv), {}
    head = ['git', '-c', 'core.fsmonitor=', '-c', 'core.pager=cat', '-c', 'diff.external=',
            '-c', f'core.hooksPath={os.devnull}',
            # Defense in depth for the GIT_DIR pin below: git only enters a bare repository it is told about explicitly.
            '-c', 'safe.bareRepository=explicit',
            # A promisor remote (`remote.*.promisor`, admitted above) lets a read-only command fetch a missing object from `remote.*.url`.
            # No transport is allowed, so no command started here contacts a server or reads another repository (git >= 2.45.0 also
            # honours GIT_NO_LAZY_FETCH below, which skips the attempt altogether).
            '-c', 'protocol.allow=never',
            '--no-pager', '--no-optional-locks']
    rest = list(argv[1:])
    if rest and rest[0] in _DIFFY_SUBCOMMANDS:
        rest[1:1] = ['--no-ext-diff', '--no-textconv']
    if rest and rest[0] in _SUBMODULE_SCANNERS:
        # A gitlink in the index makes `status`/`diff` start `git status` INSIDE that directory, which reads the nested
        # repo's own config and info/attributes (filter.*.process runs). `dirty` compares only the recorded commit.
        rest[1:1] = ['--ignore-submodules=dirty']
    real_root = os.path.realpath(str(root))
    git_dir = os.path.join(real_root, '.git')
    env = {
        # Pinned so git never follows `.git/commondir`, a `.git` file or a parent repo to a config we did not verify.
        'GIT_DIR': git_dir, 'GIT_COMMON_DIR': git_dir, 'GIT_WORK_TREE': real_root,
        # Attributes (filter=/diff=) come from the empty tree, not from the working tree's .gitattributes (git >= 2.42; older git ignores it,
        # and stays inert: the verified config and the neutral global/system config define no driver - see test_sandbox_nested_git.py).
        'GIT_ATTR_SOURCE': _EMPTY_TREE,
        'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_PAGER': 'cat', 'GIT_TERMINAL_PROMPT': '0',
        'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_LAZY_FETCH': '1', 'GIT_CEILING_DIRECTORIES': os.path.dirname(real_root),
    }
    return head + rest, env


def decide_with_class(mode, call, workspace, trusted: bool = False) -> tuple[Decision, str | None]:
    """The verdict for one validated tool call and, for `exec`, the class it was judged as (classified once)."""
    if getattr(call, 'name', None) != 'exec':
        return 'allow', None
    rules = _RULES[mode] if isinstance(mode, str) and mode in _RULES else _RULES[DEFAULT_MODE]  # unknown mode: the default one
    cls = exec_class(call, workspace)
    rule = rules[cls]
    if rule == 'allow_if_trusted':
        return ('allow' if trusted else 'ask'), cls
    return rule, cls


def decide(mode, call, workspace, trusted: bool = False) -> Decision:
    """Policy verdict for one validated tool call (`Exec`, `Read`, `Discover`)."""
    return decide_with_class(mode, call, workspace, trusted)[0]


_STRICTNESS = {'allow': 0, 'allow_if_trusted': 1, 'ask': 2, 'deny': 3}


def _tighter_or_equal(candidate: str, base: str) -> bool:
    """True when `candidate` is at least as strict as `base` for every class of exec call. The modes are not a total order
    (Read-only auto-runs reads that Ask would gate, yet refuses writes that Ask would allow), so rank is not enough."""
    return all(_STRICTNESS[_RULES[candidate][cls]] >= _STRICTNESS[_RULES[base][cls]] for cls in EXEC_CLASSES)


def effective_mode(stored, requested=None) -> str:
    """The conversation's stored mode, tightened by a request only when the requested mode is at least as strict for every
    class of exec call. Anything else keeps the stored mode. Unknown or missing values count as ``ask`` (a request naming a
    mode the backend does not know is never laxer than the default)."""
    base = stored if isinstance(stored, str) and stored in _RULES else DEFAULT_MODE
    if requested is None:
        return base
    candidate = requested if isinstance(requested, str) and requested in _RULES else DEFAULT_MODE
    return candidate if _tighter_or_equal(candidate, base) else base
