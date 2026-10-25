"""Compile skills-framework harness markdown into an OHarness bundle dict.

Graph mapping (coarse gate flow from FLOW.md / GATES.md exit chain):

  Nodes (8 roles): PO, SM, BE, FE, QA, ARCH, TW, SEC

  Edges:
    PO → SM          Stage 1 intake → Sprint Planning
    SM → BE, SM → FE Planning assigns implementers (parallel)
    BE → QA, FE → QA Implementers signal Ready for QA
    QA → ARCH        QA Gate → Architecture Gate
    ARCH → TW        ARCH may involve TW for docs evidence
    ARCH → SEC       Architecture Gate → Security Gate

  HITL is human merge authority and is intentionally omitted from the
  executable 8-role graph (not a bundle agent node).

Content mapping:
  SKILL.md                         → content.skills["harness"]
  agents/<ROLE>.md                 → content.agents[<ROLE>]
  HOOKS.md                         → content.hooks["HOOKS"]
  GATES/FLOW/KANBAN/CEREMONIES/
    ORCHESTRATION.md               → content.prompts[<STEM>]
  templates/*                      → content.prompts["templates/<stem>"]
  scripts/*                        → content.scripts[<stem>]
  (slash) commands from SKILL.md   → content.commands (empty stubs reserved)
"""

from __future__ import annotations

from pathlib import Path

from .models import SCHEMA_VERSION

AGENT_ROLES = ("PO", "SM", "BE", "FE", "QA", "ARCH", "TW", "SEC")

# Coarse edges reflecting gate flow (see module docstring).
_GRAPH_EDGES: list[tuple[str, str]] = [
    ("PO", "SM"),
    ("SM", "BE"),
    ("SM", "FE"),
    ("BE", "QA"),
    ("FE", "QA"),
    ("QA", "ARCH"),
    ("ARCH", "TW"),
    ("ARCH", "SEC"),
]

_PROCESS_DOCS = (
    "GATES.md",
    "FLOW.md",
    "KANBAN.md",
    "CEREMONIES.md",
    "ORCHESTRATION.md",
)


def _read_utf8(path: Path) -> str:
    # `Path.read_text()` opens in universal-newlines text mode, which
    # silently rewrites CRLF/CR line endings to LF -- exactly the kind of
    # byte loss the OHM preservation contract forbids for prompt/agent/skill
    # content (ohm-yaml-migration.md P1 step 4). Read raw bytes and decode
    # UTF-8 ourselves so a CRLF-authored markdown source round-trips as CRLF.
    return path.read_bytes().decode("utf-8")


def compile_skills_harness(src_dir: Path) -> dict:
    """Read a skills-framework harness directory and return a valid bundle dict."""
    src_dir = Path(src_dir)

    skills: dict[str, str] = {}
    agents: dict[str, str] = {}
    hooks: dict[str, str] = {}
    prompts: dict[str, str] = {}
    scripts: dict[str, str] = {}
    commands: dict[str, str] = {}

    skill_path = src_dir / "SKILL.md"
    if skill_path.is_file():
        skills["harness"] = _read_utf8(skill_path)

    agents_dir = src_dir / "agents"
    if agents_dir.is_dir():
        for path in sorted(agents_dir.glob("*.md")):
            agents[path.stem] = _read_utf8(path)

    hooks_path = src_dir / "HOOKS.md"
    if hooks_path.is_file():
        hooks["HOOKS"] = _read_utf8(hooks_path)

    for name in _PROCESS_DOCS:
        path = src_dir / name
        if path.is_file():
            prompts[path.stem] = _read_utf8(path)

    templates_dir = src_dir / "templates"
    if templates_dir.is_dir():
        for path in sorted(templates_dir.glob("*")):
            if path.is_file():
                prompts[f"templates/{path.stem}"] = _read_utf8(path)

    scripts_dir = src_dir / "scripts"
    if scripts_dir.is_dir():
        for path in sorted(scripts_dir.glob("*")):
            if path.is_file():
                scripts[path.stem] = _read_utf8(path)

    nodes = [{"id": role, "role": role, "label": role} for role in AGENT_ROLES]
    edges = [
        {"id": f"{src}-{tgt}", "source": src, "target": tgt}
        for src, tgt in _GRAPH_EDGES
    ]

    return {
        "schemaVersion": SCHEMA_VERSION,
        "manifest": {
            "id": "oharness.default.agile",
            "name": "Agile Harness",
            "version": "0.1.0",
            "description": (
                "Default Agile/Scrum/Kanban agent harness, modelled on the "
                "engineering/harness project in skills-framework."
            ),
            "license": "MIT",
            "tags": ["agile", "scrum", "kanban", "default"],
        },
        "graph": {"nodes": nodes, "edges": edges},
        "content": {
            "prompts": prompts,
            "agents": agents,
            "skills": skills,
            "hooks": hooks,
            "commands": commands,
            "scripts": scripts,
        },
        "runtime": {
            "preferred": "api",
            "cli": None,
            "env": [],
            "secrets": [],
        },
        "validation": {"mockProfile": "default"},
    }
