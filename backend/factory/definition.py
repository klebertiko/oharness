"""Factory definition as code (ADR 0056): read `.oharness/factory`, merge it into one definition, validate it, hash it, diff it.

A definition never holds a secret: every object of the schema is closed, secrets are `factory/<name>` references only, and every string
value is scanned for credential patterns. Issues name the file and the field, never the value. The folder is read, never written, and
nothing in it is followed through a link or executed.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

from jsonschema import Draft202012Validator
from ruamel.yaml import YAML
from ruamel.yaml.error import YAMLError

from factory import definition_rules as rules
from sandbox.secrets import redact

# The free-text string fields of the schema: a contract test compares this set with the schema, so a new text field cannot skip the check.
FREE_TEXT_FIELDS = frozenset({'instructions', 'text', 'command', 'args', 'automations', 'webhooks'})
MAX_FILES = 2000
# Shapes the shared `redact` misses (hyphenated vendor keys, bearer tokens, URLs with a password), checked on top of it.
_MORE_SECRETS = re.compile(r'sk-ant-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{10,}'
                           r'|github_pat_[A-Za-z0-9_]{20,}|[A-Za-z][A-Za-z0-9+.-]*://[^\s/:@]+:[^\s/@]{3,}@')
_CREDENTIAL_FLAG = re.compile(r'^--?[A-Za-z0-9-]*(?:key|token|secret|password|passwd|credential)[A-Za-z0-9-]*$', re.IGNORECASE)
_PLAIN_NAME = re.compile(r'^[A-Za-z0-9_./-]{1,80}$')
_LONG_TOKEN = re.compile(r'[A-Za-z0-9_+/=.~-]{20,}')
_ID = re.compile(rules.ID_PATTERN)
_SECTIONS_FROM_LAYOUT = ('agents', 'skills', 'mcp', 'runners', 'reserved')
_HINTS = {
    rules.SECRET_REF_PATTERN: 'must be a secret reference like factory/<name>; the value itself never goes in the definition',
    rules.RELATIVE_PATH_PATTERN: 'must be a relative path inside the repository, written with / (no .., no drive letter, no leading /)',
    rules.ID_PATTERN: 'must be lowercase letters, digits and "-", starting with a letter or digit',
    rules.MODEL_PATTERN: 'must be a model id such as provider/model',
    rules.BRANCH_PATTERN: 'must be a branch name or pattern',
}
_LIMITS = {'maxLength': 'must be at most {} characters', 'minLength': 'must be at least {} characters', 'maximum': 'must be at most {}',
           'minimum': 'must be at least {}', 'maxItems': 'must have at most {} items', 'minItems': 'must have at least {} items',
           'maxProperties': 'must have at most {} entries', 'minProperties': 'must have at least {} entries'}


def looks_secret(text: str) -> bool:
    return bool(redact(text)[1] or _MORE_SECRETS.search(text))


def _safe_name(name: object) -> str:
    """A name that came from a file may be a secret pasted in the wrong place: it is shown only when it is plainly a name."""
    text = str(name)
    return text if _PLAIN_NAME.fullmatch(text) and not looks_secret(text) else '<redacted>'


def _scrub(message: str) -> str:
    """Messages of the intake parsers can quote a value: keep the words, drop anything shaped like a key."""
    return _LONG_TOKEN.sub('<redacted>', message) if looks_secret(message) or _LONG_TOKEN.search(message) else message


class DefinitionNotFound(FileNotFoundError):
    """The definition folder does not exist (usage error, exit code 2)."""


@dataclass(frozen=True)
class Issue:
    file: str
    path: str
    message: str
    severity: str = 'error'

    def as_dict(self) -> dict:
        return {'file': self.file, 'path': self.path, 'message': self.message, 'severity': self.severity}


@dataclass
class Loaded:
    definition: dict | None
    issues: list[Issue] = field(default_factory=list)
    hash: str | None = None

    @property
    def ok(self) -> bool:
        return self.definition is not None and not any(i.severity == 'error' for i in self.issues)


@dataclass(frozen=True)
class Change:
    path: str
    op: str  # added | removed | changed
    before: object = None
    after: object = None

    def as_dict(self) -> dict:
        return {'path': self.path, 'op': self.op, 'before': self.before, 'after': self.after}


class _FileProblem(Exception):
    pass


@cache
def _validator() -> Draft202012Validator:
    return Draft202012Validator(rules.build_schema())


def canonical_json(definition: dict) -> str:
    return json.dumps(definition, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def hash_of(definition: dict) -> str:
    return hashlib.sha256(canonical_json(definition).encode('utf-8')).hexdigest()


# -------------------------------------------------------------------------------------------------------------------- reading files

def _classify(parts: tuple[str, ...]) -> tuple[str, tuple[str, ...]] | None:
    n = len(parts)
    if parts == ('factory.yaml',):
        return 'factory', ()
    if n == 3 and parts[0] == 'agents' and parts[2] == 'agent.md':
        return 'agent', (parts[1],)
    if n == 5 and parts[0] == 'agents' and parts[2] == 'skills' and parts[4] == 'SKILL.md':
        return 'agent_skill', (parts[1], parts[3])
    if n == 3 and parts[0] == 'skills' and parts[2] == 'SKILL.md':
        return 'skill', (parts[1],)
    if n == 2 and parts[0] in ('mcp', 'runners', 'webhooks') and parts[1].endswith('.yaml'):
        return {'mcp': 'mcp', 'runners': 'runner', 'webhooks': 'webhook'}[parts[0]], (parts[1][:-5],)
    if n == 3 and parts[0] == 'automations' and parts[2] == 'automation.md':
        return 'automation', (parts[1],)
    if parts[0] in rules.RESERVED_FOR_SCORING or (n == 1 and parts[0] in rules.ALLOWED_LOOSE_FILES):
        return 'ignored', ()
    return None


def _walk(root: Path, issues: list[Issue]) -> list[str]:
    """Relative POSIX paths of every file under `root`; links are reported, never followed."""
    found: list[str] = []
    pending = [(root, '')]
    folders = 0
    while pending:
        folder, prefix = pending.pop()
        folders += 1
        if folders > rules.MAX_FOLDERS or prefix.count('/') > rules.MAX_TREE_DEPTH:
            issues.append(Issue('.', '', f'more than {rules.MAX_FOLDERS} folders or deeper than {rules.MAX_TREE_DEPTH} levels; the definition is a few small text files'))
            return found
        try:
            entries = sorted(os.scandir(folder), key=lambda e: e.name)
        except OSError:
            issues.append(Issue(prefix.rstrip('/') or '.', '', 'the folder cannot be read'))
            continue
        for entry in entries:
            rel = prefix + entry.name
            if entry.is_symlink() or getattr(entry, 'is_junction', lambda: False)():
                issues.append(Issue(_safe_name(rel), '', 'symbolic links are not followed; put the file itself here'))
            elif entry.is_dir(follow_symlinks=False):
                pending.append((Path(entry.path), rel + '/'))
            elif entry.is_file(follow_symlinks=False):
                found.append(rel)
            if len(found) > MAX_FILES:
                issues.append(Issue('.', '', f'more than {MAX_FILES} files; the definition is a few small text files'))
                return found
    return sorted(found)


def _read(root: Path, rel: str) -> str:
    path = root / rel
    if path.stat().st_size > rules.MAX_FILE_BYTES:
        raise _FileProblem(f'file is too large (limit {rules.MAX_FILE_BYTES // 1024} KB)')
    try:
        text = path.read_bytes().decode('utf-8-sig')
    except UnicodeDecodeError:
        raise _FileProblem('not valid UTF-8 text') from None
    return text.replace('\r\n', '\n').replace('\r', '\n')  # a checkout with CRLF must hash like one with LF


def _shared_container(node, seen: set[int]) -> bool:
    stack = [node]
    while stack:
        current = stack.pop()
        if isinstance(current, (dict, list)):
            if id(current) in seen:
                return True
            seen.add(id(current))
            stack.extend(current.values() if isinstance(current, dict) else current)
    return False


def _too_deep(text: str) -> bool:
    """Cheap pre-scan: the YAML parser recurses per level, so a hostile file must be refused before it gets there."""
    depth = 0
    for char in text:
        if char in '[{':
            depth += 1
            if depth > rules.MAX_YAML_DEPTH:
                return True
        elif char in ']}':
            depth = max(0, depth - 1)
    return any((len(line) - len(line.lstrip(' '))) // 2 > rules.MAX_YAML_DEPTH for line in text.split(chr(10)))


def _only_text_keys(node) -> bool:
    stack = [node]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            if not all(isinstance(key, str) for key in current):
                return False
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
    return True


def _yaml(text: str):
    if _too_deep(text):
        raise _FileProblem(f'nested too deep (limit {rules.MAX_YAML_DEPTH} levels)')
    try:
        data = YAML(typ='safe').load(text)
    except YAMLError as exc:
        mark = getattr(exc, 'problem_mark', None)
        raise _FileProblem(f'not valid YAML{f" (line {mark.line + 1})" if mark else ""}; duplicate keys and tags are refused') from None
    except RecursionError:
        raise _FileProblem(f'nested too deep (limit {rules.MAX_YAML_DEPTH} levels)') from None
    if _shared_container(data, set()):
        raise _FileProblem('YAML anchors and aliases are not supported; write the value out')
    if not _only_text_keys(data):
        raise _FileProblem('every key must be text')
    return data


def _front_matter(text: str) -> tuple[object, str]:
    if not text.startswith('---\n'):
        raise _FileProblem('must start with a --- front matter block')
    end = text.find('\n---\n', 3)
    if end == -1 and text.rstrip().endswith('\n---'):
        end = text.rstrip().rfind('\n---')
    if end == -1:
        raise _FileProblem('the front matter block is not closed with ---')
    return _yaml(text[4:end] + '\n') or {}, text[end + 5:].strip()


def _id_problem(name: str) -> str | None:
    if not _ID.fullmatch(name):
        return 'the name must be lowercase letters, digits and "-"'
    if name in rules.WINDOWS_RESERVED:
        return 'this name cannot be created on Windows (reserved device name)'
    return None


# ------------------------------------------------------------------------------------------------------------------ canonical form

def _with(defaults: dict, value):
    return {**defaults, **value} if isinstance(value, dict) else value


def _agent(fm, body: str, factory_defaults: dict, local_skills: dict) -> dict:
    if not isinstance(fm, dict):
        return fm
    out = {**fm}
    out.setdefault('model', factory_defaults.get('model'))
    out['permissions'] = _with({'mode': rules.DEFAULT_MODE}, out.get('permissions', {}))
    safe = isinstance(out['permissions'], dict) and out['permissions'].get('mode') in rules.HARNESS_SAFE_MODES
    if 'harness' not in out and factory_defaults.get('harness') and safe:
        out['harness'] = factory_defaults['harness']
    out['memory'] = _with(dict(rules.MEMORY_LIMITS), out.get('memory', {}))
    for key, empty in (('skills', []), ('mcp', []), ('secrets', []), ('enabled', True)):
        out.setdefault(key, empty)
    out['instructions'], out['localSkills'] = body, local_skills
    if out['model'] is None:
        del out['model']
    return out


def _render(path) -> str:
    out = ''
    for part in path:
        out += f'[{part}]' if isinstance(part, int) else (f'.{part}' if out else str(part))
    return out


def _file_of(path: tuple) -> str:
    head = [p for p in path if isinstance(p, str)]
    if len(head) >= 2 and head[0] == 'agents':
        return f'agents/{head[1]}/skills/{head[3]}/SKILL.md' if len(head) >= 4 and head[2] == 'localSkills' else f'agents/{head[1]}/agent.md'
    if len(head) >= 2 and head[0] == 'skills':
        return f'skills/{head[1]}/SKILL.md'
    if len(head) >= 2 and head[0] in ('mcp', 'runners'):
        return f'{head[0]}/{head[1]}.yaml'
    return 'factory.yaml'


def _schema_issues(definition: dict) -> list[Issue]:
    issues: dict[tuple[str, str], Issue] = {}

    def add(path: tuple, message: str) -> None:
        issues.setdefault((_render(path), message), Issue(_file_of(path), _render(path), message))

    for error in _validator().iter_errors(definition):
        path, kind, expected = tuple(error.absolute_path), error.validator, error.validator_value
        if kind == 'additionalProperties':
            schema = error.schema
            known = set(schema.get('properties', {}))
            patterns = [re.compile(p) for p in schema.get('patternProperties', {})]
            for name in sorted(k for k in error.instance if k not in known and not any(p.search(k) for p in patterns)):
                add(path + (_safe_name(name),), f'unknown field {_safe_name(name)}: this definition has no such field')
        elif kind == 'required':
            for name in expected:
                if name not in error.instance:
                    add(path + (name,), 'is required')
        elif kind == 'enum':
            add(path, 'must be one of: ' + ', '.join(str(v) for v in expected))
        elif kind == 'const':
            add(path, f'must be exactly {expected}')
        elif kind == 'pattern':
            add(path, _HINTS.get(expected, 'has an invalid format'))
        elif kind == 'type':
            add(path, f'must be {expected if isinstance(expected, str) else " or ".join(expected)}')
        elif kind == 'oneOf':
            add(path, 'must be a command server (command, args, env) or a URL server (url, headers)')
        elif kind == 'uniqueItems':
            add(path, 'must not repeat an item')
        elif kind in _LIMITS:
            add(path, _LIMITS[kind].format(expected))
        else:
            add(path, 'is not valid')
    return list(issues.values())


def _single_line_issues(definition: dict) -> list[Issue]:
    """Only the free-text fields may span lines; `$` in a pattern would let a trailing newline through, so it is checked here."""
    found: list[Issue] = []
    stack: list[tuple[tuple, object]] = [((), definition)]
    while stack:
        path, node = stack.pop()
        if isinstance(node, dict):
            stack.extend((path + (k,), v) for k, v in node.items())
        elif isinstance(node, list):
            stack.extend((path + (i,), v) for i, v in enumerate(node))
        elif isinstance(node, str) and any(c in node for c in (chr(10), chr(13), chr(0))):
            names = [p for p in path if isinstance(p, str)]
            if not (names and (names[-1] in FREE_TEXT_FIELDS or names[0] == 'reserved')):
                found.append(Issue(_file_of(path), _render(path), 'must be a single line'))
    return found


def _secret_issues(definition: dict) -> list[Issue]:
    found: list[Issue] = []
    stack: list[tuple[tuple, object]] = [((), definition)]
    while stack:
        path, node = stack.pop()
        if isinstance(node, dict):
            stack.extend((path + (k,), v) for k, v in node.items())
        elif isinstance(node, list):
            stack.extend((path + (i,), v) for i, v in enumerate(node))
        elif isinstance(node, str) and looks_secret(node):
            found.append(Issue(_file_of(path), _render(path), 'a value looks like a credential; keep secrets in the secrets store and reference them with secretRef'))
    return sorted(found, key=lambda i: i.path)


# ----------------------------------------------------------------------------------------------------------------------- semantics

def _model_pairs(agents: dict, role: str) -> set[tuple[str, str | None]]:
    return {(a['model'], a.get('harness')) for a in agents.values() if a['role'] == role and a['enabled']}


def independence_problem(definition: dict) -> str | None:
    """Review must differ from implement in model or harness when the policy requires it (ADR 0054)."""
    agents = definition['agents']
    implement, review = _model_pairs(agents, 'implement'), _model_pairs(agents, 'review')
    if implement and review and not any(r != i for r in review for i in implement):
        return 'no enabled review agent differs from the implement agents in model or harness, so review cannot be independent'
    return None


def stage_flags(definition: dict) -> dict[str, dict[str, bool]]:
    """Effective {enabled, required, available} per configurable stage: `available` means an enabled agent of that role exists."""
    policy, stages, out = definition['policy'], definition['stages'], {}
    for stage in rules.CONFIGURABLE_STAGES:
        explicit = stages.get(stage, {})
        available = any(a['role'] == rules.STAGE_ROLE[stage] and a['enabled'] for a in definition['agents'].values())
        required = explicit.get('required', (stage == 'review' and available) or (stage == 'spec' and policy['requireSpec']))
        out[stage] = {'available': available, 'enabled': explicit.get('enabled', available), 'required': bool(required)}
    return out


def _reserved_segment(segment: str) -> bool:
    return segment.endswith(('.', ' ')) and segment not in ('.',) or segment.split('.')[0].lower() in rules.WINDOWS_RESERVED


def _semantic_issues(definition: dict) -> list[Issue]:
    issues: list[Issue] = []

    def add(path: str, message: str, severity: str = 'error') -> None:
        issues.append(Issue(_file_of(tuple(re.split(r'[.\[\]]+', path))), path, message, severity))

    agents, policy = definition['agents'], definition['policy']
    foremen = [name for name, a in agents.items() if a['role'] == 'foreman']
    if len(foremen) != 1:
        add('agents', 'the factory needs exactly one agent with role foreman' + (f' (found {len(foremen)})' if foremen else ''))
    elif not agents[foremen[0]]['enabled']:
        add(f'agents.{foremen[0]}.enabled', 'the foreman cannot be turned off')
    tier_models = {m for tier in definition['tiers'].values() for m in tier['models']}
    limit_rank, run_cap = rules.mode_rank(policy['maxPermissionMode']), definition['ceilings'].get('tokensPerRun')
    item_cap = definition['ceilings'].get('tokensPerWorkItem')
    if run_cap and item_cap and run_cap > item_cap:
        add('ceilings.tokensPerRun', 'cannot exceed tokensPerWorkItem')
    if tier_models and 'model' in definition['defaults'] and definition['defaults']['model'] not in tier_models:
        add('defaults.model', 'is not listed in any tier')
    for name, agent in agents.items():
        where = f'agents.{name}'
        if tier_models and agent['model'] not in tier_models:
            add(f'{where}.model', 'is not listed in any tier')
        for i, skill in enumerate(agent['skills']):
            if skill in rules.EMBEDDED_SKILLS:
                if agent['role'] == 'custom':
                    add(f'{where}.skills[{i}]', 'custom agents do not get the built-in skills')
            elif skill not in definition['skills'] and skill not in agent['localSkills']:
                add(f'{where}.skills[{i}]', 'names a skill that does not exist (skills/<id>/SKILL.md)')
        for skill in agent['localSkills']:
            if skill in definition['skills']:
                add(f'{where}.localSkills.{skill}', 'has the same name as a global skill')
        for i, server in enumerate(agent['mcp']):
            if server not in definition['mcp']:
                add(f'{where}.mcp[{i}]', 'names an MCP server that does not exist (mcp/<id>.yaml)')
        mode = agent['permissions']['mode']
        if rules.mode_rank(mode) > limit_rank:
            add(f'{where}.permissions.mode', f'exceeds the factory limit policy.maxPermissionMode ({policy["maxPermissionMode"]}); raising it is an explicit change')
        if agent.get('harness') and mode not in rules.HARNESS_SAFE_MODES:
            add(f'{where}.harness', 'a harness run gives the model no tools, so it only serves agents that cannot write (mode plan or read_only)')
        ceiling = agent.get('tokenCeiling')
        if run_cap and ceiling and ceiling > run_cap:
            add(f'{where}.tokenCeiling', 'cannot exceed ceilings.tokensPerRun')
        if run_cap and agent['permissions'].get('maxTokens', 0) > run_cap:
            add(f'{where}.permissions.maxTokens', 'cannot exceed ceilings.tokensPerRun')
        if agent.get('trigger') and agent['trigger'] not in definition['reserved']['automations']:
            add(f'{where}.trigger', 'names an automation that does not exist (automations/<id>/automation.md)')
    for i, repo in enumerate(definition['repositories']):
        for key in ('path', 'subdir'):
            if any(_reserved_segment(seg) for seg in repo.get(key, '.').split('/')):
                add(f'repositories[{i}].{key}', 'a segment is a name Windows cannot create (con, nul, a trailing dot...)')
    for name, server in definition['mcp'].items():
        args = server.get('args', [])
        if any(_CREDENTIAL_FLAG.match(a) and k + 1 < len(args) and not args[k + 1].startswith('-') for k, a in enumerate(args)):
            add(f'mcp.{name}.args', 'a credential flag followed by a value; pass credentials through env with a secretRef')
    ids = [r['id'] for r in definition['repositories']]
    if len(set(ids)) != len(ids):
        add('repositories', 'repository ids must be unique')
    for name, runner in definition['runners'].items():
        if runner.get('pushSecretRef') and runner['credentialStrategy'] != 'factory':
            add(f'runners.{name}.pushSecretRef', 'only applies to credentialStrategy factory')
    for stage, flag in stage_flags(definition).items():
        explicit = definition['stages'].get(stage, {})
        if explicit.get('enabled') and not flag['available']:
            add(f'stages.{stage}', f'is enabled but no enabled agent has role {stage}')
        if flag['required'] and not flag['available']:
            add(f'stages.{stage}', f'is required but no enabled agent has role {stage}')
        elif flag['required'] and not flag['enabled']:
            add(f'stages.{stage}', 'is required, so it cannot be turned off')
    if policy['requireSpec'] and definition['stages'].get('spec', {}).get('required') is False:
        add('stages.spec', 'policy.requireSpec makes the spec stage required')
    problem = independence_problem(definition)
    if problem and policy['reviewIndependence'] != 'off':
        add('policy.reviewIndependence', problem, 'error' if policy['reviewIndependence'] == 'require' else 'warning')
    return issues


# ------------------------------------------------------------------------------------------------------------------------- loader

def load(directory: str | Path) -> Loaded:
    root = Path(directory)
    if not root.is_dir():
        raise DefinitionNotFound(str(directory))
    issues: list[Issue] = []
    for guarded in (root, root.parent if root.parent.name == '.oharness' else root):  # a link on the way leads out of the project
        if guarded.is_symlink() or getattr(guarded, 'is_junction', lambda: False)():
            return Loaded(None, [Issue(_safe_name(guarded.name), '', 'symbolic links are not followed; this folder must be the real one')])
    files = _walk(root, issues)
    budget = rules.MAX_TOTAL_BYTES
    factory_raw: object = None
    agents: dict[str, tuple[object, str]] = {}
    local_skills: dict[str, dict] = {}
    parts: dict[str, dict] = {'skills': {}, 'mcp': {}, 'runners': {}, 'automations': {}, 'webhooks': {}}
    texts: dict[str, str] = {}

    def problem(rel: str, message: str) -> None:
        issues.append(Issue(rel, '', message))

    for rel in files:
        classified = _classify(tuple(rel.split('/')))
        if classified is None:
            problem(_safe_name(rel), 'unexpected file: the definition layout is factory.yaml, agents/, skills/, mcp/, runners/, automations/, webhooks/')
            continue
        kind, ids = classified
        if kind == 'ignored':
            continue
        if any(_id_problem(i) for i in ids):
            problem(_safe_name(rel), next(p for i in ids if (p := _id_problem(i))))
            continue
        try:
            text = _read(root, rel)
            budget -= len(text)
            if budget < 0:
                raise _FileProblem('the definition files together are too large')
            if kind == 'factory':
                factory_raw = _yaml(text)
            elif kind == 'agent':
                agents[ids[0]] = _front_matter(text)
            elif kind in ('agent_skill', 'skill'):
                body = text.strip()
                (local_skills.setdefault(ids[0], {}) if kind == 'agent_skill' else parts['skills']).update({ids[-1]: {'text': body}})
            elif kind in ('mcp', 'runner'):
                parts['mcp' if kind == 'mcp' else 'runners'][ids[0]] = _yaml(text)
            else:  # automation, webhook: package B parses them; the text itself is part of the version
                texts[rel] = text
                parts['automations' if kind == 'automation' else 'webhooks'][ids[0]] = text
        except _FileProblem as exc:
            problem(rel, str(exc))
    _check_reserved(parts, texts, issues)
    if factory_raw is None:
        if not any(i.file == 'factory.yaml' for i in issues):
            problem('factory.yaml', 'is required')
        return Loaded(None, sorted(issues, key=lambda i: (i.file, i.path)))
    if not isinstance(factory_raw, dict):
        problem('factory.yaml', 'must be a mapping')
        return Loaded(None, issues)
    for section in _SECTIONS_FROM_LAYOUT:
        if section in factory_raw:
            issues.append(Issue('factory.yaml', section, 'comes from the folder layout, not from factory.yaml'))
            del factory_raw[section]
    defaults = factory_raw.get('defaults') if isinstance(factory_raw.get('defaults'), dict) else {}
    merged = {
        **factory_raw,
        'defaults': factory_raw.get('defaults', {}),
        'tiers': factory_raw.get('tiers', {}),
        'ceilings': factory_raw.get('ceilings', {}),
        'policy': _with(rules.POLICY_DEFAULTS, factory_raw.get('policy', {})),
        'stages': factory_raw.get('stages', {}),
        'runners': {k: _with(rules.RUNNER_DEFAULTS, v) for k, v in parts['runners'].items()},
        'agents': {name: _agent(fm, body, defaults, local_skills.get(name, {})) for name, (fm, body) in agents.items()},
        'skills': parts['skills'], 'mcp': parts['mcp'],
        'reserved': {'automations': parts['automations'], 'webhooks': parts['webhooks']},
    }
    for name, (fm, _) in agents.items():
        for key in ('instructions', 'localSkills'):
            if isinstance(fm, dict) and key in fm:
                issues.append(Issue(f'agents/{name}/agent.md', f'agents.{name}.{key}', 'comes from the file body or the skills folder, not the front matter'))
    for name in local_skills.keys() - agents.keys():
        problem(f'agents/{name}/skills', 'skills of an agent that has no agent.md')
    merged = _integral_floats(merged)  # 100000.0 and 100000 are one value, one hash
    schema = _schema_issues(merged)
    issues += schema + _secret_issues(merged) + _single_line_issues(merged)
    if not schema:
        issues += _semantic_issues(merged)
    issues = sorted(set(issues), key=lambda i: (i.file, i.path, i.message))
    hash_ = hash_of(merged) if not any(i.severity == 'error' for i in issues) else None
    return Loaded(merged, issues, hash_)


def _integral_floats(node):
    if isinstance(node, dict):
        return {k: _integral_floats(v) for k, v in node.items()}
    if isinstance(node, list):
        return [_integral_floats(v) for v in node]
    return int(node) if isinstance(node, float) and node.is_integer() else node


def _check_reserved(parts: dict, texts: dict, issues: list[Issue]) -> None:
    """Webhooks and automations belong to the intake package: its own parsers decide, so there is one meaning for each file."""
    from factory_intake.automations import AutomationError, parse_automation
    from factory_intake.config import ConfigError, parse_webhook

    for name, text in parts['webhooks'].items():
        try:
            parse_webhook(name, text)
        except ConfigError as exc:
            issues.append(Issue(f'webhooks/{name}.yaml', '', _scrub(str(exc).split(': ', 1)[-1])))
    for name, text in parts['automations'].items():
        try:
            parse_automation(name, text)
        except AutomationError as exc:
            issues.append(Issue(f'automations/{name}/automation.md', '', _scrub(str(exc).split(': ', 1)[-1])))


# --------------------------------------------------------------------------------------------------------------------------- diff

def diff(before: dict, after: dict, prefix: str = '') -> list[Change]:
    """Field by field. Dicts are walked; lists and scalars compare whole. Secrets are absent from a definition by construction."""
    changes: list[Change] = []
    for key in sorted(before.keys() | after.keys()):
        path = f'{prefix}.{key}' if prefix else key
        if key not in after:
            changes.append(Change(path, 'removed', before[key]))
        elif key not in before:
            changes.append(Change(path, 'added', None, after[key]))
        elif isinstance(before[key], dict) and isinstance(after[key], dict):
            changes += diff(before[key], after[key], path)
        elif before[key] != after[key]:
            changes.append(Change(path, 'changed', before[key], after[key]))
    return changes


# -------------------------------------------------------------------------------------------------------------------------- check

@dataclass(frozen=True)
class Example:
    name: str
    stages: list[str]
    note: str


@dataclass(frozen=True)
class Report:
    ok: bool
    examples: list[Example]
    problems: list[str]

    def as_dict(self) -> dict:
        return {'ok': self.ok, 'problems': self.problems,
                'examples': [{'name': e.name, 'stages': e.stages, 'note': e.note} for e in self.examples]}


def check(definition: dict) -> Report:
    """Mock run of the definition (ADR 0056): example work items are walked through the stages it enables. No provider, no network."""
    flags, policy = stage_flags(definition), definition['policy']
    running = [s for s in rules.CONFIGURABLE_STAGES if flags[s]['available'] and flags[s]['enabled']]
    problems: list[str] = []
    for stage, flag in flags.items():
        if flag['required'] and stage not in running:
            problems.append(f'stage {stage} is required but cannot run')
    if (problem := independence_problem(definition)) and policy['reviewIndependence'] == 'require':
        problems.append(problem)

    def path(*wanted: str) -> list[str]:
        return [s for s in wanted if s in running]

    spec_needed = policy['requireSpec']
    small = path('triage', *(['spec'] if spec_needed else []), 'implement', 'review', 'verify')
    big = path('triage', 'spec', 'implement', 'review', 'verify')
    waiting = path('triage', 'spec')
    examples = [
        Example('small-fix', small, 'small and clear: goes straight to implement' + (' after the required spec' if spec_needed else '')),
        Example('needs-spec', big, 'needs a spec' + ('' if 'spec' in running else ' (no spec stage: it waits for a person)')),
        Example('ambiguous', waiting, 'asks the person instead of guessing, then waits in the inbox'),
    ]
    return Report(not problems, examples, problems)


# --------------------------------------------------------------------------------------------------------------------------- CLI

def cli_validate(directory: str | Path, run_check: bool = False) -> tuple[int, dict]:
    """`oharness factory validate <dir> [--check]`: 0 valid, 1 invalid, 2 usage (the convention of `oharness validate`)."""
    try:
        loaded = load(directory)
    except DefinitionNotFound:
        return 2, {'ok': False, 'errors': [{'file': '.', 'path': '', 'message': 'the folder does not exist', 'severity': 'error'}]}
    payload: dict = {'ok': loaded.ok, 'hash': loaded.hash, 'errors': [i.as_dict() for i in loaded.issues if i.severity == 'error'],
                     'warnings': [i.as_dict() for i in loaded.issues if i.severity == 'warning']}
    if run_check and loaded.definition is not None and loaded.ok:
        report = check(loaded.definition)
        payload['check'] = report.as_dict()
        payload['ok'] = loaded.ok and report.ok
    return (0 if payload['ok'] else 1), payload
