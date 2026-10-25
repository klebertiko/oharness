from pathlib import Path

from oharness.compile_skills_harness import compile_skills_harness
from oharness.validate import validate_dict


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))


def _make_synthetic_harness_source(root: Path) -> Path:
    """A minimal, self-contained skills-framework-shaped harness directory.

    ohm-yaml-migration.md, "Aceitacao e testes isolados": the compiler test
    must not depend on the real `D:\\Development\\src\\skills-framework`
    workspace tree -- it is not guaranteed to exist next to this repo, and a
    Provider/network-facing test has no business reading another project's
    live source. This builds just enough of the same shape (SKILL.md,
    agents/*.md, HOOKS.md, the five process docs, templates/, scripts/) under
    `tmp_path` for `compile_skills_harness()` to exercise every one of its
    content-mapping branches.
    """
    _write(root / "SKILL.md", "# Harness Skill\n\nSynthetic skill body.\n")
    for role in ("PO", "SM", "BE", "FE", "QA", "ARCH", "TW", "SEC"):
        _write(root / "agents" / f"{role}.md", f"# {role} Agent Profile\n\nSynthetic.\n")
    _write(root / "HOOKS.md", "# Hooks\n\nSynthetic hooks doc.\n")
    for name in ("GATES.md", "FLOW.md", "KANBAN.md", "CEREMONIES.md", "ORCHESTRATION.md"):
        _write(root / name, f"# {name}\n\nSynthetic process doc.\n")
    _write(root / "templates" / "story.md", "# Story Template\n\nSynthetic.\n")
    _write(root / "scripts" / "check.sh", "#!/bin/sh\necho synthetic\n")
    return root


def test_compiled_default_validates(tmp_path: Path):
    source = _make_synthetic_harness_source(tmp_path / "harness")
    data = compile_skills_harness(source)

    assert data["manifest"]["id"] == "oharness.default.agile"
    assert "PO" in data["content"]["agents"]
    assert data["content"]["agents"]["PO"] == "# PO Agent Profile\n\nSynthetic.\n"
    assert data["content"]["skills"]["harness"].startswith("# Harness Skill")
    assert data["content"]["hooks"]["HOOKS"].startswith("# Hooks")
    assert set(data["content"]["prompts"]) >= {
        "GATES",
        "FLOW",
        "KANBAN",
        "CEREMONIES",
        "ORCHESTRATION",
        "templates/story",
    }
    assert data["content"]["scripts"]["check"].startswith("#!/bin/sh")

    r = validate_dict(data)
    assert r.ok, r.errors


def test_compiled_default_preserves_crlf_bytes(tmp_path: Path):
    # ohm-yaml-migration.md P1 step 4: Path.read_text() would silently
    # rewrite CRLF to LF; compile_skills_harness must not.
    source = tmp_path / "harness"
    _write(source / "SKILL.md", "line one\r\nline two\r\n")
    for role in ("PO", "SM", "BE", "FE", "QA", "ARCH", "TW", "SEC"):
        _write(source / "agents" / f"{role}.md", f"# {role}\n")

    data = compile_skills_harness(source)

    assert data["content"]["skills"]["harness"] == "line one\r\nline two\r\n"
