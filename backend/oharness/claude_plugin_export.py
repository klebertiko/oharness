"""Project a HarnessBundle onto a Claude Code plugin root.

Primary source, checked 2026-11-12:
https://code.claude.com/docs/en/plugins/create
https://code.claude.com/docs/en/plugins/manifest-reference

Only ``plugin.json`` lives in ``.claude-plugin/``. Skills, agents, commands,
hooks and ``.mcp.json`` sit at the plugin root. Files placed inside
``.claude-plugin/`` besides the manifest do not load.

``content.hooks`` strings are harness prose (the compiler's ``HOOKS.md``),
not Claude lifecycle hooks. They are kept as ``hooks/<name>.md``. A dict
whose ``hooks`` value is an event map is written to ``hooks/hooks.json``.
Codex and Cursor are not targets of this projection.
"""

from __future__ import annotations

import json
import re
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .models import HarnessBundle

_SAFE_NAME = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"
_SCRIPT_SUFFIXES = {".sh", ".py", ".js", ".mjs", ".cjs", ".ps1", ".cmd", ".md", ".txt", ".json"}
_SECRET_KEYS = {
    "apikey",
    "token",
    "secret",
    "password",
    "authorization",
    "accesstoken",
    "refreshtoken",
    "credential",
}


@dataclass(frozen=True)
class ClaudePluginExport:
    files: tuple[str, ...]


def export_claude_code_plugin(bundle: HarnessBundle, dest: Path) -> ClaudePluginExport:
    """Write one Claude Code plugin directory. ``dest`` must not already exist."""
    if not isinstance(bundle, HarnessBundle):
        bundle = HarnessBundle.model_validate(bundle)
    dest = Path(dest)
    if dest.exists():
        raise FileExistsError(dest)
    files = _project(bundle)
    dest.mkdir(parents=True)
    root = dest.resolve()
    for rel, text in files.items():
        path = (dest / rel).resolve()
        if not path.is_relative_to(root):
            raise ValueError("caminho sai do plugin")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return ClaudePluginExport(files=tuple(sorted(files)))


def _project(bundle: HarnessBundle) -> dict[str, str]:
    files: dict[str, str] = {}
    manifest = {
        "name": _slug(bundle.manifest.id),
        "version": bundle.manifest.version,
        "description": bundle.manifest.description,
    }
    files[".claude-plugin/plugin.json"] = _json(manifest)

    used: set[str] = set()
    for key, body in bundle.content.skills.items():
        _put_markdown(files, used, f"skills/{_component_name(str(key))}/SKILL.md", body, kind="skill", name=_slug(str(key)))
    for key, body in bundle.content.prompts.items():
        _put_markdown(files, used, f"skills/{_component_name(str(key))}/SKILL.md", body, kind="skill", name=_slug(str(key)))
    for key, body in bundle.content.agents.items():
        _put_markdown(files, used, f"agents/{_component_name(str(key))}.md", body, kind="agent", name=_component_name(str(key)))
    for key, body in bundle.content.commands.items():
        if not isinstance(body, str) or not body.strip():
            continue
        _put_markdown(files, used, f"commands/{_component_name(str(key))}.md", body, kind="command", name=_component_name(str(key)))
    for key, body in bundle.content.scripts.items():
        if not isinstance(body, str):
            raise ValueError(f"script {key!r} nao e texto")
        files[_fresh(used, f"scripts/{_script_name(str(key))}")] = body if body.endswith("\n") else body + "\n"

    hook_events: dict[str, list[Any]] = {}
    for key, body in bundle.content.hooks.items():
        if isinstance(body, str):
            files[_fresh(used, f"hooks/{_component_name(str(key))}.md")] = body if body.endswith("\n") else body + "\n"
            continue
        if isinstance(body, dict):
            _merge_hooks(hook_events, _scrub(body))
            continue
        raise ValueError(f"hook {key!r} nao e texto nem mapa")
    if hook_events:
        files[_fresh(used, "hooks/hooks.json")] = _json({"hooks": hook_events})

    for node in bundle.graph.nodes:
        if not isinstance(node, dict) or node.get("type") != "agent":
            continue
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        prompt = data.get("systemPrompt")
        if not isinstance(prompt, str) or not prompt.strip():
            continue
        rel = f"agents/{_component_name(str(node.get('id', '')))}.md"
        if rel in files:
            continue
        _put_markdown(files, used, rel, prompt, kind="agent", name=_component_name(str(node.get("id", ""))))

    servers = _mcp_servers(bundle)
    if servers:
        files[".mcp.json"] = _json({"mcpServers": servers})
    return files


def _put_markdown(files: dict[str, str], used: set[str], rel: str, body: Any, *, kind: str, name: str) -> None:
    if not isinstance(body, str):
        raise ValueError(f"{rel} nao e texto")
    files[_fresh(used, rel)] = _markdown(body, kind=kind, name=name)


def _markdown(body: str, *, kind: str, name: str) -> str:
    if body.startswith("---\n") or body.startswith("---\r\n"):
        return body if body.endswith("\n") else body + "\n"
    description = _first_line(body) or "Instrucoes do harness"
    lines = ["---"]
    if kind == "agent":
        lines.append(f"name: {json.dumps(name, ensure_ascii=False)}")
    lines.append(f"description: {json.dumps(description, ensure_ascii=False)}")
    lines.append("---")
    lines.append("")
    text = body if body.endswith("\n") else body + "\n"
    return "\n".join(lines) + "\n" + text


def _mcp_servers(bundle: HarnessBundle) -> dict[str, dict[str, Any]]:
    servers: dict[str, dict[str, Any]] = {}
    for node in bundle.graph.nodes:
        if not isinstance(node, dict) or node.get("type") != "mcp":
            continue
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        command = data.get("mcpCommand")
        url = data.get("mcpUrl")
        has_command = isinstance(command, str) and bool(command.strip())
        has_url = isinstance(url, str) and bool(url.strip())
        if not has_command and not has_url:
            continue
        if has_command and has_url:
            raise ValueError(f"no MCP {node.get('id')!r} tem comando e URL")
        name = _slug(str(node.get("id", "")))
        if name in servers:
            raise ValueError(f"servidor MCP duplicado: {name}")
        if has_command:
            servers[name] = _command_server(str(command), str(node.get("id", name)))
        else:
            servers[name] = _url_server(str(url), str(node.get("id", name)))
    return servers


def _command_server(command: str, node_id: str) -> dict[str, Any]:
    try:
        parts = shlex.split(command, posix=True)
    except ValueError as exc:
        raise ValueError(f"comando MCP invalido no no {node_id}") from exc
    if not parts:
        raise ValueError(f"comando MCP vazio no no {node_id}")
    entry: dict[str, Any] = {"command": parts[0]}
    if len(parts) > 1:
        entry["args"] = parts[1:]
    return entry


def _url_server(url: str, node_id: str) -> dict[str, Any]:
    parsed = urlsplit(url)
    if parsed.username or parsed.password:
        raise ValueError(f"URL de MCP com credencial no no {node_id}")
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"URL de MCP invalida no no {node_id}")
    return {"type": "http", "url": url}


def _merge_hooks(events: dict[str, list[Any]], payload: Any) -> None:
    if not isinstance(payload, dict):
        raise ValueError("mapa de hooks invalido")
    source = payload.get("hooks") if isinstance(payload.get("hooks"), dict) else payload
    if not isinstance(source, dict):
        raise ValueError("mapa de hooks invalido")
    for event, items in source.items():
        if event == "hooks":
            continue
        if not isinstance(items, list):
            raise ValueError(f"evento de hook {event!r} nao e lista")
        events.setdefault(str(event), []).extend(items)


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _scrub(v) for k, v in value.items() if not _is_secret_key(str(k))}
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    return value


def _is_secret_key(key: str) -> bool:
    folded = "".join(ch for ch in key.lower() if ch.isalnum())
    return folded in _SECRET_KEYS


def _component_name(key: str) -> str:
    if re.fullmatch(_SAFE_NAME, key):
        return key
    return _slug(key)


def _script_name(key: str) -> str:
    suffix = Path(key).suffix.lower()
    if suffix in _SCRIPT_SUFFIXES:
        stem = key[: -len(suffix)]
        return _component_name(stem) + suffix
    return _component_name(key)


def _slug(raw: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", raw.strip().lower()).strip("-")
    if not text:
        raise ValueError(f"nome invalido para arquivo de plugin: {raw!r}")
    return text[:64]


def _fresh(used: set[str], rel: str) -> str:
    if rel in used or rel.startswith("/") or ".." in rel.split("/"):
        raise ValueError(f"caminho de plugin recusado: {rel}")
    used.add(rel)
    return rel


def _json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _first_line(body: str) -> str:
    for line in body.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped[:200]
    return ""
