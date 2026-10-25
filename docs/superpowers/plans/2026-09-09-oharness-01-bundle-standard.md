# OHarness 01 — Bundle Standard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the `.oharness` JSON Schema, ship `oharness validate`, compile the skills-framework Agile harness into the product default bundle, and expose backend validate + mock dry-run APIs.

**Architecture:** A pure Python package `backend/oharness/` owns schema load, validate, and mock planning. A small CLI `python -m oharness` wraps validate. The skills-framework harness folder is compiled by a script into `backend/oharness/fixtures/default-agile.oharness`. FastAPI routes thin-wrap the library. Frontend types mirror the schema for Studio later (plan 02).

**Tech Stack:** Python 3.11+, pydantic v2, jsonschema, pytest, FastAPI; Node only for renaming `package.json`.

**Spec:** `docs/superpowers/specs/2026-09-09-oharness-design.md` §§1, 4 (dogfood), 5–6

## Global Constraints

See master plan. This plan must not wire Tauri, Agent UI, or RepoProviders.

---

### Task 1: Schema + pydantic models

**Files:**
- Create: `backend/oharness/__init__.py`
- Create: `backend/oharness/schema/oharness.schema.json`
- Create: `backend/oharness/models.py`
- Create: `backend/tests/oharness/test_schema_models.py`
- Modify: `backend/requirements.txt` (add `jsonschema==4.23.0`, `pytest==8.3.4`)

**Interfaces:**
- Produces: `HarnessBundle` pydantic model; `SCHEMA_PATH`; `SCHEMA_VERSION = "1.0.0"`
- Consumes: nothing

- [ ] **Step 1: Add pytest + jsonschema deps**

Append to `backend/requirements.txt`:

```
jsonschema==4.23.0
pytest==8.3.4
```

Run: `cd D:\Development\src\OHarness\backend && pip install -r requirements.txt`

- [ ] **Step 2: Write failing test for minimal valid bundle**

```python
# backend/tests/oharness/test_schema_models.py
from oharness.models import HarnessBundle, SCHEMA_VERSION

def test_minimal_bundle_parses():
    raw = {
        "schemaVersion": SCHEMA_VERSION,
        "manifest": {
            "id": "hello",
            "name": "Hello",
            "version": "0.1.0",
            "description": "min",
            "license": "MIT",
            "tags": [],
        },
        "graph": {"nodes": [], "edges": []},
        "content": {
            "prompts": {},
            "agents": {},
            "skills": {},
            "hooks": {},
            "commands": {},
            "scripts": {},
        },
        "runtime": {"preferred": "api", "cli": None, "env": [], "secrets": []},
        "validation": {"mockProfile": "default"},
    }
    bundle = HarnessBundle.model_validate(raw)
    assert bundle.manifest.id == "hello"
    assert bundle.schemaVersion == SCHEMA_VERSION
```

- [ ] **Step 3: Run test — expect fail (module missing)**

Run: `cd D:\Development\src\OHarness\backend && python -m pytest tests/oharness/test_schema_models.py -v`  
Expected: FAIL import error

- [ ] **Step 4: Implement models + JSON Schema**

`backend/oharness/__init__.py`:

```python
from .models import HarnessBundle, SCHEMA_VERSION, SCHEMA_PATH
__all__ = ["HarnessBundle", "SCHEMA_VERSION", "SCHEMA_PATH"]
```

`backend/oharness/models.py` — define nested models matching the raw dict above (`Manifest`, `Graph`, `Content`, `Runtime`, `Validation`, `HarnessBundle`). Set `SCHEMA_VERSION = "1.0.0"`. `SCHEMA_PATH` = path to `schema/oharness.schema.json`.

Write `oharness.schema.json` with `$id` `https://oharness.dev/schema/oharness/v1.0.0.json`, `required` fields matching the model, `additionalProperties: false` at top level.

- [ ] **Step 5: Run test — expect pass**

Run: `python -m pytest tests/oharness/test_schema_models.py -v`  
Expected: PASS

---

### Task 2: `validate()` library

**Files:**
- Create: `backend/oharness/validate.py`
- Create: `backend/tests/oharness/test_validate.py`
- Create: `backend/tests/oharness/fixtures/invalid-missing-manifest.oharness`
- Create: `backend/tests/oharness/fixtures/valid-hello.oharness`

**Interfaces:**
- Consumes: `HarnessBundle`, `SCHEMA_PATH`
- Produces: `ValidateResult(ok: bool, errors: list[str])`; `validate_path(path: Path) -> ValidateResult`; `validate_dict(data: dict) -> ValidateResult`

- [ ] **Step 1: Write failing tests**

```python
from pathlib import Path
from oharness.validate import validate_path

FIXTURES = Path(__file__).parent / "fixtures"

def test_valid_hello_ok():
    r = validate_path(FIXTURES / "valid-hello.oharness")
    assert r.ok
    assert r.errors == []

def test_invalid_missing_manifest():
    r = validate_path(FIXTURES / "invalid-missing-manifest.oharness")
    assert not r.ok
    assert any("manifest" in e.lower() for e in r.errors)
```

Write `valid-hello.oharness` as the minimal JSON from Task 1. Write `invalid-missing-manifest.oharness` as `{"schemaVersion":"1.0.0"}`.

- [ ] **Step 2: Run — expect fail**

Run: `python -m pytest tests/oharness/test_validate.py -v`  
Expected: FAIL import or not implemented

- [ ] **Step 3: Implement validate.py**

```python
from dataclasses import dataclass, field
from pathlib import Path
import json
from jsonschema import Draft202012Validator
from .models import SCHEMA_PATH, HarnessBundle

@dataclass
class ValidateResult:
    ok: bool
    errors: list[str] = field(default_factory=list)

def validate_dict(data: dict) -> ValidateResult:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    errs = sorted(validator.iter_errors(data), key=lambda e: list(e.path))
    messages = [f"{'/'.join(map(str, e.path)) or '<'}: {e.message}" for e in errs]
    if messages:
        return ValidateResult(False, messages)
    try:
        HarnessBundle.model_validate(data)
    except Exception as ex:
        return ValidateResult(False, [str(ex)])
    return ValidateResult(True, [])

def validate_path(path: Path) -> ValidateResult:
    data = json.loads(path.read_text(encoding="utf-8"))
    return validate_dict(data)
```

Also add graph checks after schema pass: duplicate node ids → error; edge endpoints must exist.

- [ ] **Step 4: Run — expect pass**

Run: `python -m pytest tests/oharness/test_validate.py -v`  
Expected: PASS

---

### Task 3: CLI `python -m oharness validate`

**Files:**
- Create: `backend/oharness/__main__.py`
- Create: `backend/oharness/cli.py`
- Create: `backend/tests/oharness/test_cli.py`

**Interfaces:**
- Produces: exit code 0 on ok, 1 on fail; stdout JSON `{"ok": bool, "errors": [...]}`

- [ ] **Step 1: Failing CLI test**

```python
import subprocess, sys
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"

def test_cli_validate_ok():
    p = subprocess.run(
        [sys.executable, "-m", "oharness", "validate", str(FIXTURES / "valid-hello.oharness")],
        cwd=Path(__file__).resolve().parents[2],
        capture_output=True, text=True,
    )
    assert p.returncode == 0
    assert '"ok": true' in p.stdout.replace(" ", "").lower() or '"ok":true' in p.stdout.replace(" ", "")
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement cli.py + __main__.py**

```python
# cli.py
import argparse, json, sys
from pathlib import Path
from .validate import validate_path

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="oharness")
    sub = parser.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate")
    v.add_argument("path", type=Path)
    args = parser.parse_args(argv)
    if args.cmd == "validate":
        result = validate_path(args.path)
        print(json.dumps({"ok": result.ok, "errors": result.errors}, indent=2))
        return 0 if result.ok else 1
    return 2

# __main__.py
from .cli import main
raise SystemExit(main())
```

Ensure `backend` is on `PYTHONPATH` or run with `cwd=backend` and package importable (add empty `backend/oharness` already). If needed, set `PYTHONPATH=.` in tests.

- [ ] **Step 4: Pass CLI test**

---

### Task 4: Compile skills-framework → default bundle

**Files:**
- Create: `backend/oharness/compile_skills_harness.py`
- Create: `backend/tests/oharness/test_compile_default.py`
- Create: `backend/oharness/fixtures/default-agile.oharness` (generated; committed)
- Create: `docs/harness-spec/HELLO.md` (one-page hello)

**Interfaces:**
- Produces: `compile_skills_harness(src_dir: Path) -> dict` reading  
  `D:\Development\src\skills-framework\skills\engineering\harness\`  
  embeds `SKILL.md`, `agents/*.md`, `HOOKS.md`, `GATES.md`, `FLOW.md`, `KANBAN.md`, `CEREMONIES.md`, `ORCHESTRATION.md`, `templates/*` into `content.skills` / `content.agents` / `content.hooks` / etc.
- Graph: include a canonical 8-role graph (PO, SM, BE, FE, QA, ARCH, TW, SEC) as nodes with edges reflecting gate flow at a coarse level (document mapping in compiler docstring).

- [ ] **Step 1: Failing test**

```python
from pathlib import Path
from oharness.compile_skills_harness import compile_skills_harness
from oharness.validate import validate_dict

SKILLS_HARNESS = Path(r"D:\Development\src\skills-framework\skills\engineering\harness")

def test_compiled_default_validates():
    data = compile_skills_harness(SKILLS_HARNESS)
    assert data["manifest"]["id"] == "oharness.default.agile"
    assert "PO" in data["content"]["agents"] or any("PO" in k for k in data["content"]["agents"])
    r = validate_dict(data)
    assert r.ok, r.errors
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement compiler**

Read each markdown file as UTF-8 string into the content maps. Build graph nodes from agents table. Set `manifest.id = "oharness.default.agile"`, `name = "OHarness Agile (skills-framework)"`, `version = "0.1.0"`.

Write output to `backend/oharness/fixtures/default-agile.oharness` via:

```bash
cd backend && python -c "from pathlib import Path; from oharness.compile_skills_harness import compile_skills_harness; import json; p=Path(r'D:\Development\src\skills-framework\skills\engineering\harness'); data=compile_skills_harness(p); Path('oharness/fixtures').mkdir(parents=True, exist_ok=True); Path('oharness/fixtures/default-agile.oharness').write_text(json.dumps(data, indent=2), encoding='utf-8')"
```

- [ ] **Step 4: `validate` default fixture — pass**

```bash
python -m oharness validate oharness/fixtures/default-agile.oharness
```

Expected: `ok: true`

- [ ] **Step 5: Write `docs/harness-spec/HELLO.md`** — one page explaining minimal bundle + link to schema + default agile as reference.

---

### Task 5: Mock dry-run planner

**Files:**
- Create: `backend/oharness/mock_run.py`
- Create: `backend/tests/oharness/test_mock_run.py`

**Interfaces:**
- Produces: `MockRunReport(steps: list[MockStep], ok: bool)` where each `MockStep` has `nodeId`, `role`, `status` (`planned`|`skipped`), `note`
- `plan_mock_run(bundle: HarnessBundle) -> MockRunReport` — topological order of graph; empty graph → ok with zero steps; cycles → ok=False

- [ ] **Step 1: Failing tests for hello (0 steps) and default (N steps, no cycle)**

- [ ] **Step 2: Implement + pass**

Reuse cycle detection ideas from `backend/engine.py` but keep `oharness` independent (copy small topo helpers into `mock_run.py` — do not import engine yet to avoid coupling).

---

### Task 6: FastAPI routes for validate + mock

**Files:**
- Create: `backend/routers/bundles.py`
- Modify: `backend/main.py` (include router)
- Create: `backend/tests/oharness/test_api_bundles.py`

**Interfaces:**
- `POST /bundles/validate` body: raw JSON bundle → `{ok, errors}`
- `POST /bundles/mock` body: raw JSON → `{ok, steps}`
- `GET /bundles/default` → default-agile.oharness JSON

- [ ] **Step 1: Failing API tests with httpx AsyncClient / TestClient**

```python
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_get_default_bundle():
    r = client.get("/bundles/default")
    assert r.status_code == 200
    assert r.json()["manifest"]["id"] == "oharness.default.agile"

def test_validate_endpoint_ok():
    bundle = client.get("/bundles/default").json()
    r = client.post("/bundles/validate", json=bundle)
    assert r.status_code == 200
    assert r.json()["ok"] is True
```

- [ ] **Step 2: Implement router + register**

```python
# routers/bundles.py
from fastapi import APIRouter
from pathlib import Path
import json
from oharness.validate import validate_dict
from oharness.mock_run import plan_mock_run
from oharness.models import HarnessBundle

router = APIRouter(prefix="/bundles", tags=["bundles"])
DEFAULT = Path(__file__).resolve().parent.parent / "oharness" / "fixtures" / "default-agile.oharness"

@router.get("/default")
def get_default():
    return json.loads(DEFAULT.read_text(encoding="utf-8"))

@router.post("/validate")
def validate_bundle(body: dict):
    result = validate_dict(body)
    return {"ok": result.ok, "errors": result.errors}

@router.post("/mock")
def mock_bundle(body: dict):
    bundle = HarnessBundle.model_validate(body)
    report = plan_mock_run(bundle)
    return {"ok": report.ok, "steps": [s.__dict__ for s in report.steps], "errors": getattr(report, "errors", [])}
```

Include in `main.py`: `app.include_router(bundles.router)`.

- [ ] **Step 3: Pass API tests**

---

### Task 7: Branding rename + README stub

**Files:**
- Modify: `frontend/package.json` name → `oharness`
- Modify: `backend/main.py` title → `OHarness API`
- Create: `README.md` (install story placeholder pointing to future installer; document `python -m oharness validate`)

- [ ] **Step 1: Apply renames**
- [ ] **Step 2: README documents validate CLI + default harness id `oharness.default.agile`**

---

## Plan 01 done when

- [ ] All pytest modules under `backend/tests/oharness/` pass
- [ ] `python -m oharness validate oharness/fixtures/default-agile.oharness` exits 0
- [ ] `GET /bundles/default` returns skills-framework-compiled bundle
- [ ] HELLO.md exists

Hand off to plan 02.
