"""Build a Forja folder from a ready-made workflow.

The person's sentence is kept as a note for the foreman. It is not applied as a change to
gates: a request to drop review still leaves the review gate in place. The caller validates
the folder before anything is saved.
"""
from __future__ import annotations

from factory.agents import starter_files
from factory.definition import looks_secret

RECIPES = {
    'issue-pr': ['triage', 'spec', 'implement', 'review', 'verify'],
    'triage': ['triage'],
    'review': ['review'],
    'incident': ['implement', 'review', 'verify'],
    'monorepo': ['implement', 'review'],
}
_MODEL = 'openai/gpt-4o'
_REVIEW_MODEL = 'anthropic/claude-opus'


def compose(recipe: str, name: str, request: str) -> dict[str, str]:
    roles = RECIPES.get(recipe)
    if roles is None:
        raise ValueError(recipe)
    review = _REVIEW_MODEL if 'review' in roles and 'implement' in roles else None
    files = starter_files(name, _MODEL, review, list(roles))
    note = _note(request)
    if note:
        path = 'agents/foreman/agent.md'
        files[path] = files[path].rstrip() + '\nThe person asked: ' + note + '\n'
    return files


def _note(request: str) -> str:
    line = ' '.join(request.split())
    if not line or looks_secret(line):
        return ''
    return line[:200]
