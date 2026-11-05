"""Files of a valid factory definition (ADR 0056 layout), shared by the factory definition tests."""
from __future__ import annotations


FACTORY = """\
kind: forja
schemaVersion: 1.0.0
name: payments
alias: payments
defaults:
  model: openai/gpt-4o
repositories:
  - id: app
    path: .
    protectedBranches: [main]
tiers:
  fast:
    models: [openai/gpt-4o-mini]
  deep:
    models: [openai/gpt-4o, anthropic/claude-opus]
ceilings:
  tokensPerWorkItem: 500000
  tokensPerRun: 100000
stages:
  review:
    required: true
"""


def agent_md(role: str, model: str | None = None, mode: str | None = None, extra: str = '', body: str = 'Do the job.') -> str:
    lines = ['kind: agent', f'role: {role}']
    if model:
        lines.append(f'model: {model}')
    if mode:
        lines += ['permissions:', f'  mode: {mode}']
    return '---\n' + '\n'.join(lines) + ('\n' + extra if extra else '') + '\n---\n' + body + '\n'


FILES = {
    'forja.yaml': FACTORY,
    'agents/foreman/agent.md': agent_md('foreman'),
    'agents/builder/agent.md': agent_md('implement', 'openai/gpt-4o', 'workspace_write'),
    'agents/reviewer/agent.md': agent_md('review', 'anthropic/claude-opus', 'read_only'),
}


