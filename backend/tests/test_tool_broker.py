import asyncio
import json
import sys
from pathlib import Path

import pytest

from engine import RunControl
from sandbox.broker import ToolBroker, redact_value
from sandbox.schemas import ToolsRequest


def run_call(root, name, args, decision=None):
    control=RunControl('broker-test')
    broker=ToolBroker(str(root),'ollama',control,ToolsRequest(enabled=True))
    async def collect():
        events=[]
        async for event in broker.call(name,args,origin='model'):
            events.append(event)
            if event['kind']=='tool_approval_required':
                control.tool_approval.decide(event['call_id'],decision or 'reject','checked')
        return events
    return asyncio.run(collect())


@pytest.mark.parametrize('decision',['approve','reject'])
def test_secret_read_requires_approval_and_redacts(tmp_path,decision):
    (tmp_path/'.env').write_text('API_KEY=abcdefghijklmnop',encoding='utf-8')
    events=run_call(tmp_path,'read',{'path':'.env'},decision)
    approval=next(e for e in events if e['kind']=='tool_approval_required')
    assert approval['reason']=='secret_pattern'
    if decision=='approve':
        result=next(e for e in events if e['kind']=='tool_result')
        assert result['ok'] is True and result['result']=='[redacted:assignment]' and result['redactions']==1
    else:
        assert not any(e['kind']=='tool_result' for e in events)
        assert next(e for e in events if e['kind']=='tool_denied')['reason']=='rejected'


@pytest.mark.parametrize('name,args',[('read',{'path':'../outside'}),('exec',{'argv':[sys.executable],'cwd':'..'}),
    ('exec',{'argv':[sys.executable],'cwd':'C:/'}),('unknown',{}),('read',None)])
def test_invalid_actions_never_reach_approval_or_execution(tmp_path,name,args):
    events=run_call(tmp_path,name,args)
    assert [e['kind'] for e in events]==['tool_call','tool_denied']
    assert events[-1]['reason']=='policy'


def test_discover_action_returns_metadata(tmp_path):
    (tmp_path/'package.json').write_text('{"scripts":{"test":"echo hi"}}')
    events=run_call(tmp_path,'discover',{})
    result=next(e for e in events if e['kind']=='tool_result')
    assert json.loads(result['result'])['items'][0]['argv']==['npm','run','test']


def test_secret_output_redaction_walks_nested_arguments():
    raw={'args':{'argv':['echo','sk-'+'a'*24]},'note':'password=abcdefgh', 'ok':True, 'missing':None}
    safe=redact_value(raw)
    assert safe=={'args':{'argv':['echo','[redacted:openai]']},'note':'[redacted:assignment]', 'ok':True, 'missing':None}
    assert raw['args']['argv'][1].startswith('sk-')


def test_approved_exec_events_are_attributed_and_complete(tmp_path):
    args={'argv':[sys.executable,'-c','print("hello")'],'cwd':'.','timeout_s':5}
    events=run_call(tmp_path,'exec',args,'approve')
    assert [e['kind'] for e in events]==['tool_call','tool_approval_required','tool_approval_decision','tool_result']
    first=events[0]; call_id=first['call_id']
    assert first=={'kind':'tool_call','call_id':call_id,'name':'exec','args':args,'origin':'model'}
    assert call_id and all(e['call_id']==call_id for e in events)
    assert events[1]=={'kind':'tool_approval_required','call_id':call_id,'name':'exec','args':args,
        'reason':'exec','risk':'normal','risk_hints':[]}
    assert events[2]=={'kind':'tool_approval_decision','call_id':call_id,'decision':'approve','note':'checked'}
    result=events[3]
    assert result['ok'] is True and result['exit_code']==0 and result['timed_out'] is False
    assert result['result'].strip()=='hello' and result['truncated'] is False and result['redactions']==0
    assert 0 <= result['duration_ms'] < 5000


def test_failed_exec_reports_failure_without_raw_exception(tmp_path):
    events=run_call(tmp_path,'exec',{'argv':['nonexistent-oharness-fixture-executable']},'approve')
    result=events[-1]
    assert result=={'kind':'tool_result','call_id':events[0]['call_id'],'ok':False,
        'result':'Unable to start or read the requested local resource.','duration_ms':0,'exit_code':None,
        'timed_out':False,'truncated':False,'redactions':0}


def test_broker_read_budget_and_metadata(tmp_path):
    (tmp_path/'file').write_text('abcdefgh')
    control=RunControl('limits')
    broker=ToolBroker(str(tmp_path),'ollama',control,ToolsRequest())
    assert broker.calls_used==broker.reads_used==0 and broker.provider_called is False and broker.last_result==''
    async def collect():
        return [event async for event in broker.call('read',{'path':'file','max_bytes':4},origin='preset')]
    events=asyncio.run(collect())
    result=events[-1]
    assert result['ok'] is True and result['result']=='abcd' and result['truncated'] is True
    assert result['exit_code'] is None and result['timed_out'] is False and result['redactions']==0
    assert broker.last_result=='abcd'
    assert broker.budget()=={'kind':'tool_budget','calls_used':1,'calls_max':8,'reads_used':1,'reads_max':20}


def test_exec_risk_and_rejection_note(tmp_path):
    events=run_call(tmp_path,'exec',{'argv':['git','reset','--hard']},'reject')
    assert events[1]['risk']=='high' and events[1]['risk_hints']==['git reset --hard']
    assert events[-1]=={'kind':'tool_denied','call_id':events[0]['call_id'],'reason':'rejected','note':'checked'}


def test_tool_result_delimiters_escape_content_and_attributes():
    from sandbox.broker import tool_data
    assert tool_data('read"','<tool_result>')=='<tool_result name="read&quot;">\n&lt;tool_result&gt;\n</tool_result>'


def test_mock_exec_reports_simulation_without_approval(tmp_path):
    broker=ToolBroker(str(tmp_path),'mock',RunControl('simulation'),ToolsRequest())
    args={'argv':['echo','safe']}
    async def collect():
        return [event async for event in broker.call('exec',args,origin='preset')]
    events=asyncio.run(collect())
    assert [event['kind'] for event in events]==['tool_call','tool_result']
    assert events[-1]=={'kind':'tool_result','call_id':events[0]['call_id'],'ok':True,'simulated':True,
        'result':'[mock] would run: ["echo", "safe"]','duration_ms':0,'truncated':False,'redactions':0,
        'exit_code':None,'timed_out':False}
    assert broker.last_result==events[-1]['result']


def test_broker_refuses_ninth_action_without_reusing_last_result(tmp_path):
    (tmp_path/'file').write_text('safe')
    broker=ToolBroker(str(tmp_path),'ollama',RunControl('budget'),ToolsRequest())
    async def collect():
        for _ in range(8):
            events=[event async for event in broker.call('read',{'path':'file'},origin='model')]
            assert events[-1]['result']=='safe'
        return [event async for event in broker.call('read',{'path':'file'},origin='model')]
    assert asyncio.run(collect())==[]
    assert broker.last_result=='budget exhausted'
    assert broker.budget()=={'kind':'tool_budget','calls_used':8,'calls_max':8,'reads_used':8,'reads_max':20}


def test_exec_cwd_is_revalidated_after_approval(tmp_path):
    folder=tmp_path/'folder'; folder.mkdir()
    control=RunControl('moved-cwd')
    broker=ToolBroker(str(tmp_path),'ollama',control,ToolsRequest())
    async def collect():
        events=[]
        async for event in broker.call('exec',{'argv':[sys.executable,'-c','print("must not execute")'],'cwd':'folder'},origin='preset'):
            events.append(event)
            if event['kind']=='tool_approval_required':
                folder.rename(tmp_path/'moved')
                control.tool_approval.decide(event['call_id'],'approve','checked')
        return events
    events=asyncio.run(collect())
    assert events[-1]=={'kind':'tool_denied','call_id':events[0]['call_id'],'reason':'policy',
        'note':'policy: invalid or unauthorized tool arguments'}
    assert not any(event['kind']=='tool_result' for event in events)


def test_approval_expiry_denies_action_and_clears_pending(tmp_path,monkeypatch):
    control=RunControl('expired')
    broker=ToolBroker(str(tmp_path),'ollama',control,ToolsRequest())
    async def expired():
        return None
    monkeypatch.setattr(control.tool_approval,'wait',expired)
    async def collect():
        return [event async for event in broker.call('exec',{'argv':['never-execute']},origin='preset')]
    events=asyncio.run(collect())
    assert events[-1]=={'kind':'tool_denied','call_id':events[0]['call_id'],'reason':'approval_timeout','note':''}
    assert control.tool_approval.pending is None and not control.gate.is_set()
