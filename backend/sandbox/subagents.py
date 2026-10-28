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
    error: str | None = None
    task_handle: asyncio.Task | None = field(default=None, repr=False)


class SubagentGroup:
    def __init__(self, control):
        self.control = control
        self.children: dict[str, Child] = {}
        self.results: dict[str, str] = {}
        self.round: list = []

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
        """Start one child per `(parent_call_id, task)` and yield events until every child is over.

        `self.results` (call id -> text for the model) and `self.round` (the children of this call)
        describe this call only, so a provider that reuses call ids across turns cannot cross them.
        """
        self.results, self.round = {}, []
        queue: asyncio.Queue = asyncio.Queue()
        pending = 0
        for call_id, task in calls:
            if sum(1 for c in self.children.values() if c.task_handle is not None) >= SUBAGENT_RULES['max_children']:
                self.results[call_id] = 'subagent limit reached for this run'
                continue
            child = self.register(call_id, task if isinstance(task, str) else '')
            self.round.append(child)
            yield {'kind': 'subagent_start', 'child_id': child.id, 'parent_call_id': call_id,
                   'task': redact(child.task)[0][:200], 'state': RUNNING}
            if not isinstance(task, str) or not task.strip() or len(task) > SUBAGENT_RULES['task_max_chars']:
                child.state = ERROR
                self.results[call_id] = 'subagent task is empty or too long'
                yield self._done_event(child, 'invalid_task')
                continue
            child.task_handle = asyncio.create_task(self._child(child, adapter, config, queue))
            # The callback fires even when the task is cancelled before its body ever ran.
            child.task_handle.add_done_callback(lambda _t, c=child: queue.put_nowait({'kind': '_over', 'child': c}))
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
                if event['kind'] != '_over':
                    yield event
                    continue
                pending -= 1
                child = event['child']
                if child.state == RUNNING or (child.state == CANCELLED and child.parent_call_id not in self.results):
                    child.state = CANCELLED
                    self.results[child.parent_call_id] = 'subagent cancelled by the user'
                yield self._done_event(child, child.error)
        finally:
            stopper.cancel()
            handles = [c.task_handle for c in self.round if c.task_handle is not None]
            for handle in handles:
                handle.cancel()
            await asyncio.gather(*handles, return_exceptions=True)

    @staticmethod
    def _done_event(child, error=None):
        done = {'kind': 'subagent_done', 'child_id': child.id, 'parent_call_id': child.parent_call_id,
                'state': child.state, 'chars': child.chars, 'tokens': child.tokens or child.chars // 4}
        if error:
            done['error'] = error
        return done

    async def _child(self, child: Child, adapter, config, queue):
        parts, kept = [], 0
        cfg = replace(config, system_prompt=SUBAGENT_PROMPT)
        step, cap = SUBAGENT_RULES['progress_step_chars'], SUBAGENT_RULES['result_max_chars']

        async def consume():
            nonlocal kept
            reported = 0
            async for ev in adapter.stream_events(child.task, cfg):
                if ev.get('kind') == 'text':
                    child.chars += len(ev['text'])
                    if kept < cap:  # a runaway child cannot grow memory past the result cap
                        parts.append(ev['text'][:cap - kept])
                        kept += len(parts[-1])
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
            child.state, child.error = ERROR, 'timeout'
        except Exception:  # noqa: BLE001 -- a failing child must not take the parent down
            child.state, child.error = ERROR, 'provider_error'
        if child.state == CANCELLED:
            self.results[child.parent_call_id] = 'subagent cancelled by the user'
        elif child.error:
            self.results[child.parent_call_id] = f'subagent failed: {child.error}'
        else:
            # Same redaction the parent applies to every other tool result.
            self.results[child.parent_call_id] = redact(''.join(parts))[0]
