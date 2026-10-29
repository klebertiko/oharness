import pytest
from pydantic import ValidationError
from sandbox.schemas import ToolsRequest

RUN_COMMAND_DESCRIPTION = ('Run a program locally. No shell: argv only. A command needs the user approval unless the conversation permission mode '
    'runs it automatically (Auto: read-only git and listings in any workspace; project scripts such as npm test or pytest only in a workspace '
    'the user trusted; Workspace write: also mkdir, touch, cp and mv with every path inside the workspace; Full: most commands, except high-risk '
    'ones). Read-only refuses any command that could write and Plan refuses every command; the user sees each refusal with its reason.')


@pytest.mark.parametrize('preset',[
    {'name':'exec','argv':['echo','']}, {'name':'exec','argv':['echo'],'timeout_s':1},
    {'name':'exec','argv':['echo'],'timeout_s':600}, {'name':'read','path':'file','max_bytes':1},
    {'name':'read','path':'file','max_bytes':262144,'truncate':False}, {'name':'discover'},
])
def test_preset_accepts_contract_boundary_values(preset):
    result=ToolsRequest.model_validate({'enabled':True,'preset':preset,'summarize':False})
    assert result.enabled is True and result.summarize is False
    assert result.preset.model_dump().items() >= preset.items()


@pytest.mark.parametrize('preset',[
    {'name':'exec','argv':[]}, {'name':'exec','argv':['']}, {'name':'exec','argv':['echo'],'timeout_s':0},
    {'name':'exec','argv':['echo'],'timeout_s':601}, {'name':'exec','argv':['echo'],'timeout_s':True},
    {'name':'exec','argv':['echo',1]}, {'name':'exec','argv':['echo'],'cwd':False},
    {'name':'read','path':''}, {'name':'read','path':'file','max_bytes':0},
    {'name':'read','path':'file','max_bytes':262145}, {'name':'read','path':'file','max_bytes':True},
    {'name':'read','path':'file','truncate':'false'}, {'name':'discover','argv':['oops']},
])
def test_preset_rejects_invalid_contract_arguments(preset):
    with pytest.raises(ValidationError): ToolsRequest.model_validate({'preset':preset})


def test_option_defaults_and_exact_strict_types():
    options=ToolsRequest()
    assert options.enabled is False and options.preset is None and options.summarize is True
    for values in ({'enabled':1},{'summarize':'false'},{'extra':True}):
        with pytest.raises(ValidationError): ToolsRequest.model_validate(values)
    read=ToolsRequest(preset={'name':'read','path':'file'}).preset
    assert read.model_dump()=={'name':'read','path':'file','max_bytes':262144,'truncate':True}
    command=ToolsRequest(preset={'name':'exec','argv':['echo']}).preset
    assert command.model_dump()=={'name':'exec','argv':['echo'],'cwd':'.','timeout_s':60}


def test_model_functions_expose_valid_argument_contracts():
    from sandbox.schemas import TOOL_SCHEMAS, validate_call
    examples = {
        'read_file': ('read', {'path': 'README.md'}, {'path': 'string'}, ['path']),
        'list_workspace': ('discover', {}, {}, []),
        'run_command': ('exec', {'argv': ['python', '--version']},
                        {'argv': 'array', 'cwd': 'string', 'timeout_s': 'integer'}, ['argv']),
    }
    assert len(TOOL_SCHEMAS) == len(examples)
    for tool in TOOL_SCHEMAS:
        assert tool['type'] == 'function'
        function = tool['function']
        name, arguments, properties, required = examples[function['name']]
        assert isinstance(function['description'], str) and function['description'].strip()
        schema = function['parameters']
        assert schema['type'] == 'object'
        assert {key: item['type'] for key, item in schema['properties'].items()} == properties
        assert schema.get('required', []) == required
        if name == 'exec':
            assert schema['properties']['argv']['items'] == {'type': 'string'}
        parsed = validate_call(name, arguments)
        assert parsed.name == name and parsed.model_dump().items() >= arguments.items()
    with pytest.raises(ValueError, match='^unknown_tool$'):
        validate_call('unadvertised', {})


def test_model_tool_schema_is_the_exact_published_contract():
    from sandbox.schemas import TOOL_SCHEMAS

    assert TOOL_SCHEMAS == [
        {
            'type': 'function',
            'function': {
                'name': 'read_file',
                'description': 'Read a UTF-8 text file inside the workspace.',
                'parameters': {
                    'type': 'object',
                    'properties': {'path': {'type': 'string'}},
                    'required': ['path'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'list_workspace',
                'description': 'List skills, commands and npm scripts in the workspace.',
                'parameters': {'type': 'object', 'properties': {}},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'run_command',
                'description': RUN_COMMAND_DESCRIPTION,
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'argv': {'type': 'array', 'items': {'type': 'string'}},
                        'cwd': {'type': 'string'},
                        'timeout_s': {'type': 'integer'},
                    },
                    'required': ['argv'],
                },
            },
        },
    ]
