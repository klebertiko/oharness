"""Local runner and Forja secrets (ADR 0057): worktree per run on its own branch, secrets only by reference, never in output."""
from __future__ import annotations

import asyncio
import base64
import sys
import urllib.parse
from pathlib import Path

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from database import SessionLocal
from factory import runner
from factory.secrets_orm import SecretIndex
from main import app
from secret_store.memory import MemorySecrets
from workspaces.service import WorkspaceService

HUMAN = {'x-oharness-human': 'human-secret'}
VALUE = 'Zq9-' + 'k3Lm' * 4  # a secret value no pattern recognises


def agent(secrets=None, role='implement'):
    return {'role': role, 'model': 'm', 'enabled': True, 'permissions': {'mode': 'workspace_write'}, 'skills': [], 'mcp': [],
            'secrets': secrets or [], 'localSkills': {}, 'instructions': 'x', 'memory': {}}


def defn(**runners):
    return {'name': 'payments', 'repositories': [{'id': 'app', 'path': '.', 'protectedBranches': ['main', 'release/*']}],
            'runners': runners, 'agents': {'builder': agent(['forja/npm-token']), 'plain': agent()}}


# ---------------------------------------------------------------------------------------------------------------- redaction

def test_the_run_redactor_removes_the_exact_value_and_its_usual_forms():
    redactor = runner.RunRedactor([VALUE])
    for form in (VALUE, base64.b64encode(VALUE.encode()).decode(), urllib.parse.quote(VALUE, safe='')):
        assert VALUE not in redactor.redact(f'before {form} after') and form not in redactor.redact(f'x {form} y')
    assert runner.RunRedactor(['ab']).redact('ab ab') == 'ab ab'  # too short to be a secret: redacting it would only mangle the output
    assert runner.RunRedactor([]).redact('plain') == 'plain'


# -------------------------------------------------------------------------------------------------------------- delivery

def test_an_agent_receives_only_the_secrets_it_lists():
    store = MemorySecrets()
    store.put('forja/npm-token', VALUE)
    store.put('forja/other', 'not-for-the-builder-0123456789')
    env, redactor = runner.secrets_for(defn(), 'builder', store)
    assert env == {'FORJA_SECRET_NPM_TOKEN': VALUE} and VALUE not in redactor.redact(f'{VALUE}')
    assert runner.secrets_for(defn(), 'plain', store)[0] == {}  # no list, no secret


def test_a_missing_secret_stops_the_run_without_leaking_anything():
    with pytest.raises(runner.SecretMissing) as raised:
        runner.secrets_for(defn(), 'builder', MemorySecrets())
    assert 'forja/npm-token' in str(raised.value)  # the reference is a name; the value never existed


def test_the_command_sees_the_secret_but_the_output_and_other_env_do_not(tmp_path, monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-sidecar-' + 'a' * 30)
    _, repo = _repo(tmp_path, monkeypatch)
    workspace = runner.create_run_workspace(repo, 'item-8', 'run-y')
    store = MemorySecrets()
    store.put('forja/npm-token', VALUE)
    code = "import os; v = os.environ['FORJA_SECRET_NPM_TOKEN']; print('len', len(v)); print('value', v); print('sidecar', os.environ.get('OPENAI_API_KEY'))"
    try:
        result = anyio.run(lambda: runner.run_as_agent(defn(), 'builder', [sys.executable, '-c', code], workspace, store))
    finally:
        runner.remove_run_workspace(repo, workspace['id'])
    assert f'len {len(VALUE)}' in result['result'] and VALUE not in result['result'] and 'sidecar None' in result['result']


# ------------------------------------------------------------------------------------------------------------------ guard

@pytest.mark.parametrize('command', [
    'git push origin main', 'git push origin HEAD:main', 'git push --force origin main', 'git push origin release/1.2',
    'git push origin +main', 'gh pr merge 12 --squash', 'gh api repos/o/r/pulls/12/merge -X PUT', 'sh -c "git push origin main"',
    ['git', 'push', 'origin', 'main'], ['gh', 'pr', 'merge', '3'],
])
def test_pushes_to_protected_branches_and_merges_are_denied(command):
    assert runner.deny_command(command, ['main', 'release/*'])


@pytest.mark.parametrize('command', ['git status', 'git push origin forja/item-1', ['git', 'push', '-u', 'origin', 'forja/x'], 'gh pr view 3', 'git commit -m "main"'])
def test_ordinary_commands_pass_the_guard(command):
    assert runner.deny_command(command, ['main', 'release/*']) is None


# --------------------------------------------------------------------------------------------------------------------- pool

def test_the_pool_runs_at_most_the_configured_number_and_the_rest_wait():
    async def go():
        pool = runner.RunnerPool(2)
        gate, started = asyncio.Event(), []

        async def work(n):
            async with pool.slot():
                started.append(n)
                await gate.wait()
        tasks = [asyncio.create_task(work(n)) for n in range(3)]
        await asyncio.sleep(0.05)
        snapshot = (len(started), pool.running, pool.waiting)
        gate.set()
        await asyncio.gather(*tasks)
        return snapshot, len(started), pool.running
    assert anyio.run(go) == ((2, 2, 1), 3, 0)


def test_runner_settings_come_from_the_definition_with_defaults():
    assert runner.runner_config(defn()) == {'type': 'local', 'maxConcurrentRuns': 2, 'credentialStrategy': 'forja'}
    custom = defn(main={'type': 'local', 'maxConcurrentRuns': 4, 'credentialStrategy': 'user'})
    assert runner.runner_config(custom, 'main')['maxConcurrentRuns'] == 4


# ---------------------------------------------------------------------------------------------------------------- worktree

def _repo(tmp_path: Path, monkeypatch):
    for key in ('HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME'):
        monkeypatch.setenv(key, str(tmp_path / 'home'))
    (tmp_path / 'home').mkdir()
    monkeypatch.setenv('OH_WORKSPACES_HOME', str(tmp_path / 'oh-data'))
    git = WorkspaceService().runner
    repo = tmp_path / 'repo'
    repo.mkdir()
    git.run(repo, ['init', '-q', '-b', 'main'])
    git.run(repo, ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '--allow-empty', '-m', 'base'])
    return git, repo


def test_each_run_gets_its_own_worktree_on_its_own_branch(tmp_path, monkeypatch):
    git, repo = _repo(tmp_path, monkeypatch)
    one = runner.create_run_workspace(repo, 'item-1', 'run-a')
    two = runner.create_run_workspace(repo, 'item-1', 'run-b')
    try:
        assert one['branch'] == 'forja/item-1-run-a' and two['branch'] == 'forja/item-1-run-b' and one['path'] != two['path']
        assert Path(one['path']).resolve() != repo.resolve() and repo not in Path(one['path']).resolve().parents
        assert git.run(one['path'], ['branch', '--show-current']).text().strip() == 'forja/item-1-run-a'
        assert git.run(repo, ['branch', '--show-current']).text().strip() == 'main'  # the main checkout is untouched
        assert git.run(repo, ['status', '--porcelain'], filters=True).text().strip() == ''
    finally:
        runner.remove_run_workspace(repo, one['id'])
        runner.remove_run_workspace(repo, two['id'])
    assert not Path(one['path']).exists()


@pytest.mark.parametrize('item,run', [('a b', 'r'), ('../x', 'r'), ('-bad', 'r'), ('ok', 'r..2'), ('ok', 'r;rm')])
def test_run_branch_names_are_validated(tmp_path, monkeypatch, item, run):
    _, repo = _repo(tmp_path, monkeypatch)
    with pytest.raises(runner.RunnerError):
        runner.create_run_workspace(repo, item, run)


# ------------------------------------------------------------------------------------------------------------ secrets API

async def _reset():
    async with SessionLocal() as db:
        await db.execute(delete(SecretIndex))
        await db.commit()


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    with TestClient(app) as c:
        app.state.secrets_store = MemorySecrets()
        anyio.run(_reset)
        yield c
    anyio.run(_reset)


def test_a_person_stores_a_secret_and_nothing_ever_returns_the_value(client):
    put = client.put('/factory/secrets/npm-token', json={'value': VALUE}, headers=HUMAN)
    assert put.status_code == 200 and VALUE not in put.text
    assert app.state.secrets_store.get('forja/npm-token') == VALUE  # in the vault under the exact reference
    listing = client.get('/factory/secrets')
    assert VALUE not in listing.text and [s['name'] for s in listing.json()['secrets']] == ['npm-token'] and 'updated_at' in listing.json()['secrets'][0]
    client.put('/factory/secrets/npm-token', json={'value': VALUE + 'v2'}, headers=HUMAN)  # replace
    assert len(client.get('/factory/secrets').json()['secrets']) == 1 and app.state.secrets_store.get('forja/npm-token') == VALUE + 'v2'
    removed = client.delete('/factory/secrets/npm-token', headers=HUMAN)
    assert removed.status_code == 204
    assert client.get('/factory/secrets').json()['secrets'] == [] and not app.state.secrets_store.exists('forja/npm-token')


def test_secrets_are_a_persons_decision_and_names_and_sizes_are_checked(client):
    refused_put = client.put('/factory/secrets/x', json={'value': VALUE})
    refused_delete = client.delete('/factory/secrets/x')
    assert refused_put.status_code == 403 and refused_delete.status_code == 403
    for bad in ('bad name', 'a' * 101, '..'):
        bad_name = client.put(f'/factory/secrets/{bad}', json={'value': VALUE}, headers=HUMAN)
        assert bad_name.status_code in (404, 422)
    too_big = client.put('/factory/secrets/big', json={'value': 'v' * 9000}, headers=HUMAN)
    empty = client.put('/factory/secrets/empty', json={'value': ''}, headers=HUMAN)
    again = client.delete('/factory/secrets/never-stored', headers=HUMAN)  # deleting twice is fine
    assert too_big.status_code == 422 and empty.status_code == 422 and again.status_code == 204


def test_no_route_of_the_sidecar_can_read_a_secret_value():
    paths = {path: spec for path, spec in app.openapi()['paths'].items() if path.startswith('/factory/secrets')}
    assert set(paths) == {'/factory/secrets', '/factory/secrets/{name}'}
    assert set(paths['/factory/secrets']) == {'get'} and set(paths['/factory/secrets/{name}']) == {'put', 'delete'}  # a read only lists names


# ---- review round

@pytest.mark.parametrize('command', [
    'git -C /repo push origin main', 'git -c push.default=current push origin main', "git push origin 'main'", 'git push --repo=origin origin main',
    'git --git-dir=.git push origin HEAD:refs/heads/main', 'gh -R o/r pr merge 4', 'gh pr --repo o/r merge 4', 'gh api graphql -f query=mutation{mergePullRequest}',
    "bash -lc 'git push origin main'", 'gh alias set m "pr merge"',
])
def test_more_ways_to_push_or_merge_are_denied(command):
    assert runner.deny_command(command, ['main', 'release/*'])


def test_a_secret_cut_in_half_by_truncation_leaves_no_prefix():
    redactor = runner.RunRedactor([VALUE])
    cut = 'output ' + VALUE[:9]
    assert VALUE[:6] not in redactor.redact(cut, truncated=True)
    assert redactor.redact(cut) == cut  # not truncated: a short coincidence stays


def test_two_references_cannot_share_one_variable():
    store = MemorySecrets()
    store.put('forja/npm-token', VALUE)
    store.put('forja/npm_token', VALUE + 'x')
    definition = defn()
    definition['agents']['builder']['secrets'] = ['forja/npm-token', 'forja/npm_token']
    with pytest.raises(runner.RunnerError):
        runner.secrets_for(definition, 'builder', store)


def test_a_rejected_secret_body_does_not_echo_the_value(client):
    resp = client.put('/factory/secrets/big', json={'value': 'v' * 9000}, headers=HUMAN)
    assert resp.status_code == 422 and 'v' * 50 not in resp.text
    not_json = client.put('/factory/secrets/big', content=b'not json', headers=HUMAN)
    assert not_json.status_code == 422


# ---- second review round

@pytest.mark.parametrize('command', [
    'git --attr-source=HEAD push origin main', 'git --bare push origin main', 'GIT.EXE push origin main', 'git.cmd push origin main',
    '(git push origin main)', 'echo $(git push origin main)', 'x=`git push origin main`', 'true; git push origin main', 'false || git push origin main',
    'git push origin main' + chr(10), 'gh api repos/o/r/pulls/1/merge --input body.json', 'gh api graphql -F query=@merge.graphql',
])
def test_the_guard_reads_commands_the_way_a_shell_would(command):
    assert runner.deny_command(command, ['main'])


def test_a_secret_prefix_before_the_truncation_marker_is_removed():
    redactor = runner.RunRedactor([VALUE])
    cut = 'out ' + VALUE[:9] + chr(10) + '[truncated]'
    assert VALUE[:6] not in redactor.redact(cut, truncated=True) and redactor.redact(cut, truncated=True).endswith('[truncated]')


@pytest.mark.parametrize('command', [
    'git push origin ' + chr(92) + chr(10) + 'main', 'git push origin main', 'gh api repos/o/r/pulls/1/merge --input=body.json', 'gh api graphql -f query=x',
])
def test_third_review_round_shell_forms(command):
    assert runner.deny_command(command, ['main'])


def test_only_the_marker_the_sandbox_writes_counts_as_a_cut():
    redactor = runner.RunRedactor([VALUE])
    fake = 'user wrote ' + VALUE[:9] + chr(10) + '[truncated by me] more'
    assert redactor.redact(fake, truncated=True) == fake  # not the sandbox marker: nothing to cut there
    real = 'out ' + VALUE[:9] + chr(10) + '…[truncated at 65536 bytes]'
    assert VALUE[:6] not in redactor.redact(real, truncated=True)


# ---- references outside the namespace, redaction order, minimum length, run workspaces

def test_a_reference_outside_the_forja_namespace_is_never_read_from_the_vault():
    store = MemorySecrets()
    store.put('openharness/provider-key', 'sk-provider-' + 'z' * 30)
    definition = defn()
    definition['agents']['builder']['secrets'] = ['openharness/provider-key']
    with pytest.raises(runner.RunnerError) as raised:
        runner.secrets_for(definition, 'builder', store)
    assert 'zzzz' not in str(raised.value)


def test_a_secret_that_contains_a_known_pattern_is_redacted_whole(tmp_path, monkeypatch):
    git, repo = _repo(tmp_path, monkeypatch)
    workspace = runner.create_run_workspace(repo, 'item-9', 'run-z')
    value = 'pre-sk-' + 'a1b2' * 6 + '-post'
    store = MemorySecrets()
    store.put('forja/npm-token', value)
    code = "import os; print(os.environ['FORJA_SECRET_NPM_TOKEN'])"
    try:
        result = anyio.run(lambda: runner.run_as_agent(defn(), 'builder', [sys.executable, '-c', code], workspace, store))
    finally:
        runner.remove_run_workspace(repo, workspace['id'])
    assert 'pre-' not in result['result'] and 'a1b2a1b2' not in result['result'] and '-post' not in result['result'] and 'redacted' in result['result']


def test_the_run_must_happen_inside_a_run_workspace(tmp_path, monkeypatch):
    git, repo = _repo(tmp_path, monkeypatch)
    store = MemorySecrets()
    store.put('forja/npm-token', VALUE)
    with pytest.raises(runner.RunnerError):
        anyio.run(lambda: runner.run_as_agent(defn(), 'builder', [sys.executable, '-c', 'print(1)'], {'id': repo.name, 'path': str(repo)}, store))  # the main checkout
    with pytest.raises(runner.RunnerError):
        anyio.run(lambda: runner.run_as_agent(defn(), 'builder', [sys.executable, '-c', 'print(1)'], {'id': 'x', 'path': str(tmp_path / '..')}, store))


def test_a_secret_too_short_to_be_redacted_is_refused(client):
    short = client.put('/factory/secrets/tiny', json={'value': 'abc'}, headers=HUMAN)
    fine = client.put('/factory/secrets/ok', json={'value': 'abcd'}, headers=HUMAN)
    assert short.status_code == 422 and fine.status_code == 200


def test_the_workspace_must_be_the_root_of_that_run_and_not_another(tmp_path, monkeypatch):
    _, repo = _repo(tmp_path, monkeypatch)
    one = runner.create_run_workspace(repo, 'item-1', 'run-a')
    two = runner.create_run_workspace(repo, 'item-1', 'run-b')
    store = MemorySecrets()
    store.put('forja/npm-token', VALUE)
    from workspaces.config import Settings
    root = Settings.from_env().managed_root
    argv = [sys.executable, '-c', 'print(1)']
    try:
        ok = anyio.run(lambda: runner.run_as_agent(defn(), 'builder', argv, one, store))
        assert ok['ok']
        for bad in ({'id': one['id'], 'path': str(root)},  # the managed root itself
                    {'id': one['id'], 'path': str(Path(one['path']) / 'sub')},  # a folder inside the worktree
                    {'id': one['id'], 'path': two['path']},  # the worktree of another run under this run's id
                    {'id': two['id'], 'path': one['path']}):
            with pytest.raises(runner.RunnerError):
                anyio.run(lambda bad=bad: runner.run_as_agent(defn(), 'builder', argv, bad, store))
    finally:
        runner.remove_run_workspace(repo, one['id'])
        runner.remove_run_workspace(repo, two['id'])


def test_builtin_commands_can_hand_back_raw_text(tmp_path):
    import time
    from sandbox import exec as sandbox_exec
    folder = tmp_path / ('sk-' + 'a1b2' * 6)
    folder.mkdir()
    raw = anyio.run(lambda: sandbox_exec._run_builtin(['pwd'], folder, 5, time.monotonic(), redact_output=False))
    assert 'a1b2a1b2' in raw['result'] and raw['redactions'] == 0
    assert 'a1b2a1b2' not in anyio.run(lambda: sandbox_exec._run_builtin(['pwd'], folder, 5, time.monotonic()))['result']


def test_a_failed_index_write_leaves_no_orphan_in_the_vault(client, monkeypatch):
    from sqlalchemy.ext.asyncio import AsyncSession

    async def boom(self):
        raise RuntimeError('disk full')
    app.state.secrets_store.put('forja/kept', 'old-value-1234')
    with monkeypatch.context() as patched:
        patched.setattr(AsyncSession, 'commit', boom)
        for name in ('fresh', 'kept'):
            with pytest.raises(RuntimeError):
                client.put(f'/factory/secrets/{name}', json={'value': 'brand-new-value'}, headers=HUMAN)
    assert not app.state.secrets_store.exists('forja/fresh')  # a new secret that was not indexed is not left behind
    assert app.state.secrets_store.get('forja/kept') == 'old-value-1234'  # a replacement that was not indexed puts the old value back
