"""#163: per-turn file diff and per-file revert."""
import hashlib
import json
import os
import sys

import pytest
from fastapi.testclient import TestClient

from adapters.base import AgentAdapter
from main import app
from sandbox.turn_diff import (RevertRefused, TURN_DIFF_RULES, compute_changes, revert_file, snapshot)


def write(root, rel, data):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else data.encode())
    return path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def changes(root, mutate):
    before = snapshot(root)
    mutate()
    return {c.path: c for c in compute_changes(before, snapshot(root))}


# -- detection ---------------------------------------------------------------
def test_added_modified_deleted_are_listed_with_line_counts(tmp_path):
    write(tmp_path, 'a.txt', 'one\ntwo\n')
    write(tmp_path, 'b.txt', 'keep\n')
    write(tmp_path, 'c.txt', 'gone\n')

    def mutate():
        write(tmp_path, 'a.txt', 'one\nTWO\nthree\n')
        write(tmp_path, 'new/d.txt', 'fresh\n')
        (tmp_path / 'c.txt').unlink()
    result = changes(tmp_path, mutate)
    assert set(result) == {'a.txt', 'new/d.txt', 'c.txt'}
    assert (result['a.txt'].status, result['a.txt'].added, result['a.txt'].removed) == ('modified', 2, 1)
    assert result['new/d.txt'].status == 'added' and result['c.txt'].status == 'deleted'
    assert '-two' in result['a.txt'].diff and '+TWO' in result['a.txt'].diff


def test_unchanged_files_and_ignored_dirs_are_not_listed(tmp_path):
    write(tmp_path, 'same.txt', 'x')
    result = changes(tmp_path, lambda: write(tmp_path, 'node_modules/p/i.js', 'x') and write(tmp_path, '.git/HEAD', 'y'))
    assert result == {}


def test_binary_files_are_listed_without_diff_and_are_not_revertible(tmp_path):
    write(tmp_path, 'img.bin', b'\x00\x01\x02old')
    result = changes(tmp_path, lambda: write(tmp_path, 'img.bin', b'\x00\x01\x02new'))
    c = result['img.bin']
    assert c.binary and c.diff == '' and not c.revertible


def test_large_text_file_is_listed_but_not_revertible(tmp_path):
    big = 'a' * (TURN_DIFF_RULES['max_file_bytes'] + 10)
    write(tmp_path, 'big.txt', big)
    c = changes(tmp_path, lambda: write(tmp_path, 'big.txt', big + 'b'))['big.txt']
    assert not c.revertible and c.diff == ''


def test_secret_named_files_are_never_tracked(tmp_path):
    write(tmp_path, '.env', 'A=1')
    assert changes(tmp_path, lambda: write(tmp_path, '.env', 'A=2')) == {}


def test_symlinks_are_not_followed_or_tracked(tmp_path):
    outside = tmp_path.parent / (tmp_path.name + '-outside')
    outside.mkdir()
    write(outside, 'f.txt', 'secret-ish')
    root = tmp_path / 'ws'
    root.mkdir()
    os.symlink(outside, root / 'link')
    os.symlink(outside / 'f.txt', root / 'file-link')
    assert changes(root, lambda: write(outside, 'f.txt', 'changed')) == {}


# -- revert -------------------------------------------------------------------
def test_revert_one_file_leaves_the_others_alone(tmp_path):
    write(tmp_path, 'a.txt', 'A0\r\nline\r\n')
    write(tmp_path, 'b.txt', 'B0')

    def mutate():
        write(tmp_path, 'a.txt', 'A1')
        write(tmp_path, 'b.txt', 'B1')
    result = changes(tmp_path, mutate)
    a = result['a.txt']
    revert_file(tmp_path, a.path, a.status, a.before, a.after_sha)
    assert (tmp_path / 'a.txt').read_bytes() == b'A0\r\nline\r\n'  # byte-exact, CRLF kept
    assert (tmp_path / 'b.txt').read_text() == 'B1'


def test_revert_added_deletes_and_revert_deleted_recreates_in_new_dirs(tmp_path):
    write(tmp_path, 'deep/x/gone.txt', 'was here')

    def mutate():
        (tmp_path / 'deep/x/gone.txt').unlink()
        (tmp_path / 'deep/x').rmdir()
        write(tmp_path, 'added.txt', 'new')
    result = changes(tmp_path, mutate)
    g, a = result['deep/x/gone.txt'], result['added.txt']
    revert_file(tmp_path, g.path, g.status, g.before, g.after_sha)
    revert_file(tmp_path, a.path, a.status, a.before, a.after_sha)
    assert (tmp_path / 'deep/x/gone.txt').read_text() == 'was here' and not (tmp_path / 'added.txt').exists()


def test_revert_refuses_when_the_file_changed_after_the_turn(tmp_path):
    write(tmp_path, 'a.txt', 'A0')
    a = changes(tmp_path, lambda: write(tmp_path, 'a.txt', 'A1'))['a.txt']
    write(tmp_path, 'a.txt', 'edited by the person afterwards')
    with pytest.raises(RevertRefused) as err:
        revert_file(tmp_path, a.path, a.status, a.before, a.after_sha)
    assert err.value.code == 'changed_since'
    assert (tmp_path / 'a.txt').read_text() == 'edited by the person afterwards'


@pytest.mark.parametrize('bad', ['../escape.txt', '/etc/passwd', 'a/../../escape.txt', 'C:\\Windows\\x', '', 'a\0b'])
def test_revert_refuses_paths_outside_the_workspace(tmp_path, bad):
    root = tmp_path / 'ws'
    root.mkdir()
    with pytest.raises(RevertRefused) as err:
        revert_file(root, bad, 'added', None, sha(b'x'))
    assert err.value.code == 'path_escapes_root'


def test_revert_refuses_to_write_through_a_symlinked_directory(tmp_path):
    outside = tmp_path / 'outside'
    outside.mkdir()
    victim = write(outside, 'f.txt', 'precious')
    root = tmp_path / 'ws'
    root.mkdir()
    os.symlink(outside, root / 'link')
    with pytest.raises(RevertRefused) as err:
        revert_file(root, 'link/f.txt', 'added', None, sha(b'precious'))
    assert err.value.code == 'symlink_refused'
    with pytest.raises(RevertRefused):
        revert_file(root, 'link/new.txt', 'deleted', b'planted', None)
    assert victim.read_text() == 'precious' and not (outside / 'new.txt').exists()


def test_revert_refuses_a_symlinked_file_target(tmp_path):
    outside = write(tmp_path, 'outside.txt', 'precious')
    root = tmp_path / 'ws'
    root.mkdir()
    os.symlink(outside, root / 'f.txt')
    with pytest.raises(RevertRefused):
        revert_file(root, 'f.txt', 'modified', b'old', sha(b'precious'))
    assert outside.read_text() == 'precious'


# -- API ----------------------------------------------------------------------
class _Editor(AgentAdapter):
    """A provider whose turn edits the workspace (stands in for a CLI agent or a command)."""
    root = None

    async def invoke(self, prompt, config):
        raise AssertionError

    async def stream(self, prompt, config):
        yield 'x'

    async def stream_events(self, prompt, config):
        write(self.root, 'a.txt', 'A1\n')
        write(self.root, 'b.txt', 'B1\n')
        yield {'kind': 'text', 'text': 'edited'}


def _sse(text):
    out = []
    for block in text.split('\n\n'):
        lines = block.splitlines()
        if len(lines) >= 2 and lines[0].startswith('event: '):
            out.append((lines[0][7:], json.loads(lines[1][6:])))
    return out


@pytest.fixture()
def env(tmp_path, monkeypatch):
    write(tmp_path, 'a.txt', 'A0\n')
    write(tmp_path, 'b.txt', 'B0\n')
    adapter = _Editor()
    adapter.root = tmp_path
    monkeypatch.setattr('providers.resolution.get_adapter', lambda name: adapter)
    monkeypatch.setattr('routers.execution.get_adapter', lambda name: adapter)
    connections = {'local': {'id': 'local', 'provider': 'ollama', 'label': 'Local', 'residence': 'local',
                             'endpoint': 'http://127.0.0.1:11434/v1', 'enabled': True, 'secretRef': None}}
    with TestClient(app) as client:
        app.state.provider_connections = connections
        client.post('/cowork/projects', json={'name': 'Diff', 'rootPath': str(tmp_path)})
        yield client, tmp_path


def run_turn(client, root):
    resp = client.post('/execute/direct', json={'instruction': 'edit', 'mode': 'live', 'connection_id': 'local',
                                                'model': 'm', 'cwd': str(root)})
    assert resp.status_code == 200
    return resp, dict(_sse(resp.text))


def test_turn_that_edited_files_lists_them_and_journals_the_event(env):
    client, root = env
    resp, events = run_turn(client, root)
    files = {f['path']: f for f in events['turn_diff']['files']}
    assert set(files) == {'a.txt', 'b.txt'} and files['a.txt']['revertible'] and '+A1' in files['a.txt']['diff']
    rows = client.get(f"/execute/logs/{resp.headers['X-Execution-Id']}/events").json()
    rows = rows['events'] if isinstance(rows, dict) else rows
    assert any(r['event'] == 'turn_diff' for r in rows)


def test_turn_without_edits_emits_no_diff(env):
    client, root = env
    adapter = _Editor()
    adapter.root = root
    write(root, 'a.txt', 'A1\n')
    write(root, 'b.txt', 'B1\n')  # the edit is already there: nothing changes during the turn
    _, events = run_turn(client, root)
    assert 'turn_diff' not in events


def test_revert_restores_one_file_only_and_is_one_shot(env):
    client, root = env
    resp, _ = run_turn(client, root)
    run_id = resp.headers['X-Execution-Id']
    ok = client.post(f'/execute/{run_id}/turn-diff/revert', json={'path': 'a.txt'})
    assert ok.status_code == 200 and ok.json() == {'path': 'a.txt', 'status': 'reverted'}
    assert (root / 'a.txt').read_text() == 'A0\n' and (root / 'b.txt').read_text() == 'B1\n'
    assert client.post(f'/execute/{run_id}/turn-diff/revert', json={'path': 'a.txt'}).status_code == 409


def test_revert_rejects_unknown_paths_and_unknown_runs(env):
    client, root = env
    resp, _ = run_turn(client, root)
    run_id = resp.headers['X-Execution-Id']
    assert client.post(f'/execute/{run_id}/turn-diff/revert', json={'path': 'nope.txt'}).status_code == 404
    assert client.post(f'/execute/{run_id}/turn-diff/revert', json={'path': '../x'}).status_code == 404
    assert client.post('/execute/missing-run/turn-diff/revert', json={'path': 'a.txt'}).status_code == 404
    assert client.post(f'/execute/{run_id}/turn-diff/revert', json={}).status_code == 400
