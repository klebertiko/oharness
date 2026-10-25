# OHarness 05 — Repo Providers (GitHub / GitLab / Origin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Goal:** Provider-agnostic Git/PR (MR) flows: list, create, diff summary, review comment; adapters for GitHub, GitLab, Cursor Origin; wire into Agent Git panel and automation hooks.

**Architecture:** `RepoProvider` protocol in `backend/repos/base.py`. Adapters: `github.py`, `gitlab.py`, `origin.py` (Origin may raise `UnsupportedOnPlatform` on native Windows). In-memory `FakeRepoProvider` for tests. Frontend talks only to `/repos/*` API.

**Tech Stack:** httpx, pytest; optional `PyGithub` avoided — raw REST for fewer deps.

**Spec:** design §§2.1 Git/PR, 2.4 providers, Codex PR features

**Depends on:** Plans 03–04 (secrets + automations)

---

### Task 1: Port + fake

**Files:**
- Create: `backend/repos/base.py`
- Create: `backend/repos/fake.py`
- Create: `backend/tests/repos/test_fake_provider.py`

**Interfaces:**

```python
class RepoProvider(Protocol):
    async def list_pulls(self, repo: str, state: str = "open") -> list[PullSummary]: ...
    async def create_pull(self, repo: str, title: str, head: str, base: str, body: str) -> PullSummary: ...
    async def comment(self, repo: str, number: int, body: str) -> None: ...
    async def get_diff_stat(self, repo: str, number: int) -> DiffStat: ...
```

- [ ] **Step 1:** Fake implements all; tests pass

---

### Task 2: GitHub + GitLab adapters

**Files:**
- Create: `backend/repos/github.py`, `backend/repos/gitlab.py`
- Create: `backend/tests/repos/test_github_gitlab_adapters.py` (httpx mock transport)

- [ ] **Step 1:** Recorded fixture responses for list/create/comment
- [ ] **Step 2:** Tokens from SecretsStore by ref

---

### Task 3: Origin adapter

**Files:**
- Create: `backend/repos/origin.py`
- Create: `backend/tests/repos/test_origin_adapter.py`

- [ ] **Step 1:** If platform unsupported → structured error `code=origin_unsupported_platform`
- [ ] **Step 2:** Where CLI exists, wrap `origin`/`git` remote operations documented in skill; otherwise stub with clear error

---

### Task 4: API + Agent Git panel

**Files:**
- Create: `backend/routers/repos.py`
- Create: `frontend/src/components/git/GitPanel.tsx`
- Create: `frontend/src/lib/reposApi.ts`

- [ ] **Step 1:** Endpoints: `GET /repos/{provider}/pulls`, `POST .../pulls`, `POST .../pulls/{n}/comments`
- [ ] **Step 2:** GitPanel lists PRs/MRs; create form; comment box
- [ ] **Step 3:** Automation type `pr_watch` optional stub calling provider (full watch-fix loop can be thin: poll + enqueue Agent run)

---

## Plan 05 done when

- [ ] Fake + GitHub + GitLab adapter tests pass
- [ ] Origin returns explicit unsupported on Windows native in tests
- [ ] GitPanel works against Fake in dev (env `REPO_PROVIDER=fake`)
