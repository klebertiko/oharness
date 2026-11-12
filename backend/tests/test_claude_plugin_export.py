"""Claude Code plugin projection of a HarnessBundle.

The public seam is export_claude_code_plugin. Layout follows
https://code.claude.com/docs/en/plugins/create (only plugin.json lives in
.claude-plugin/; components sit at the plugin root).
"""

from __future__ import annotations

import json
from pathlib import Path

from oharness.claude_plugin_export import export_claude_code_plugin
from oharness.models import HarnessBundle


def _bundle(
    *,
    content: dict | None = None,
    nodes: list | None = None,
    secrets: list | None = None,
) -> HarnessBundle:
    base_content = {
        "prompts": {},
        "agents": {},
        "skills": {},
        "hooks": {},
        "commands": {},
        "scripts": {},
    }
    if content:
        base_content.update(content)
    return HarnessBundle.model_validate(
        {
            "schemaVersion": "1.0.0",
            "manifest": {
                "id": "oharness.review",
                "name": "Revisao",
                "version": "1.2.0",
                "description": "Revisa mudancas do harness",
                "license": "MIT",
            },
            "graph": {"nodes": nodes or [], "edges": []},
            "content": base_content,
            "runtime": {
                "preferred": "api",
                "cli": None,
                "env": [],
                "secrets": secrets if secrets is not None else ["vault://runner"],
            },
            "validation": {"mockProfile": "default"},
        }
    )


def _read(root: Path, rel: str) -> str:
    return (root / rel).read_text(encoding="utf-8")


def test_projects_bundle_to_claude_plugin_root(tmp_path: Path) -> None:
    dest = tmp_path / "plugin"
    bundle = _bundle(
        content={
            "skills": {"review": "Leia o diff e aponte o que falta."},
            "agents": {"revisor": "Voce revisa o diff."},
            "commands": {"status": "Diga o estado do harness."},
            "prompts": {"gates": "Um gate so passa com evidencia."},
            "scripts": {"format.sh": "echo ok\n"},
            "hooks": {"HOOKS": "# Hooks do harness\nSo vetam.\n"},
        }
    )

    report = export_claude_code_plugin(bundle, dest)

    manifest = json.loads(_read(dest, ".claude-plugin/plugin.json"))
    assert manifest == {
        "name": "oharness-review",
        "version": "1.2.0",
        "description": "Revisa mudancas do harness",
    }
    assert _read(dest, "skills/review/SKILL.md").endswith("Leia o diff e aponte o que falta.\n")
    assert "description:" in _read(dest, "skills/review/SKILL.md")
    assert "Voce revisa o diff." in _read(dest, "agents/revisor.md")
    assert "name:" in _read(dest, "agents/revisor.md")
    assert "Diga o estado do harness." in _read(dest, "commands/status.md")
    assert "Um gate so passa com evidencia." in _read(dest, "skills/gates/SKILL.md")
    assert _read(dest, "scripts/format.sh") == "echo ok\n"
    assert "# Hooks do harness" in _read(dest, "hooks/HOOKS.md")
    assert not (dest / "hooks" / "hooks.json").exists()
    assert not (dest / ".claude-plugin" / "skills").exists()
    assert "vault://runner" not in "\n".join(_read(dest, rel) for rel in report.files)
    assert report.files == tuple(sorted(report.files))


def test_keeps_existing_frontmatter(tmp_path: Path) -> None:
    body = "---\ndescription: \"ja escrita\"\n---\n\nCorpo.\n"
    dest = tmp_path / "plugin"
    export_claude_code_plugin(_bundle(content={"skills": {"review": body}}), dest)
    assert _read(dest, "skills/review/SKILL.md") == body


def test_writes_hooks_json_only_for_a_hook_map(tmp_path: Path) -> None:
    dest = tmp_path / "plugin"
    export_claude_code_plugin(
        _bundle(
            content={
                "hooks": {
                    "format": {
                        "hooks": {
                            "PostToolUse": [
                                {
                                    "matcher": "Write|Edit",
                                    "hooks": [{"type": "command", "command": "echo ok"}],
                                }
                            ]
                        }
                    }
                }
            }
        ),
        dest,
    )
    payload = json.loads(_read(dest, "hooks/hooks.json"))
    assert payload["hooks"]["PostToolUse"][0]["matcher"] == "Write|Edit"
    assert not (dest / "hooks" / "format.md").exists()


def test_mcp_node_becomes_mcp_json_without_secrets(tmp_path: Path) -> None:
    key = "sk-" + "x" * 20
    dest = tmp_path / "plugin"
    export_claude_code_plugin(
        _bundle(
            nodes=[
                {
                    "id": "files",
                    "type": "mcp",
                    "data": {
                        "mcpCommand": "node server.js --port 9",
                        "apiKey": key,
                        "secretRef": "oharness/files",
                    },
                },
                {
                    "id": "remote",
                    "type": "mcp",
                    "data": {"mcpUrl": "https://mcp.example/rpc"},
                },
                {
                    "id": "bare",
                    "type": "mcp",
                    "data": {"connectorIds": ["files"]},
                },
            ]
        ),
        dest,
    )
    raw = _read(dest, ".mcp.json")
    payload = json.loads(raw)
    assert payload["mcpServers"]["files"] == {
        "command": "node",
        "args": ["server.js", "--port", "9"],
    }
    assert payload["mcpServers"]["remote"] == {
        "type": "http",
        "url": "https://mcp.example/rpc",
    }
    assert "bare" not in payload["mcpServers"]
    assert key not in raw
    assert "secretRef" not in raw
    assert "vault://runner" not in raw


def test_agent_system_prompt_is_used_when_content_has_no_agent(tmp_path: Path) -> None:
    dest = tmp_path / "plugin"
    export_claude_code_plugin(
        _bundle(
            nodes=[
                {
                    "id": "po",
                    "type": "agent",
                    "data": {"systemPrompt": "Voce recebe o pedido."},
                }
            ]
        ),
        dest,
    )
    assert "Voce recebe o pedido." in _read(dest, "agents/po.md")


def test_refuses_to_write_outside_the_plugin_root(tmp_path: Path) -> None:
    dest = tmp_path / "plugin"
    export_claude_code_plugin(
        _bundle(content={"skills": {"../outside": "nao"}}),
        dest,
    )
    assert not (tmp_path / "outside").exists()
    assert not (tmp_path / "skills").exists()
    written = [p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file()]
    assert all(".." not in Path(rel).parts for rel in written)
    assert json.loads(_read(dest, ".claude-plugin/plugin.json"))["name"] == "oharness-review"


def test_refuses_mcp_url_with_userinfo(tmp_path: Path) -> None:
    dest = tmp_path / "plugin"
    try:
        export_claude_code_plugin(
            _bundle(
                nodes=[
                    {
                        "id": "remote",
                        "type": "mcp",
                        "data": {"mcpUrl": "https://user:secret@mcp.example/rpc"},
                    }
                ]
            ),
            dest,
        )
    except ValueError as exc:
        assert "credencial" in str(exc)
    else:
        raise AssertionError("url com usuario e senha deveria falhar")
    if dest.exists():
        written = {p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file()}
        assert ".mcp.json" not in written


def test_refuses_existing_destination(tmp_path: Path) -> None:
    dest = tmp_path / "plugin"
    dest.mkdir()
    try:
        export_claude_code_plugin(_bundle(), dest)
    except FileExistsError:
        return
    raise AssertionError("destino existente deveria falhar")
