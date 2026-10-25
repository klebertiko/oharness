"""The auto-approved git allowlist for a repository's own `.git/config` (issue #117).

Every key admitted to ``_GIT_CONFIG_ALLOWED`` needs proof that it carries no program, no path outside the
workspace and no URL that git would contact, and a key that takes free text is also bound to a value grammar.
Three kinds of evidence live here:

* a table of keys (any spelling of the case) the policy admits, with the value that makes each one real;
* the same keys with hostile values, and the sibling keys that stay refused (they name programs, paths or URLs);
* real git: a real ``git clone`` (full and ``--filter=blob:none``) goes through the production path
  (``ToolBroker.call`` -> ``decide`` -> ``hardened_git`` -> ``sandbox.exec.run``), and a promisor remote is
  never contacted by a read-only command (the lazy fetch is the one effect ``remote.*.promisor`` adds).
"""
import asyncio
import os
import shutil
import sys

import pytest

from engine import RunControl
from sandbox import broker as broker_module
from sandbox import permission
from sandbox.exec import run
from sandbox.permission import decide, hardened_git
from sandbox.schemas import Exec, ToolsRequest

pytestmark = pytest.mark.skipif(shutil.which('git') is None, reason='git is not installed')

# Fixture building must not read the developer's own git configuration.
SETUP_ENV = {'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_TERMINAL_PROMPT': '0'}
PAYLOAD = "import pathlib, sys\npathlib.Path(sys.argv[1], sys.argv[2]).write_text('ran', encoding='utf-8')\n"


def git(cwd, *args, env=None):
    """Setup-only git, through the same runner the broker uses (no direct subprocess in the tests)."""
    argv = ['git', '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', *args]
    result = asyncio.run(run(argv, cwd, 30, env={**SETUP_ENV, **(env or {})}))
    assert result['ok'], f'git {args} failed: {result["result"]}'
    return result['result'].strip()


def make_upstream(tmp_path, name='upstream'):
    """A one-commit repository that serves partial clones."""
    up = tmp_path / name
    up.mkdir()
    git(up, 'init', '-q')
    git(up, 'config', 'uploadpack.allowFilter', 'true')
    git(up, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
    (up / 'f.txt').write_text('hello from the promisor\n', encoding='utf-8')
    git(up, 'add', 'f.txt')
    git(up, 'commit', '-q', '-m', 'first commit')
    return up


def make_repo(tmp_path, name='ws'):
    root = tmp_path / name
    root.mkdir()
    git(root, 'init', '-q')
    (root / 'a.txt').write_text('one\n', encoding='utf-8')
    git(root, 'add', 'a.txt')
    git(root, 'commit', '-q', '-m', 'root commit')
    return root


def with_config(root, text):
    with open(root / '.git' / 'config', 'a', encoding='utf-8', newline='\n') as handle:
        handle.write(text)
    return root


def verdict(root, *argv):
    return decide('auto_workspace', Exec(argv=list(argv or ('git', 'status')), cwd='.'), root)


def run_auto(root, argv):
    """The production path: broker -> decide -> hardened_git -> exec.run, in auto_workspace mode."""
    control = RunControl('git-config-allowlist')
    broker = broker_module.ToolBroker(str(root), 'ollama', control, ToolsRequest(enabled=True), permission_mode='auto_workspace')

    async def collect():
        return [event async for event in broker.call('exec', {'argv': argv, 'cwd': '.', 'timeout_s': 30}, origin='preset')]
    return asyncio.run(collect())


def run_hardened(root, argv, env=None):
    """hardened_git with no policy in front of it: what auto-approved git would do if the allowlist were bypassed."""
    cmd, pins = hardened_git(argv, root)
    return asyncio.run(run(cmd, root, 30, env={**SETUP_ENV, **pins, **(env or {})}))


def run_unguarded(cwd, argv):
    return asyncio.run(run(argv, cwd, 30, env=dict(SETUP_ENV)))


def packs(root):
    return sorted(os.listdir(root / '.git' / 'objects' / 'pack'))


# -- (1) admitted keys: a repo with this in its config is auto-approved --------------------------------
ADMITTED = [
    # core: boolean switches that only change how git caches or lists the work tree
    ('core.fscache', '[core]\n\tfscache = true\n'),
    ('core.fscache bare', '[core]\n\tfscache\n'),
    ('core.fscache any case', '[CORE]\n\tFsCache = FALSE\n'),
    ('core.untrackedCache true', '[core]\n\tuntrackedCache = true\n'),
    ('core.untrackedCache keep', '[core]\n\tuntrackedCache = keep\n'),
    ('core.untrackedCache any case', '[Core]\n\tUNTRACKEDCACHE = False\n'),
    ('core.sparseCheckout', '[core]\n\tsparseCheckout = true\n'),
    ('core.sparseCheckout any case', '[core]\n\tSparseCheckout = no\n'),
    # written by the VS Code git extension: a ref name that only that extension reads
    ('branch.*.vscode-merge-base', '[branch "main"]\n\tvscode-merge-base = origin/main\n'),
    ('branch.*.vscode-merge-base nested name', '[branch "feature/x"]\n\tvscode-merge-base = upstream/release/1.2\n'),
    # partial clone: what `git clone --filter=` writes
    ('remote.*.promisor', '[remote "origin"]\n\tpromisor = true\n'),
    ('remote.*.partialclonefilter blob:none', '[remote "origin"]\n\tpartialclonefilter = blob:none\n'),
    ('remote.*.partialclonefilter blob:limit', '[remote "origin"]\n\tpartialclonefilter = blob:limit=1m\n'),
    ('remote.*.partialclonefilter tree', '[remote "origin"]\n\tpartialclonefilter = tree:0\n'),
    ('remote.*.promisor any case', '[Remote "Origin"]\n\tPromisor = TRUE\n\tPartialCloneFilter = blob:none\n'),
    # gc: counters, switches and expiry dates; none names a program
    ('gc.auto', '[gc]\n\tauto = 0\n'),
    ('gc.autoPackLimit', '[gc]\n\tautoPackLimit = 50\n'),
    ('gc.autoDetach', '[gc]\n\tautoDetach = false\n'),
    ('gc.bigPackThreshold', '[gc]\n\tbigPackThreshold = 2g\n'),
    ('gc.writeCommitGraph', '[gc]\n\twriteCommitGraph = true\n'),
    ('gc.aggressiveDepth', '[gc]\n\taggressiveDepth = 50\n'),
    ('gc.aggressiveWindow', '[gc]\n\taggressiveWindow = 250\n'),
    ('gc.packRefs', '[gc]\n\tpackRefs = notbare\n'),
    ('gc.pruneExpire', '[gc]\n\tpruneExpire = 2.weeks.ago\n'),
    ('gc.pruneExpire never', '[gc]\n\tpruneExpire = never\n'),
    ('gc.reflogExpire', '[gc]\n\treflogExpire = 90.days.ago\n'),
    ('gc.reflogExpireUnreachable', '[gc]\n\treflogExpireUnreachable = now\n'),
    ('gc.worktreePruneExpire', '[gc]\n\tworktreePruneExpire = 3.months.ago\n'),
    ('gc any case', '[GC]\n\tAUTO = 256\n'),
    # lfs: the one key an LFS installation leaves in .git/config besides filter.lfs.* (which stays refused)
    ('lfs.repositoryformatversion', '[lfs]\n\trepositoryformatversion = 0\n'),
]


@pytest.mark.parametrize('config', [text for _, text in ADMITTED], ids=[name for name, _ in ADMITTED])
def test_a_repo_config_with_this_inert_key_is_auto_approved(config, tmp_path):
    root = with_config(make_repo(tmp_path), config)
    assert verdict(root, 'git', 'status') == 'allow'
    assert verdict(root, 'git', 'log') == 'allow'


# -- (2) the same keys with a value that could carry code, a path or a URL ------------------------------
HOSTILE_VALUES = [
    ('core.fscache program', '[core]\n\tfscache = sh -c x\n'),
    ('core.fscache subst', '[core]\n\tfscache = $(id)\n'),
    ('core.fscache newline', '[core]\n\tfscache = "true\\nx"\n'),
    ('core.untrackedCache program', '[core]\n\tuntrackedCache = !sh\n'),
    ('core.untrackedCache suffix', '[core]\n\tuntrackedCache = keepx\n'),
    ('core.sparseCheckout path', '[core]\n\tsparseCheckout = /etc/passwd\n'),
    ('core.sparseCheckout newline', '[core]\n\tsparseCheckout = "true\\n[core]"\n'),
    ('vscode-merge-base option', '[branch "main"]\n\tvscode-merge-base = --upload-pack=sh\n'),
    ('vscode-merge-base shell', '[branch "main"]\n\tvscode-merge-base = $(sh)\n'),
    ('vscode-merge-base space', '[branch "main"]\n\tvscode-merge-base = "origin/main sh"\n'),
    ('vscode-merge-base windows path', '[branch "main"]\n\tvscode-merge-base = C:\\\\secrets\n'),
    ('vscode-merge-base semicolon', '[branch "main"]\n\tvscode-merge-base = "origin/main;sh"\n'),
    ('vscode-merge-base newline', '[branch "main"]\n\tvscode-merge-base = "origin/main\\nx"\n'),
    ('vscode-merge-base empty', '[branch "main"]\n\tvscode-merge-base =\n'),
    ('promisor program', '[remote "origin"]\n\tpromisor = ext::sh -c x\n'),
    ('promisor word', '[remote "origin"]\n\tpromisor = maybe\n'),
    ('filter sparse path', '[remote "origin"]\n\tpartialclonefilter = sparse:path=/etc/passwd\n'),
    ('filter sparse oid', '[remote "origin"]\n\tpartialclonefilter = sparse:oid=HEAD:.sparse\n'),
    ('filter combine', '[remote "origin"]\n\tpartialclonefilter = combine:blob:none+tree:0\n'),
    ('filter object type', '[remote "origin"]\n\tpartialclonefilter = object:type=blob\n'),
    ('filter trailing program', '[remote "origin"]\n\tpartialclonefilter = "blob:none;sh"\n'),
    ('filter limit text', '[remote "origin"]\n\tpartialclonefilter = blob:limit=abc\n'),
    ('filter newline', '[remote "origin"]\n\tpartialclonefilter = "blob:none\\n[core]"\n'),
    ('filter empty', '[remote "origin"]\n\tpartialclonefilter =\n'),
    ('gc.auto program', '[gc]\n\tauto = "6700; sh"\n'),
    ('gc.auto subst', '[gc]\n\tauto = $(id)\n'),
    ('gc.autoDetach word', '[gc]\n\tautoDetach = sh\n'),
    ('gc.bigPackThreshold path', '[gc]\n\tbigPackThreshold = ../../x\n'),
    ('gc.packRefs word', '[gc]\n\tpackRefs = sh\n'),
    ('gc.pruneExpire program', '[gc]\n\tpruneExpire = "now; sh"\n'),
    ('gc.reflogExpire subst', '[gc]\n\treflogExpire = $(id)\n'),
    ('gc.worktreePruneExpire path', '[gc]\n\tworktreePruneExpire = /etc\n'),
    ('lfs.repositoryformatversion path', '[lfs]\n\trepositoryformatversion = ../../x\n'),
    ('lfs.repositoryformatversion other', '[lfs]\n\trepositoryformatversion = 1\n'),
]


@pytest.mark.parametrize('config', [text for _, text in HOSTILE_VALUES], ids=[name for name, _ in HOSTILE_VALUES])
def test_an_admitted_key_with_a_hostile_value_still_asks(config, tmp_path):
    root = with_config(make_repo(tmp_path), config)
    assert verdict(root, 'git', 'status') == 'ask'


# -- (3) siblings of the admitted keys: they name a program, a path or a URL, so they stay refused -----------
STILL_REFUSED = [
    # core: program, hook directory, pager, editor, ssh, ignore/attribute files
    '[core]\n\tfsmonitor = true\n', '[core]\n\tfsmonitor = sh\n', '[core]\n\thooksPath = ../hooks\n', '[core]\n\tpager = sh\n',
    '[core]\n\teditor = sh\n', '[core]\n\tsshCommand = sh\n', '[core]\n\tattributesFile = ../x\n', '[core]\n\texcludesFile = ../x\n',
    '[core]\n\tsparseCheckoutCone = true\n', '[core]\n\tuntrackedCacheX = true\n', '[core]\n\tfscachee = true\n',
    '[core "x"]\n\tfscache = true\n', '[core "x"]\n\tuntrackedCache = true\n',
    # remote: programs run for the transport, and everything that makes a read-only command contact a server
    '[remote "origin"]\n\tuploadpack = sh\n', '[remote "origin"]\n\treceivepack = sh\n', '[remote "origin"]\n\tvcs = x\n',
    '[remote "origin"]\n\tproxy = http://x\n', '[remote "origin"]\n\tpromisorx = true\n', '[remote]\n\tpromisor = true\n',
    '[remote "origin"]\n\tserveroption = x\n', '[remote "origin"]\n\ttagopt = --tags\n',
    # extensions are not part of what a partial clone writes (git 2.53 writes only the remote keys)
    '[extensions]\n\tpartialClone = origin\n', '[extensions]\n\tworktreeConfig = true\n', '[extensions]\n\tobjectFormat = sha256\n',
    # gc: a program, a pattern subsection, and everything unknown
    '[gc]\n\trecentObjectsHook = sh\n', '[gc]\n\trecentobjectshook = sh -c x\n', '[gc "refs/heads/*"]\n\treflogExpire = never\n',
    '[gc]\n\tunknownNewKey = 1\n', '[gc]\n\tcruftPacks = true\n', '[gc]\n\tlogExpiry = 1.day.ago\n', '[gc "x"]\n\tauto = 0\n',
    '[maintenance]\n\tauto = false\n', '[maintenance]\n\tstrategy = incremental\n',
    # lfs: endpoints, storage, transfer programs, per-URL access hints
    '[lfs]\n\turl = https://example.com/lfs\n', '[lfs]\n\tpushurl = https://example.com/lfs\n', '[lfs]\n\tstorage = ../elsewhere\n',
    '[lfs]\n\tconcurrenttransfers = 8\n', '[lfs]\n\tstandalonetransferurl = https://x\n',
    '[lfs "customtransfer.x"]\n\tpath = sh\n', '[lfs "customtransfer.x"]\n\targs = -c x\n',
    '[lfs "https://example.com/x.git/info/lfs"]\n\taccess = basic\n', '[lfs "extension.x"]\n\tclean = sh\n',
    '[filter "lfs"]\n\tprocess = git-lfs filter-process\n', '[filter "lfs"]\n\tclean = git-lfs clean -- %f\n',
    '[lfs]\n\trepositoryformatversion = 0\n[filter "lfs"]\n\tsmudge = git-lfs smudge -- %f\n',
    # keys that make a transport allowed, rewrite a URL or run something else, whatever the table above says
    '[protocol]\n\tallow = always\n', '[protocol "file"]\n\tallow = always\n', '[url "x"]\n\tinsteadOf = y\n', '[alias]\n\tst = !sh\n',
    '[credential]\n\thelper = sh\n', '[uploadpack]\n\tpackObjectsHook = sh\n', '[receive]\n\tdenyCurrentBranch = ignore\n',
    '[include]\n\tpath = x\n', '[diff]\n\texternal = sh\n', '[diff "x"]\n\tcommand = sh\n', '[merge "x"]\n\tdriver = sh\n',
]


@pytest.mark.parametrize('config', STILL_REFUSED)
def test_sibling_keys_that_can_run_code_or_leave_the_workspace_stay_refused(config, tmp_path):
    root = with_config(make_repo(tmp_path), config)
    assert verdict(root, 'git', 'status') == 'ask'


def test_one_refused_key_next_to_admitted_ones_still_asks(tmp_path):
    root = with_config(make_repo(tmp_path), '[core]\n\tfscache = true\n\tuntrackedCache = true\n[gc]\n\tauto = 0\n'
                                            '[remote "origin"]\n\tpromisor = true\n\tuploadpack = sh\n')
    assert verdict(root, 'git', 'status') == 'ask'


# -- (4) real git: every admitted key at once, then a real clone, through the production path ---------------
def test_a_repo_with_every_admitted_key_runs_read_only_git_through_the_production_path(tmp_path):
    root = make_repo(tmp_path)
    with_config(root, ''.join(text for name, text in ADMITTED if ' any case' not in name and 'bare' not in name
                              and name not in ('lfs.repositoryformatversion', 'gc.pruneExpire never')))
    (root / '.git' / 'info').mkdir(exist_ok=True)
    (root / '.git' / 'info' / 'sparse-checkout').write_text('/*\n', encoding='utf-8')
    (root / 'a.txt').write_text('two\n', encoding='utf-8')
    for argv in (['git', 'status'], ['git', 'diff'], ['git', 'log', '--oneline'], ['git', 'show', '--stat'], ['git', 'rev-parse', 'HEAD'],
                 ['git', 'ls-files']):
        assert decide('auto_workspace', Exec(argv=argv, cwd='.'), root) == 'allow', argv
        events = run_auto(root, argv)
        assert [e['kind'] for e in events] == ['tool_call', 'tool_auto_approved', 'tool_result'], argv
        assert events[-1]['ok'] is True, events[-1]['result']


def test_a_real_git_clone_is_auto_approved_and_answers_read_only_commands(tmp_path):
    up = make_upstream(tmp_path)
    clone = tmp_path / 'clone'
    git(tmp_path, 'clone', '-q', up.as_uri(), str(clone))
    config = (clone / '.git' / 'config').read_text(encoding='utf-8')
    assert 'url = ' in config and 'fetch = ' in config  # the clone really wrote a remote
    assert verdict(clone, 'git', 'status') == 'allow'
    log = run_auto(clone, ['git', 'log', '--oneline'])
    assert log[-1]['ok'] is True and 'first commit' in log[-1]['result']
    shown = run_auto(clone, ['git', 'show', 'HEAD:f.txt'])
    assert shown[-1]['ok'] is True and 'hello from the promisor' in shown[-1]['result']


@pytest.fixture()
def partial_clone(tmp_path):
    """`git clone --filter=blob:none --no-checkout`: the history is there, the blob of f.txt is not."""
    up = make_upstream(tmp_path)
    clone = tmp_path / 'partial'
    git(tmp_path, 'clone', '-q', '--filter=blob:none', '--no-checkout', up.as_uri(), str(clone))
    config = (clone / '.git' / 'config').read_text(encoding='utf-8')
    assert 'promisor = true' in config and 'partialclonefilter = blob:none' in config, config
    return up, clone


def test_a_real_partial_clone_is_auto_approved_and_runs_through_the_production_path(partial_clone):
    _, clone = partial_clone
    for argv in (['git', 'status'], ['git', 'log', '--oneline'], ['git', 'rev-parse', 'HEAD'], ['git', 'ls-files']):
        assert decide('auto_workspace', Exec(argv=argv, cwd='.'), clone) == 'allow', argv
        events = run_auto(clone, argv)
        assert [e['kind'] for e in events] == ['tool_call', 'tool_auto_approved', 'tool_result'], argv
        assert events[-1]['ok'] is True, events[-1]['result']
    assert 'first commit' in run_auto(clone, ['git', 'log', '--oneline'])[-1]['result']


def test_the_control_git_without_hardening_does_fetch_the_missing_blob_from_the_promisor(partial_clone):
    """Proves the next test is not vacuous: an unhardened read-only command contacts the promisor remote."""
    _, clone = partial_clone
    before = packs(clone)
    shown = run_unguarded(clone, ['git', '--no-pager', 'show', 'HEAD:f.txt'])
    assert shown['ok'] is True and 'hello from the promisor' in shown['result']
    assert packs(clone) != before


def test_auto_approved_git_never_lazy_fetches_from_a_promisor_remote(partial_clone):
    _, clone = partial_clone
    before = packs(clone)
    events = run_auto(clone, ['git', 'show', 'HEAD:f.txt'])
    assert events[-1]['ok'] is False  # the blob is missing and nothing is allowed to go and get it
    assert 'hello from the promisor' not in events[-1]['result']
    assert packs(clone) == before  # no object arrived


def test_hardened_git_blocks_the_promisor_transport_even_for_a_hostile_remote_program(tmp_path, partial_clone):
    """If the allowlist were bypassed: `remote.*.uploadpack` is the program git starts for a local promisor."""
    _, clone = partial_clone
    markers = tmp_path / 'markers'
    markers.mkdir()
    script = tmp_path / 'payload.py'
    script.write_text(PAYLOAD, encoding='utf-8')
    program = f'"{sys.executable.replace(chr(92), "/")}" "{script.as_posix()}" "{markers.as_posix()}" uploadpack'
    with_config(clone, f'[remote "origin"]\n\tuploadpack = {program}\n')
    run_unguarded(clone, ['git', '--no-pager', 'show', 'HEAD:f.txt'])
    assert [e.name for e in markers.iterdir()] == ['uploadpack']  # armed: unhardened git starts it
    (markers / 'uploadpack').unlink()
    result = run_hardened(clone, ['git', 'show', 'HEAD:f.txt'])
    assert result['ok'] is False
    assert list(markers.iterdir()) == []


def test_a_partial_clone_that_points_outside_the_workspace_is_not_read_through_the_promisor(tmp_path, partial_clone):
    """`remote.*.url` is already admitted; with `promisor` it would have become a read of another repository."""
    up, clone = partial_clone
    other = tmp_path / 'secrets'
    other.mkdir()
    git(other, 'init', '-q')
    (other / 'secret.txt').write_text('outside the workspace\n', encoding='utf-8')
    git(other, 'add', 'secret.txt')
    git(other, 'commit', '-q', '-m', 'secret')
    git(other, 'config', 'uploadpack.allowFilter', 'true')
    git(other, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
    git(clone, 'config', 'remote.origin.url', other.as_posix())
    outside_blob = git(other, 'rev-parse', 'HEAD:secret.txt')
    before = packs(clone)
    result = run_hardened(clone, ['git', 'cat-file', '-p', outside_blob])
    assert result['ok'] is False
    assert 'outside the workspace' not in result['result']
    assert packs(clone) == before


# -- (5) the hardened argv carries the guards the promisor key depends on --------------------------------------
def test_hardened_git_denies_every_transport_and_turns_lazy_fetch_off(tmp_path):
    argv, env = hardened_git(['git', 'status'], tmp_path)
    pairs = {argv[i + 1] for i, token in enumerate(argv) if token == '-c'}
    assert 'protocol.allow=never' in pairs
    assert env['GIT_NO_LAZY_FETCH'] == '1'


# -- (6) `.git` as a file (a linked worktree) stays `ask` --------------------------------------------------------
def test_a_linked_worktree_whose_dot_git_is_a_file_still_asks_and_points_outside_the_workspace(tmp_path):
    main = make_repo(tmp_path, 'main')
    linked = tmp_path / 'linked'
    git(main, 'worktree', 'add', '-q', str(linked), '-b', 'side')
    assert (linked / '.git').is_file()
    pointer = (linked / '.git').read_text(encoding='utf-8').strip()
    assert pointer.startswith('gitdir:')
    target = os.path.realpath(pointer.split(':', 1)[1].strip())
    assert os.path.commonpath([os.path.realpath(linked), target]) != os.path.realpath(linked)  # outside the workspace
    assert verdict(linked, 'git', 'status') == 'ask'
    assert verdict(linked, 'git', 'log') == 'ask'
    # the pin that keeps git inside the workspace cannot name this repository either, so there is no safe way to run it
    assert run_hardened(linked, ['git', 'status'])['ok'] is False


# =============================================================================================================
# SEC/QA round on #125
# =============================================================================================================
# -- the name of a promisor remote is an operand of `git fetch`: it must not be able to be an option ---------
HOSTILE_REMOTE_NAMES = [
    "--upload-pack=sh -c 'touch M' #", '--force', '--upload-pack=x', '-x', '-', 'a b', 'a/b', 'a;b', '$(id)', 'é', 'ｏrigin',
]


@pytest.mark.parametrize('name', HOSTILE_REMOTE_NAMES)
@pytest.mark.parametrize('variable', ['promisor = true', 'partialclonefilter = blob:none'])
def test_a_promisor_remote_whose_name_could_be_an_option_asks(name, variable, tmp_path):
    root = with_config(make_repo(tmp_path), f'[remote "{name}"]\n\t{variable}\n')
    assert verdict(root, 'git', 'status') == 'ask'


@pytest.mark.parametrize('name', ['origin', 'up.stream', 'my_remote-1', 'Origin', 'fork2'])
def test_ordinary_remote_names_are_still_admitted_for_the_promisor_keys(name, tmp_path):
    root = with_config(make_repo(tmp_path), f'[remote "{name}"]\n\tpromisor = true\n\tpartialclonefilter = tree:0\n')
    assert verdict(root, 'git', 'status') == 'allow'


def test_a_remote_named_like_an_upload_pack_option_does_not_run_its_program_when_the_name_is_the_only_flaw(partial_clone, tmp_path):
    """The SEC repro, end to end: the policy asks, so the broker never starts git for it."""
    _, clone = partial_clone
    markers = tmp_path / 'name-markers'
    markers.mkdir()
    script = tmp_path / 'name-payload.py'
    script.write_text(PAYLOAD, encoding='utf-8')
    program = f'"{sys.executable.replace(chr(92), "/")}" "{script.as_posix()}" "{markers.as_posix()}" name'
    name = f'--upload-pack={program} #'.replace('"', '\\"')  # inside a subsection only `\` and `"` are escaped
    with_config(clone, f'[remote "{name}"]\n\tpromisor = true\n')
    assert verdict(clone, 'git', 'show', 'HEAD:f.txt') == 'ask'  # `ask` parks the call on the approval gate: git is never started
    assert list(markers.iterdir()) == []


# -- promisor keys only on a git that has GIT_NO_LAZY_FETCH (2.45.0) ------------------------------------------
PROMISOR_CONFIGS = ['[remote "origin"]\n\tpromisor = true\n', '[remote "origin"]\n\tpartialclonefilter = blob:none\n']


@pytest.mark.parametrize('config', PROMISOR_CONFIGS)
@pytest.mark.parametrize('version,expected', [((2, 44, 0), 'ask'), ((2, 44, 9), 'ask'), ((2, 45, 0), 'allow'), ((2, 53, 0), 'allow'),
                                              ((3, 0, 0), 'allow'), ((2, 32, 0), 'ask'), ((), 'ask')])
def test_promisor_keys_need_a_git_that_has_the_lazy_fetch_switch(config, version, expected, tmp_path, monkeypatch):
    root = with_config(make_repo(tmp_path), config)
    monkeypatch.setattr(permission, '_git_version', lambda: version)
    assert verdict(root, 'git', 'status') == expected


@pytest.mark.parametrize('version', [(2, 44, 0), (2, 32, 0)])
def test_the_git_version_does_not_matter_for_a_repo_without_promisor_keys(version, tmp_path, monkeypatch):
    root = with_config(make_repo(tmp_path), '[core]\n\tfscache = true\n[gc]\n\tauto = 0\n')
    monkeypatch.setattr(permission, '_git_version', lambda: version)
    assert verdict(root, 'git', 'status') == 'allow'


@pytest.mark.parametrize('text,expected', [('git version 2.53.0.windows.1', (2, 53, 0)), ('git version 2.45.0\n', (2, 45, 0)),
                                           ('git version 2.9', (2, 9, 0)), ('git version 2.46.0-rc1', (2, 46, 0)),
                                           ('', ()), ('fatal: not git', ()), ('git version x.y', ())])
def test_git_version_parsing_fails_closed(text, expected):
    assert permission._parse_git_version(text) == expected


def test_the_real_git_version_is_a_cached_tuple_of_ints():
    version = permission._git_version()
    assert isinstance(version, tuple) and all(isinstance(part, int) for part in version) and version[:1] == (2,)
    assert permission._git_version() is version


# -- ASCII only: Unicode digits and case folds are not git numbers or booleans --------------------------------
UNICODE_VALUES = [
    ('gc', 'auto', '٢'), ('gc', 'auto', '１２'), ('gc', 'bigPackThreshold', '5\u212a'), ('gc', 'bigPackThreshold', '١٢k'),
    ('gc', 'autoDetach', 'tru\u0435'), ('gc', 'pruneExpire', '2.week\u017f.ago'), ('gc', 'pruneExpire', '٢.weeks.ago'),
    ('gc', 'packRefs', 'no\u017ftbare'), ('core', 'fscache', '\u0661'), ('core', 'untrackedCache', 'ke\u0435p'),
    ('remote "origin"', 'partialclonefilter', 'tree:\u0661'), ('remote "origin"', 'partialclonefilter', 'blob:limit=\u0661'),
    ('remote "origin"', 'partialclonefilter', 'blob:limit=1\u212a'), ('branch "main"', 'vscode-merge-base', 'origin/ma\u0456n'),
    ('lfs', 'repositoryformatversion', '\u0660'),
]


@pytest.mark.parametrize('section,variable,value', UNICODE_VALUES)
def test_a_value_that_only_looks_like_a_number_or_a_word_in_unicode_asks(section, variable, value, tmp_path):
    root = with_config(make_repo(tmp_path), f'[{section}]\n\t{variable} = {value}\n')
    assert verdict(root, 'git', 'status') == 'ask'


# -- one table: a key with no value grammar is not admitted ---------------------------------------------------
def test_a_key_without_a_value_rule_fails_closed(monkeypatch):
    assert permission._git_config_value_ok('core.fscache', 'true') is True
    monkeypatch.setattr(permission, '_GIT_CONFIG_RULES', ())
    assert permission._git_config_value_ok('core.fscache', 'true') is False
    assert permission._git_config_value_ok('totally.unknown', 'x') is False


SAMPLE_ALLOWED_KEYS = [
    'core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates', 'core.ignorecase', 'core.symlinks',
    'core.precomposeunicode', 'core.autocrlf', 'core.eol', 'core.safecrlf', 'core.longpaths', 'core.protectntfs', 'core.trustctime',
    'core.fscache', 'core.untrackedcache', 'core.sparsecheckout', 'user.name', 'user.email', 'init.defaultbranch', 'pull.rebase',
    'pull.ff', 'push.default', 'fetch.prune', 'color.ui', 'remote.origin.url', 'remote.origin.pushurl', 'remote.origin.fetch',
    'remote.origin.push', 'remote.origin.promisor', 'remote.origin.partialclonefilter', 'branch.main.remote', 'branch.main.merge',
    'branch.main.rebase', 'branch.main.description', 'branch.main.vscode-merge-base', 'submodule.x.url', 'submodule.x.active',
    'submodule.x.branch', 'gc.auto', 'gc.autopacklimit', 'gc.autodetach', 'gc.bigpackthreshold', 'gc.writecommitgraph',
    'gc.aggressivedepth', 'gc.aggressivewindow', 'gc.packrefs', 'gc.pruneexpire', 'gc.reflogexpire', 'gc.reflogexpireunreachable',
    'gc.worktreepruneexpire', 'lfs.repositoryformatversion',
]


@pytest.mark.parametrize('key', SAMPLE_ALLOWED_KEYS)
def test_every_allowed_key_has_a_rule_and_the_allowlist_is_built_from_the_rules(key):
    assert permission._GIT_CONFIG_ALLOWED.match(key)
    assert permission._git_config_rule(key) is not None


def test_a_key_the_rules_do_not_know_is_not_in_the_allowlist():
    assert not permission._GIT_CONFIG_ALLOWED.match('core.fsmonitor')
    assert permission._git_config_rule('core.fsmonitor') is None


# -- with a promisor the URL is reachable by a lazy fetch: it needs a grammar too -----------------------------
BAD_URLS = ['ext::sh -c touch% M', 'ext:sh', 'EXT::x', '-oProxyCommand=x', '--upload-pack=sh', 'https://h/x\\y', 'C:\\secrets\\repo',
            'fd::7', 'foo::bar', 'ftp://h/x', 'ssh+x://h/x', 'https://h/x y', 'javascript:alert(1)', 'h:\\x', 'ssh://h/x\nfoo']
GOOD_URLS = ['https://example.com/x.git', 'http://example.com/x.git', 'ssh://git@example.com/x.git', 'git://example.com/x.git',
             'git@github.com:o/r.git', 'file:///tmp/up', 'file:///C:/Users/x/up', '/srv/git/up', 'C:/Users/x/up', '../up', './up']


@pytest.mark.parametrize('url', BAD_URLS)
@pytest.mark.parametrize('variable', ['url', 'pushurl'])
def test_with_a_promisor_a_remote_url_that_names_a_program_or_an_odd_transport_asks(url, variable, tmp_path):
    escaped = url.replace('\\', '\\\\').replace('\n', '\\n')
    root = with_config(make_repo(tmp_path), f'[remote "origin"]\n\tpromisor = true\n\t{variable} = "{escaped}"\n')
    assert verdict(root, 'git', 'status') == 'ask'


@pytest.mark.parametrize('url', GOOD_URLS)
def test_with_a_promisor_ordinary_remote_urls_are_admitted(url, tmp_path):
    root = with_config(make_repo(tmp_path), f'[remote "origin"]\n\turl = {url}\n\tpromisor = true\n\tpushurl = {url}\n')
    assert verdict(root, 'git', 'status') == 'allow'


@pytest.mark.parametrize('url', ['ext::sh -c x', 'C:\\x', 'ftp://h/x'])
def test_without_a_promisor_the_remote_url_keeps_its_old_behaviour(url, tmp_path):
    """No lazy fetch can reach the url: the verdict is the one #114 shipped (any value)."""
    escaped = url.replace('\\', '\\\\')
    root = with_config(make_repo(tmp_path), f'[remote "origin"]\n\turl = "{escaped}"\n')
    assert verdict(root, 'git', 'status') == 'allow'


# -- a vscode-merge-base is a well-formed ref name ------------------------------------------------------------
BAD_REFS = ['a/../../b', 'a/..', '../a', 'a//b', 'a/', '/a', 'a.lock', 'a/b.lock/c', 'a@{1}', '@', 'a..b', 'a.', '.a', 'a/.b', 'a/b.',
            'a/./b', '-a', 'a b', 'a' * 201]
GOOD_REFS = ['origin/main', 'upstream/release/1.2', 'main', 'feature/x-y_z', 'v1.0.0', 'users/a@b/topic', 'origin/a.b']


@pytest.mark.parametrize('ref', BAD_REFS)
def test_a_vscode_merge_base_that_is_not_a_well_formed_ref_asks(ref, tmp_path):
    root = with_config(make_repo(tmp_path), f'[branch "main"]\n\tvscode-merge-base = "{ref}"\n')
    assert verdict(root, 'git', 'status') == 'ask'


@pytest.mark.parametrize('ref', GOOD_REFS)
def test_a_vscode_merge_base_that_is_a_well_formed_ref_is_admitted(ref, tmp_path):
    root = with_config(make_repo(tmp_path), f'[branch "main"]\n\tvscode-merge-base = {ref}\n')
    assert verdict(root, 'git', 'status') == 'allow'


# -- each guard alone is behavioural proof, not just argv/env -------------------------------------------------
def _without_pair(cmd, pair):
    out = list(cmd)
    for index in range(len(out) - 2, -1, -1):
        if out[index] == '-c' and out[index + 1] == pair:
            del out[index:index + 2]
            return out
    raise AssertionError(f'{pair} not in {cmd}')


def _show_missing_blob(clone, *, transport_guard, lazy_switch):
    cmd, pins = hardened_git(['git', 'show', 'HEAD:f.txt'], clone)
    if not transport_guard:
        cmd = _without_pair(cmd, 'protocol.allow=never')
    if not lazy_switch:
        pins = {key: value for key, value in pins.items() if key != 'GIT_NO_LAZY_FETCH'}
    return asyncio.run(run(cmd, clone, 30, env={**SETUP_ENV, **pins}))


def test_the_transport_guard_alone_stops_the_lazy_fetch(partial_clone):
    _, clone = partial_clone
    before = packs(clone)
    result = _show_missing_blob(clone, transport_guard=True, lazy_switch=False)
    assert result['ok'] is False and 'hello from the promisor' not in result['result']
    assert 'not allowed' in result['result']  # git tried and the transport policy refused it
    assert packs(clone) == before


def test_the_lazy_fetch_switch_alone_stops_the_lazy_fetch(partial_clone):
    if permission._git_version() < (2, 45, 0):
        pytest.skip('GIT_NO_LAZY_FETCH needs git 2.45')
    _, clone = partial_clone
    before = packs(clone)
    result = _show_missing_blob(clone, transport_guard=False, lazy_switch=True)
    assert result['ok'] is False and 'hello from the promisor' not in result['result']
    assert 'not allowed' not in result['result']  # no attempt at all
    assert packs(clone) == before


def test_with_both_guards_removed_the_blob_is_fetched(partial_clone):
    """Control for the two tests above: it is those two guards, and nothing else, that stop the fetch."""
    _, clone = partial_clone
    result = _show_missing_blob(clone, transport_guard=False, lazy_switch=False)
    assert result['ok'] is True and 'hello from the promisor' in result['result']
