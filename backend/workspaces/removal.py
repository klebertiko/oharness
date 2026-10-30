"""Two-phase worktree removal.

Phase 1, ``removal_check``: inspect the worktree (modified, staged, untracked, conflicted, ignored entries, commits that exist
only here, lock) and return the report together with a confirmation token bound to that exact state.

Phase 2, ``remove``: only with a token that still matches the state. If there is pending work it is preserved first on
``refs/openharness/rescue/<id>`` (a commit holding the index snapshot and the work tree, built with a scratch index so the user's
own index is never written); if preservation does not verify, nothing is removed. Deletion is our own link-safe ``remove_tree`` of
the worktree and of its administrative directory (``git worktree remove`` is not used: it walks the trees on its own schedule and
follows a link planted after our last scan), and never on the principal worktree, on a worktree the manager did not create, or on
a locked one unless the lock is released explicitly.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import WorkspaceError, scrub_paths
from .gitrun import GitFailure
from .gitstate import StatusReport, WorktreeEntry, parse_status_v2
from .links import LinkInfo, TreeScan, is_under, remove_tree, scan_tree, unlink_link
from .paths import ManagedRoot, canonical, is_link

TOKEN_TTL_S = 600
RESCUE_PREFIX = "refs/openharness/rescue/"
MAX_REPORTED_PATHS = 100
MAX_REPORTED_COMMITS = 20
NUL = bytes(1)
BACKSLASH = bytes([0x5C])
_EXPIRY = re.compile(r"^[0-9]{1,12}$")
_TOKEN_KEY = secrets.token_bytes(32)  # per process: a restart invalidates every outstanding confirmation, which is the safe direction
_IDENTITY = {
    "GIT_AUTHOR_NAME": "OpenHarness", "GIT_AUTHOR_EMAIL": "openharness@localhost",
    "GIT_COMMITTER_NAME": "OpenHarness", "GIT_COMMITTER_EMAIL": "openharness@localhost",
}


@dataclass
class InspectionState:
    entry: WorktreeEntry
    report: StatusReport
    status_raw: bytes
    stat: dict[str, list[int] | None]
    ignored: int
    unpushed: dict[str, Any]
    missing: bool
    nested: list[str] = field(default_factory=list)
    submodules: list[str] = field(default_factory=list)
    links: list[LinkInfo] = field(default_factory=list)
    admin_dir: str | None = None  # <common>/worktrees/<name>: git deletes it recursively on `worktree remove`
    admin_links: list[LinkInfo] = field(default_factory=list)
    fingerprint: str = field(default="")

    @property
    def dirty(self) -> bool:
        return self.report.dirty

    @property
    def pending(self) -> bool:
        return self.dirty or self.unpushed["count"] > 0


@dataclass
class OrphanState:
    path: str
    scan: TreeScan
    fingerprint: str


def _readlink(path: str) -> str:
    try:
        return os.readlink(path)
    except OSError:
        return "(unreadable)"


def rescue_pathspecs(links: list[LinkInfo]) -> bytes:
    """NUL-separated pathspecs for ``git add --all``: the whole tree, except every link (never followed, never embedded)."""
    return b"".join(entry.encode("utf-8", "surrogateescape") + NUL
                    for entry in [".", *(f":(exclude,literal){link.path}" for link in links)])


def _c_quote(rel: str) -> bytes:
    """C-style quoting git understands on ``hash-object --stdin-paths`` (so a newline in a name cannot split a record)."""
    out = bytearray(b'"')
    for byte in rel.encode("utf-8", "surrogateescape"):
        if byte in (0x22, 0x5C):
            out += BACKSLASH + bytes([byte])
        elif 0x20 <= byte < 0x7F:
            out.append(byte)
        else:
            out += BACKSLASH + b"%03o" % byte
    return bytes(out) + b'"'


def _invalid(reason: str) -> WorkspaceError:
    return WorkspaceError("confirmation_invalid", f"the removal confirmation is not valid ({reason}); check the workspace again", 409, reason=reason)


class RemovalMixin:
    # ------------------------------------------------------------------ inspection

    def _resolve_entry(self, ctx, workspace_id: str) -> tuple[WorktreeEntry, dict[str, Any]]:
        entries = self._worktrees(ctx)
        registry = self._registry(ctx, entries)
        for position, wt in enumerate(entries):
            info = self._describe(wt, position, registry, None, with_status=False)
            if info["id"] == workspace_id:
                return wt, info
        for info in self._orphans(ctx, entries):
            if info["id"] == workspace_id:
                return WorktreeEntry(path=info["path"], branch=None), info
        raise WorkspaceError("workspace_not_found", "no such workspace in this repository", 404)

    def _unpushed(self, ctx, entry: WorktreeEntry) -> dict[str, Any]:
        """Commits reachable from this worktree's HEAD and from no other branch, remote-tracking ref or tag."""
        own = entry.branch
        try:
            refs = self.runner.run(ctx.cwd, ["for-each-ref", "--format=%(objectname) %(objecttype) %(*objecttype) %(refname)",
                                             "refs/heads", "refs/remotes", "refs/tags"]).text().splitlines()
            others = set()
            for line in refs:
                sha, kind, peeled, name = (line.split(" ", 3) + ["", "", ""])[:4] if line.count(" ") >= 3 else (None, None, None, None)
                if sha is None or name == own:
                    continue
                if kind == "commit" or (kind == "tag" and peeled == "commit"):
                    others.add(sha)
            revs = (f"{entry.head}\n" + "".join(f"^{sha}\n" for sha in sorted(others))).encode()
            count = int(self.runner.run(ctx.cwd, ["rev-list", "--count", "--stdin"], input=revs).text().strip() or 0)
            commits: list[dict[str, str]] = []
            if count:
                listing = self.runner.run(ctx.cwd, ["log", "--stdin", f"--max-count={MAX_REPORTED_COMMITS}", "--no-show-signature",
                                                    "--no-color", "--format=%H%x09%s"], input=revs).text().splitlines()
                commits = [{"sha": sha, "subject": subject} for sha, _, subject in (row.partition("\t") for row in listing)]
            upstream = bool(own and self.runner.run(ctx.cwd, ["for-each-ref", "--format=%(upstream)", own]).text().strip())
        except (GitFailure, ValueError) as exc:
            raise WorkspaceError("inspection_failed", "could not determine which commits exist only in this worktree", 409) from exc
        branch = own[len("refs/heads/"):] if own and own.startswith("refs/heads/") else None
        return {"count": count, "branch": branch, "has_upstream": upstream, "commits": commits}

    def _admin_dir(self, ctx, entry: WorktreeEntry) -> str | None:
        """The worktree's administrative directory, found from the repository side (never through the worktree's own ``.git`` file,
        which a process in the workspace can rewrite): the one ``<common>/worktrees/*`` whose ``gitdir`` file names this worktree.
        None for the principal worktree (its ``.git`` is the repository itself). No match, or more than one, fails closed."""
        if canonical(entry.path) == canonical(ctx.common_dir.parent):
            return None
        base = os.path.join(os.fspath(ctx.common_dir), "worktrees")
        wanted = canonical(entry.path)
        found: list[str] = []
        try:
            if is_link(base):
                raise OSError("worktrees is a link")
            with os.scandir(base) as iterator:
                for item in iterator:
                    try:
                        if item.is_symlink() or is_link(item.path) or not item.is_dir(follow_symlinks=False):
                            continue
                        with open(os.path.join(item.path, "gitdir"), "rb") as handle:
                            pointer = handle.read(4096).decode("utf-8", "surrogateescape").strip()
                    except OSError:
                        continue
                    if pointer and canonical(os.path.dirname(pointer)) == wanted:
                        found.append(item.path)
        except OSError as exc:
            raise WorkspaceError("inspection_failed", "the worktree's administrative directory could not be read", 409) from exc
        if len(found) != 1:
            raise WorkspaceError("inspection_failed", "the worktree's administrative directory could not be identified, so it cannot be proven safe to remove", 409)
        return found[0]

    def _inspect(self, ctx, entry: WorktreeEntry, ident: str | None = None) -> dict[str, Any]:
        missing = not os.path.isdir(entry.path)
        admin = self._admin_dir(ctx, entry)
        admin_links = scan_tree(admin).links if admin else []  # the directory git deletes along with the worktree, scanned like it
        report, raw, stat, ignored, nested, submodules, links = StatusReport(), b"", {}, 0, [], [], []
        if not missing:
            links = scan_tree(entry.path).links  # first, and before git looks at the tree: the whole worktree, ignored entries too
            try:
                raw = self.runner.run(entry.path, ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--ignore-submodules=dirty"],
                                      filters=True).stdout
                report = parse_status_v2(raw)
                ignored_raw = self.runner.run(entry.path, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
                                              filters=True).stdout
                ignored = len([name for name in ignored_raw.split(b"\0") if name])
                for record in self.runner.run(entry.path, ["ls-files", "--stage", "-z"], filters=True).stdout.split(b"\0"):
                    mode, _, rest = record.partition(b" ")
                    rel = rest.partition(b"\t")[2].decode("utf-8", "surrogateescape")
                    if mode == b"160000" and rel and os.path.lexists(os.path.join(entry.path, rel, ".git")):
                        submodules.append(rel)
            except GitFailure as exc:
                raise WorkspaceError("inspection_failed", "git could not read the state of this worktree", 409) from exc
            for rel, code in report.paths.items():
                full = os.path.join(entry.path, rel)
                if is_under(rel, links):
                    stat[rel] = None  # a path reached through a link is not this worktree's own content: never stat'ed, never followed
                    continue
                try:
                    st = os.lstat(full)
                    stat[rel] = [st.st_size, st.st_mtime_ns]
                except OSError:
                    stat[rel] = None
                if code == "?" and os.path.isdir(full) and not is_link(full):
                    nested.append(rel)  # an untracked directory git lists as one entry is a repository of its own
        state = InspectionState(entry=entry, report=report, status_raw=raw, stat=stat, ignored=ignored,
                                unpushed=self._unpushed(ctx, entry), missing=missing,
                                nested=nested, submodules=submodules, links=links, admin_dir=admin, admin_links=admin_links)
        state.fingerprint = hashlib.sha256(json.dumps({
            "head": entry.head, "branch": entry.branch, "locked": entry.locked, "reason": entry.lock_reason,
            "status": hashlib.sha256(raw).hexdigest(), "stat": sorted(stat.items()), "ignored": ignored,
            "links": [[link.path, link.target, link.kind] for link in links],
            "admin_links": [[link.path, link.target, link.kind] for link in admin_links],
            "unpushed": [state.unpushed["count"], [c["sha"] for c in state.unpushed["commits"]]],
        }, sort_keys=True).encode("utf-8")).hexdigest()
        return {"state": state}

    # ------------------------------------------------------------------ tokens

    @staticmethod
    def _mac(expiry: int, repo_key: str, ident: str, fingerprint: str) -> str:
        return hmac.new(_TOKEN_KEY, f"{expiry}|{repo_key}|{ident}|{fingerprint}".encode("utf-8"), hashlib.sha256).hexdigest()

    def _issue_token(self, ctx, ident: str, state: InspectionState) -> str:
        expiry = int(time.time()) + TOKEN_TTL_S
        return f"{expiry}.{self._mac(expiry, ctx.key, ident, state.fingerprint)}"

    def _verify_token(self, token: str, ctx, ident: str, state: InspectionState) -> None:
        head, dot, mac = (token or "").partition(".")
        if not dot or not _EXPIRY.match(head) or not mac:
            raise _invalid("malformed")
        if time.time() > int(head):
            raise _invalid("expired")
        if not hmac.compare_digest(mac, self._mac(int(head), ctx.key, ident, state.fingerprint)):
            raise _invalid("stale")

    # ------------------------------------------------------------------ phase 1

    def _rescue_ref_for(self, ctx, ident: str) -> str:
        for n in range(1, 50):
            ref = RESCUE_PREFIX + (ident if n == 1 else f"{ident}-{n}")
            if self.runner.run(ctx.cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", ref], check=False).returncode != 0:
                return ref
        raise WorkspaceError("preservation_failed", "too many rescue refs exist for this workspace", 409)

    def _blockers(self, info: dict[str, Any], state: InspectionState | None = None) -> list[str]:
        blockers = []
        if info["kind"] == "main":
            blockers.append("principal")
        elif not info["managed"]:
            blockers.append("not_managed")
        if state is not None and info["kind"] != "main":
            # Neither can be carried by a rescue commit (a gitlink/embedded repo keeps only a pointer, not its history or edits).
            if state.submodules:
                blockers.append("submodules")
            if state.nested:
                blockers.append("nested_repository")
        return blockers

    def removal_check(self, repo: str, workspace_id: str) -> dict[str, Any]:
        ctx = self._open(repo)
        with self._locked(ctx):
            entry, info = self._resolve_entry(ctx, workspace_id)
            if info["orphaned"]:
                return self._orphan_check(ctx, workspace_id, info)
            state = self._inspect(ctx, entry)["state"]
            blockers = self._blockers(info, state)
            report = state.report
            paths = [{"path": p, "code": c} for p, c in list(report.paths.items())[:MAX_REPORTED_PATHS]]
            removable = not blockers
            return {
                "workspace": info, "removable": removable, "blockers": blockers,
                "changes": {"modified": report.modified, "staged": report.staged, "untracked": report.untracked,
                            "conflicted": report.conflicted, "ignored_entries": state.ignored, "paths": paths,
                            "paths_truncated": len(report.paths) > MAX_REPORTED_PATHS},
                "links": [link.as_dict() for link in state.links],
                "admin_links": [link.as_dict() for link in state.admin_links],
                "unpushed": state.unpushed, "locked": entry.locked, "lock_reason": entry.lock_reason,
                "needs_lock_release": entry.locked, "missing": state.missing,
                "pending_work": state.pending, "will_preserve": removable and state.pending,
                "rescue_ref": self._rescue_ref_for(ctx, workspace_id) if removable and state.pending else None,
                "confirmation_token": self._issue_token(ctx, workspace_id, state) if removable else None,
                "expires_in": TOKEN_TTL_S if removable else None,
            }

    # ------------------------------------------------------------------ phase 2

    def _assert_unlinked(self, path: str) -> None:
        """No link anywhere between the managed root and the worktree directory: git must not be pointed through one."""
        root = ManagedRoot(self.settings.managed_root).path
        current = Path(os.path.abspath(path))
        while canonical(current) != canonical(root) and current != current.parent:
            if is_link(current):
                raise WorkspaceError("unsafe_destination", "a link sits on the path of this workspace; refusing to follow it", 409)
            current = current.parent

    @staticmethod
    def _links_now(entry: WorktreeEntry, state: InspectionState) -> list[LinkInfo]:
        """Every link in the worktree and its administrative directory right now (all of them were undone, so any is new)."""
        found: list[LinkInfo] = []
        if os.path.isdir(entry.path):
            found += scan_tree(entry.path).links
        if state.admin_dir:
            found += [LinkInfo(f"(admin)/{link.path}", link.target, link.kind, link.is_dir) for link in scan_tree(state.admin_dir).links]
        return found

    def _delete_worktree(self, ctx, entry: WorktreeEntry, state: InspectionState) -> None:
        """Delete the worktree directory and its administrative directory ourselves, link-safe, instead of letting git do it.

        ``git worktree remove`` walks both trees on its own schedule, so a link planted between our last scan and its walk was followed
        (measured: external data lost in 6 of 60 and 5 of 60 trials against a planter toggling a junction every 0.5-20 ms).
        ``remove_tree`` looks at every entry again when it reaches it and undoes a link as a link. Deleting the administrative
        directory is also what makes git forget the worktree; nothing else of the repository is touched (no ``worktree prune``,
        which would drop other worktrees' stale entries).
        """
        failure: OSError | None = None
        try:
            remove_tree(entry.path)
        except OSError as exc:  # e.g. a file another process holds open (Windows): git forgets the worktree anyway, as `worktree remove` did,
            failure = exc       # and what is left is an `orphaned` workspace the manager finishes with the same two phases
        if state.admin_dir:
            if self._admin_dir(ctx, entry) != state.admin_dir:  # still the very directory that was inspected, found from the repository side
                raise WorkspaceError("unsafe_destination", "the worktree's administrative directory changed during removal; it was left alone", 409)
            remove_tree(state.admin_dir)
        if failure:
            raise failure

    def remove(self, repo: str, workspace_id: str, token: str, release_lock: bool = False) -> dict[str, Any]:
        ctx = self._open(repo)
        with self._locked(ctx):
            entry, info = self._resolve_entry(ctx, workspace_id)
            if info["orphaned"]:
                return self._orphan_remove(ctx, workspace_id, info, token)
            if self._blockers(info):
                raise WorkspaceError("protected_workspace", "this workspace is not one the manager created and may not be removed", 403,
                                     blockers=self._blockers(info))
            self._assert_unlinked(entry.path)
            state = self._inspect(ctx, entry)["state"]
            if self._blockers(info, state):
                raise WorkspaceError("protected_workspace", "this workspace holds content a rescue cannot preserve; remove it by hand", 403,
                                     blockers=self._blockers(info, state))
            self._verify_token(token, ctx, workspace_id, state)
            if entry.locked and not release_lock:
                raise WorkspaceError("workspace_locked", "the workspace is locked; release the lock explicitly to remove it", 409,
                                     lock_reason=entry.lock_reason)
            rescue = None
            if state.pending:
                rescue = self._create_rescue(ctx, entry, state, workspace_id)
                if self._inspect(ctx, entry)["state"].fingerprint != state.fingerprint:
                    self.runner.run(ctx.cwd, ["update-ref", "-d", rescue["ref"]], check=False)
                    raise _invalid("stale")
            # Only now, with the rescue proven, are the links undone: each as the link itself, so git never meets one to follow.
            for link in state.links:
                unlink_link(entry.path, link)
            for link in state.admin_links:
                unlink_link(state.admin_dir, link)
            unlocked = False
            if entry.locked:
                self.runner.run(ctx.cwd, ["worktree", "unlock", "--", entry.path])
                unlocked = True

            def relock() -> None:
                if unlocked:
                    reason = ["--reason", entry.lock_reason] if entry.lock_reason else []
                    self.runner.run(ctx.cwd, ["worktree", "lock", *reason, "--", entry.path], check=False)

            # The last look, immediately before git walks the tree: nothing may have become a link since the scan that was confirmed.
            try:
                late = self._links_now(entry, state)
            except WorkspaceError:
                relock()
                raise
            if late:
                relock()
                if rescue:
                    self.runner.run(ctx.cwd, ["update-ref", "-d", rescue["ref"]], check=False)  # the work is still in the worktree
                raise WorkspaceError("unsafe_destination", "a link appeared in the workspace just before removal; nothing was removed", 409,
                                     links=[link.as_dict() for link in late])
            try:
                self._delete_worktree(ctx, entry, state)
            except WorkspaceError:
                relock()
                raise
            except OSError as exc:
                relock()
                raise WorkspaceError("remove_failed", "the workspace could not be fully removed", 409, detail=scrub_paths(str(exc))[:300],
                                     rescue=rescue) from exc

            def forget(data):
                data["workspaces"].get(ctx.key, {}).pop(workspace_id, None)
                chosen = data["selected"]
                if chosen and chosen.get("repo_key") == ctx.key and chosen.get("id") == workspace_id:
                    data["selected"] = None
            self.store.mutate(forget)
            branch = info["branch"]
            return {"removed": True, "id": workspace_id, "path": info["path"], "rescue": rescue, "branch_kept": branch,
                    "links": [link.as_dict() for link in state.links], "admin_links": [link.as_dict() for link in state.admin_links]}

    # ------------------------------------------------------------------ orphaned workspaces

    def _orphan_state(self, ctx, info: dict[str, Any]) -> OrphanState:
        """What is left on disk of a workspace git no longer knows. Read without git and without following any link."""
        root = os.path.normcase(os.path.normpath(os.fspath(ManagedRoot(self.settings.managed_root).path)))
        path = os.path.normpath(info["path"])
        if not os.path.normcase(path).startswith(root + os.sep):
            raise WorkspaceError("unsafe_destination", "this directory is not under the managed root; refusing to clean it", 409)
        scan = scan_tree(path, digest=True) if not is_link(path) else TreeScan(links=[LinkInfo("", _readlink(path), "link", True)], digest="link")
        return OrphanState(path=path, scan=scan, fingerprint=hashlib.sha256(f"orphan|{scan.digest}".encode("utf-8")).hexdigest())

    def _orphan_check(self, ctx, workspace_id: str, info: dict[str, Any]) -> dict[str, Any]:
        state = self._orphan_state(ctx, info)
        rescues = self.runner.run(ctx.cwd, ["for-each-ref", "--format=%(refname)", f"{RESCUE_PREFIX}{workspace_id}",
                                            f"{RESCUE_PREFIX}{workspace_id}-*"], check=False).text().split()
        return {
            "workspace": info, "orphaned": True, "removable": True, "blockers": [],
            "leftover": {"entries": state.scan.entries, "paths": state.scan.sample, "paths_truncated": state.scan.entries > len(state.scan.sample)},
            "links": [link.as_dict() for link in state.scan.links], "rescue_refs": rescues,
            "note": "git no longer lists this workspace; what remains in its directory is deleted without following links. "
                    "Any rescue ref listed was made before the removal started.",
            "locked": False, "lock_reason": "", "needs_lock_release": False, "missing": False, "pending_work": False, "will_preserve": False,
            "rescue_ref": None, "unpushed": {"count": 0, "branch": info.get("branch"), "has_upstream": False, "commits": []},
            "confirmation_token": self._issue_token(ctx, workspace_id, state), "expires_in": TOKEN_TTL_S,
        }

    def _orphan_remove(self, ctx, workspace_id: str, info: dict[str, Any], token: str) -> dict[str, Any]:
        state = self._orphan_state(ctx, info)
        self._verify_token(token, ctx, workspace_id, state)
        try:
            for link in state.scan.links:
                if link.path:
                    unlink_link(state.path, link)
            remove_tree(state.path)
        except OSError as exc:
            raise WorkspaceError("remove_failed", "the leftover directory could not be fully removed", 409, detail=scrub_paths(str(exc))[:300]) from exc

        def forget(data):
            data["workspaces"].get(ctx.key, {}).pop(workspace_id, None)
            chosen = data["selected"]
            if chosen and chosen.get("repo_key") == ctx.key and chosen.get("id") == workspace_id:
                data["selected"] = None
        self.store.mutate(forget)
        return {"removed": True, "id": workspace_id, "path": info["path"], "rescue": None, "branch_kept": info.get("branch"),
                "orphaned": True, "links": [link.as_dict() for link in state.scan.links]}

    # ------------------------------------------------------------------ preservation

    def _create_rescue(self, ctx, entry: WorktreeEntry, state: InspectionState, ident: str) -> dict[str, Any]:
        """Put everything pending on ``refs/openharness/rescue/<id>`` and prove it is there, or raise ``preservation_failed``.

        The index snapshot and the work tree each become a commit built from a COPY of the index, so the user's own index and
        files are only read. Attributes are taken from the empty tree and autocrlf is off, so the stored bytes are the bytes on disk.
        """
        ref = self._rescue_ref_for(ctx, ident)
        commit = entry.head
        staged_commit = None
        created = False
        try:
            if state.dirty:
                commit, staged_commit = self._snapshot(ctx, entry, ident, state.links)
            zero = "0" * len(commit)
            self.runner.run(ctx.cwd, ["update-ref", "--no-deref", ref, commit, zero])
            created = True
            verified = self._verify_rescue(ctx, ref, commit, staged_commit, entry, state)
        except (GitFailure, OSError, WorkspaceError) as exc:
            if created:
                self.runner.run(ctx.cwd, ["update-ref", "-d", ref], check=False)
            if isinstance(exc, WorkspaceError) and exc.code == "preservation_failed":
                raise
            raise WorkspaceError("preservation_failed", "pending work could not be preserved; nothing was removed", 409,
                                 detail=scrub_paths(str(exc))[:300]) from exc
        return {"ref": ref, "commit": commit, "verified_paths": verified, "recover": [
            f"git branch recovered/{ident} {ref}",
            f"git worktree add <new-directory> {ref}",
            f"git diff {entry.head} {ref}",
        ]}

    def _snapshot(self, ctx, entry: WorktreeEntry, ident: str, links: list[LinkInfo] | None = None) -> tuple[str, str | None]:
        run, cwd = self.runner.run, Path(entry.path)
        empty_tree = run(cwd, ["hash-object", "-t", "tree", "--stdin"], input=b"").text().strip()
        base_env = {**_IDENTITY, "GIT_ATTR_SOURCE": empty_tree}
        source_index = Path(run(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).text().strip())
        head_tree = run(cwd, ["rev-parse", f"{entry.head}^{{tree}}"]).text().strip()
        self.settings.tmp_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=self.settings.tmp_dir) as scratch:
            def scratch_env(name: str) -> dict[str, str]:
                target = Path(scratch) / name
                if source_index.is_file():
                    shutil.copy2(source_index, target)  # same mtime: git trusts an entry as clean only if older than its index (racy-git)
                else:
                    run(cwd, ["read-tree", entry.head], env={"GIT_INDEX_FILE": str(target)})
                return {**base_env, "GIT_INDEX_FILE": str(target)}

            links = links or []
            listing = "\n".join(f"  {json.dumps(link.path, ensure_ascii=False)} -> {json.dumps(link.target, ensure_ascii=False)}" for link in links)
            note = f"\n\nlinks found and not followed (left out of this rescue; name -> target):\n{listing}" if links else ""
            parent, staged_commit = entry.head, None
            staged_env = scratch_env("staged")
            staged = run(cwd, ["write-tree"], env=staged_env, check=False)  # fails with unmerged entries: then only the work tree is kept
            if staged.returncode == 0 and staged.text().strip() != head_tree:
                staged_commit = run(cwd, ["commit-tree", staged.text().strip(), "-p", entry.head, "-m",
                                          f"openharness rescue {ident}: index snapshot{note}"], env=staged_env).text().strip()
                parent = staged_commit
            work_env = scratch_env("worktree")
            # A link git already ignores (inside an ignored directory) is never added, and naming it in a pathspec makes `add` fail;
            # only the links `add --all` could walk into need the exclusion.
            asked = NUL.join(link.path.encode("utf-8", "surrogateescape") for link in links)
            skipped = {n.decode("utf-8", "surrogateescape") for n in
                       run(cwd, ["check-ignore", "-z", "--stdin"], input=asked, check=False, filters=True).stdout.split(NUL) if n} if links else set()
            run(cwd, ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "add", "--all", "--pathspec-from-file=-", "--pathspec-file-nul"],
                input=rescue_pathspecs([link for link in links if link.path not in skipped]), env=work_env, filters=True, timeout=600)
            tree = run(cwd, ["write-tree"], env=work_env).text().strip()
            commit = run(cwd, ["commit-tree", tree, "-p", parent, "-m", f"openharness rescue {ident}: work tree{note}"], env=work_env).text().strip()
        return commit, staged_commit

    def _verify_rescue(self, ctx, ref: str, commit: str, staged_commit: str | None, entry: WorktreeEntry, state: InspectionState) -> int:
        """Re-read the rescue from git and prove it: every changed file still on disk is in it with the very bytes on disk,
        and nothing that sits behind a link got in."""
        run = self.runner.run
        stored = run(ctx.cwd, ["rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}"]).text().strip()
        if stored != commit:
            raise WorkspaceError("preservation_failed", "the rescue ref does not point at the rescue commit", 409)
        if not state.dirty:
            return 0

        def blobs(rev: str) -> dict[str, str]:
            found: dict[str, str] = {}
            for row in run(ctx.cwd, ["ls-tree", "-r", "-z", rev]).stdout.split(b"\0"):
                meta, _, name = row.partition(b"\t")
                parts = meta.split(b" ")
                if name and len(parts) == 3:
                    found[name.decode("utf-8", "surrogateescape")] = parts[2].decode("ascii", "replace")
            return found

        in_work, in_index = blobs(commit), blobs(staged_commit) if staged_commit else {}
        if state.links:
            tracked = {n.decode("utf-8", "surrogateescape") for n in run(entry.path, ["ls-files", "-z", "--cached"], filters=True).stdout.split(b"\0") if n}
            for name in in_work:
                if is_under(name, state.links) and name not in tracked:
                    raise WorkspaceError("preservation_failed", f"{name!r} lives behind a link and must not be in the rescue; nothing was removed", 409)
        checked: list[str] = []
        for rel, code in state.report.paths.items():
            if is_under(rel, state.links):
                continue  # recorded in the report and the rescue message, never read
            full = os.path.join(entry.path, rel)
            if os.path.lexists(full) and not (os.path.isdir(full) and not is_link(full)):
                if rel not in in_work:
                    raise WorkspaceError("preservation_failed", f"{rel!r} is not in the rescue; nothing was removed", 409)
                checked.append(rel)
            elif code[:1] in ("A", "M", "R", "C") and staged_commit:
                if rel not in in_index:
                    raise WorkspaceError("preservation_failed", f"staged {rel!r} is not in the rescue; nothing was removed", 409)
        if checked:
            # git's own hash of the bytes on disk (no filters, no line-ending conversion) against the blob the rescue holds.
            lines = b"\n".join(_c_quote(rel) for rel in checked) + b"\n"
            hashed = run(entry.path, ["hash-object", "--no-filters", "--stdin-paths"], input=lines).stdout.decode("ascii", "replace").split()
            if len(hashed) != len(checked):
                raise WorkspaceError("preservation_failed", "the bytes of the preserved files could not be re-read; nothing was removed", 409)
            for rel, oid in zip(checked, hashed):
                if in_work[rel] != oid:
                    raise WorkspaceError("preservation_failed", f"{rel!r} differs from the bytes on disk; nothing was removed", 409)
        return len(checked)
