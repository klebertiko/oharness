"""A link planted WHILE a removal runs must never reach data outside the workspace.

The earlier design handed the last step to ``git worktree remove``, which walks the tree on its own schedule: a planter that toggles a
junction every few milliseconds got through in roughly one trial in ten (measured 6/60 in the worktree, 5/60 in its administrative
directory). The tree is now deleted by ``remove_tree``, which looks at each entry again when it reaches it.
"""
from __future__ import annotations

import os
import random
import threading
import time
from pathlib import Path

import pytest

from workspaces.errors import WorkspaceError
from workspaces_support import make_dir_link, remove_dir_link

TRIALS = int(os.environ.get("OH_RACE_TRIALS", "24"))


class Planter(threading.Thread):
    """Toggles a directory link at ``where`` -> ``target`` with random on/off times, until stopped."""

    def __init__(self, where: Path, target: Path, seed: int):
        super().__init__(daemon=True)
        self.where, self.target, self.stop_flag = where, target, threading.Event()
        rng = random.Random(seed)
        self.on, self.off = rng.uniform(0.0005, 0.02), rng.uniform(0.0005, 0.02)

    def run(self):
        while not self.stop_flag.is_set():
            try:
                make_dir_link(self.where, self.target)
            except (OSError, pytest.skip.Exception):
                pass  # the toggler races the service on purpose; losing a toggle (or no link support) is expected
            time.sleep(self.on)
            try:
                remove_dir_link(self.where)
            except OSError:
                pass  # the link may already be gone: the service removed it first, which is the race under test
            time.sleep(self.off)

    def finish(self):
        self.stop_flag.set()
        self.join(5)
        try:
            remove_dir_link(self.where)
        except OSError:
            pass  # cleanup only: nothing to remove if the last toggle left no link


@pytest.mark.parametrize("place", ["worktree", "admin"])
def test_a_link_toggled_during_removal_never_touches_the_outside(svc, repo, outside, place):
    for trial in range(TRIALS):
        branch = f"race-{place}-{trial}"
        made = svc.create(str(repo.path), "main", branch=branch)
        path = Path(made["path"])
        if trial % 2:
            (path / "dirty.txt").write_text("work\n", encoding="utf-8")
        if place == "worktree":
            (path / "node_modules").mkdir()
            (path / "node_modules" / "p.txt").write_text("p\n", encoding="utf-8")
            where = path / "node_modules" / "late"
        else:
            where = Path(repo.out("rev-parse", "--absolute-git-dir", cwd=path)) / "linked"
        report = svc.removal_check(str(repo.path), made["id"])
        planter = Planter(where, outside.path, seed=trial)
        planter.start()
        try:
            svc.remove(str(repo.path), made["id"], report["confirmation_token"])
        except WorkspaceError:
            pass  # stale / unsafe_destination / remove_failed are all acceptable: the outside is what is being protected
        finally:
            planter.finish()
        outside.assert_intact()
