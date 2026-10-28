"""Subagents (#166): children a run starts beside itself, each cancellable on its own.

A child is one plain provider turn with no tools of its own and no children, so
it adds no capability the parent lacks. Children run concurrently, report
state as events, and a cancel reaches exactly one of them; the parent run and
the siblings keep going. Stopping the whole run ends every child.
`SUBAGENT_RULES` is the one table for the broker and the UI.
"""
import asyncio
import uuid
from dataclasses import dataclass, field, replace

from .secrets import redact

SUBAGENT_RULES = {
    'max_children': 4,
    'task_max_chars': 4000,
    'timeout_s': 300,
    'result_max_chars': 20000,
    'progress_step_chars': 200,
}

SUBAGENT_PROMPT = 'You are a subagent working on one task for another agent. Answer it directly and concisely. You have no tools.'

RUNNING, DONE, CANCELLED, ERROR = 'running', 'done', 'cancelled', 'error'


def subagent_schema() -> dict:
    return {'type': 'function', 'function': {
        'name': 'run_subagent',
        'description': ('Hand one self-contained task to a subagent that works alongside you and returns its answer. '
                        'Several calls in one turn run at the same time. A subagent has no tools.'),
        'parameters': {'type': 'object', 'properties': {'task': {'type': 'string'}}, 'required': ['task']}}}


@dataclass
class Child:
    id: str
    parent_call_id: str
    task: str
    state: str = RUNNING
    chars: int = 0
    tokens: int = 0
    cancel_requested: bool = False
    task_handle: asyncio.Task | None = field(default=None, repr=False)


class SubagentGroup:
    def __init__(self, control):
        self.control = control
        self.children: dict[str, Child] = {}
        self.results: dict[str, str] = {}

    def register(self, parent_call_id: str, task: str) -> Child:
        child = Child(id=str(uuid.uuid4()), parent_call_id=parent_call_id, task=task)
        self.children[child.id] = child
        return child

    def get(self, child_id: str):
        return self.children.get(child_id)

    def cancel(self, child_id: str) -> bool:
        """Cancel one running child. False when it is unknown or already over."""
        child = self.children.get(child_id)
        if child is None or child.state != RUNNING:
            return False
        child.cancel_requested = True
        child.state = CANCELLED
        if child.task_handle is not None:
            child.task_handle.cancel()
        return True

    def _cancel_all(self):
        for child_id in list(self.children):
            self.cancel(child_id)

    async def run(self, calls, adapter, config):
        """Start one child per `(parent_call_id, task)` and yield events until every child is over."""
        queue: asyncio.Queue = asyncio.Queue()
        pending = 0
        for call_id, task in calls:
            if len(self.children) >= SUBAGENT_RULES['max_children']:
                self.results[call_id] = 'subagent limit reached for this run'
                continue
            child = self.register(call_id, task if isinstance(task, str) else '')
            yield {'kind': 'subagent_start', 'child_id': child.id, 'parent_call_id': call_id,
                   'task': redact(child.task[:200])[0], 'state': RUNNING}
            if not isinstance(task, str) or not task.strip() or len(task) > SUBAGENT_RULES['task_max_chars']:
                child.state = ERROR
                self.results[call_id] = 'subagent task is empty or too long'
                yield {'kind': 'subagent_done', 'child_id': child.id, 'parent_call_id': call_id,
                       'state': ERROR, 'chars': 0, 'tokens': 0, 'error': 'invalid_task'}
                continue
            child.task_handle = asyncio.create_task(self._child(child, adapter, config, queue))
            pending += 1
        stopper = asyncio.ensure_future(self.control.stop.wait())
        stopping = False
        try:
            while pending:
                getter = asyncio.ensure_future(queue.get())
                if stopping:
                    event = await getter
                else:
                    done, _ = await asyncio.wait({getter, stopper}, return_when=asyncio.FIRST_COMPLETED)
                    if getter not in done:
                        getter.cancel()
                        stopping = True
                        self._cancel_all()
                        continue
                    event = getter.result()
                yield event
                if event['kind'] == 'subagent_done':
                    pending -= 1
        finally:
            stopper.cancel()
            handles = [c.task_handle for c in self.children.values() if c.task_handle is not None]
            for handle in handles:
                handle.cancel()
            await asyncio.gather(*handles, return_exceptions=True)

    async def _child(self, child: Child, adapter, config, queue):
        parts, error = [], None
        cfg = replace(config, system_prompt=SUBAGENT_PROMPT)
        step = SUBAGENT_RULES['progress_step_chars']

        async def consume():
            reported = 0
            async for ev in adapter.stream_events(child.task, cfg):
                if ev.get('kind') == 'text':
                    parts.append(ev['text'])
                    child.chars += len(ev['text'])
                    if child.chars - reported >= step:
                        reported = child.chars
                        await queue.put({'kind': 'subagent_progress', 'child_id': child.id, 'chars': child.chars})
                elif ev.get('kind') == 'usage':
                    child.tokens = int(ev.get('tokens') or 0)
        try:
            await asyncio.wait_for(consume(), SUBAGENT_RULES['timeout_s'])
            child.state = CANCELLED if child.cancel_requested else DONE
        except asyncio.CancelledError:
            if not child.cancel_requested:
                raise
            child.state = CANCELLED
        except asyncio.TimeoutError:
            child.state, error = ERROR, 'timeout'
        except Exception:  # noqa: BLE001 -- a failing child must not take the parent down
            child.state, error = ERROR, 'provider_error'
        if child.state == CANCELLED:
            self.results[child.parent_call_id] = 'subagent cancelled by the user'
        elif error:
            self.results[child.parent_call_id] = f'subagent failed: {error}'
        else:
            self.results[child.parent_call_id] = ''.join(parts)[:SUBAGENT_RULES['result_max_chars']]
        child.tokens = child.tokens or child.chars // 4
        done = {'kind': 'subagent_done', 'child_id': child.id, 'parent_call_id': child.parent_call_id,
                'state': child.state, 'chars': child.chars, 'tokens': child.tokens}
        if error:
            done['error'] = error
        await queue.put(done)
