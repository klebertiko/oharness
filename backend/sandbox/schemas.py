from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')


class Read(StrictModel):
    name: Literal['read'] = 'read'
    path: str = Field(min_length=1)
    max_bytes: int = Field(default=262144, ge=1, le=262144)
    truncate: bool = True


class Exec(StrictModel):
    name: Literal['exec'] = 'exec'
    argv: list[str] = Field(min_length=1)
    cwd: str = '.'
    timeout_s: int = Field(default=60, ge=1, le=600)

    @field_validator('argv')
    @classmethod
    def executable_present(cls, value):
        if not value[0]:
            raise ValueError('executable is required')
        return value


class Discover(StrictModel):
    name: Literal['discover'] = 'discover'


# Must list exactly the ids of permission_modes.json in order (tests/test_chat_permission_presets.py checks it).
PermissionMode = Literal['plan', 'read_only', 'ask', 'auto_workspace', 'workspace_write', 'full']
# Opaque, client-chosen conversation key: short, no path or control characters.
THREAD_ID_PATTERN = r'^[A-Za-z0-9_-]{1,64}$'


class ToolsRequest(StrictModel):
    enabled: bool = False
    # The conversation this run belongs to. Its stored mode is the ceiling;
    # `permission_mode` may only tighten it (see sandbox.permission.effective_mode).
    thread_id: str | None = Field(default=None, pattern=THREAD_ID_PATTERN)
    permission_mode: PermissionMode | None = None
    preset: Annotated[Read | Exec | Discover, Field(discriminator='name')] | None = None
    summarize: bool = True
    # Let the model hand tasks to cancellable subagents (#166). Off unless asked for.
    subagents: bool = False


def validate_call(name: str, args: dict):
    schema = {'read': Read, 'exec': Exec, 'discover': Discover}.get(name)
    if schema is None:
        raise ValueError('unknown_tool')
    return schema.model_validate({**args, 'name': name})


RUN_COMMAND_DESCRIPTION = ('Run a program locally. No shell: argv only. A command needs the user approval unless the conversation permission mode '
    'runs it automatically (Auto: read-only git and listings in any workspace; project scripts such as npm test or pytest only in a workspace '
    'the user trusted). In Plan mode (read-only) every command is refused.')

TOOL_SCHEMAS = [
    {'type': 'function', 'function': {'name': 'read_file', 'description': 'Read a UTF-8 text file inside the workspace.',
        'parameters': {'type': 'object', 'properties': {'path': {'type': 'string'}}, 'required': ['path']}}},
    {'type': 'function', 'function': {'name': 'list_workspace', 'description': 'List skills, commands and npm scripts in the workspace.',
        'parameters': {'type': 'object', 'properties': {}}}},
    {'type': 'function', 'function': {'name': 'run_command', 'description': RUN_COMMAND_DESCRIPTION,
        'parameters': {'type': 'object', 'properties': {'argv': {'type': 'array', 'items': {'type': 'string'}},
            'cwd': {'type': 'string'}, 'timeout_s': {'type': 'integer'}}, 'required': ['argv']}}},
]
