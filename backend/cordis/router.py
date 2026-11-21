"""`/cordis/*`: the plugin manager as HTTP routes (ADR 0071).

Reads need the sidecar token like every route. Anything that fetches, installs, switches or removes a plugin needs the
human credential, as `/factory/secrets` does: an agent must not be able to put code on this computer. The host's own
address and token never appear in a response or a log.
"""
from __future__ import annotations

import threading
from typing import Any, Literal

import anyio
from fastapi import APIRouter, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel, Field

from cordis.service import CordisService, ServiceError
from cordis.sources import SourceError
from cordis.supervisor import CordisUnavailable, HostRequestError
from factory.auth import actor_for

router = APIRouter(prefix='/cordis', tags=['cordis'])
PLUGIN_ID = r'^[0-9a-f]{16}$'


class FetchBody(BaseModel):
    kind: Literal['npm', 'github', 'tarball', 'local']
    spec: str = Field(min_length=1, max_length=1024)
    version: str | None = Field(default=None, max_length=128)
    commit: str | None = Field(default=None, max_length=64)
    subdir: str | None = Field(default=None, max_length=512)


class InstallBody(BaseModel):
    fetch_id: str = Field(max_length=32)
    accept: bool
    digest: str = Field(max_length=128)
    scripts: Literal['do-not-run'] | None = None
    enable: bool = True


class ShareBody(BaseModel):
    target: Literal['npm', 'git']


class IndexBody(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


class ProposeBody(BaseModel):
    fetch_id: str = Field(max_length=32)
    digest: str = Field(max_length=128)
    summary: str = Field(default='', max_length=400)
    scripts: Literal['do-not-run'] | None = None


class DecideBody(BaseModel):
    decision: Literal['approve', 'reject']
    enable: bool = True


class WriteBody(BaseModel):
    folder: str = Field(min_length=1, max_length=1024)
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(default='', max_length=400)


def _human(request: Request) -> None:
    if actor_for(request)[0] != 'human':
        raise HTTPException(status_code=403, detail={'code': 'human_only', 'message': 'Plugins are managed with the human credential of the app.'})


def _service(request: Request) -> CordisService:
    service = getattr(request.app.state, 'cordis', None)
    if service is None:
        raise HTTPException(status_code=503, detail={'code': 'cordis_unavailable', 'state': 'unavailable', 'message': 'The plugin manager is not running.'})
    return service


def _call(run):
    try:
        return run()
    except ServiceError as error:
        raise HTTPException(status_code=error.status, detail={'code': error.code, 'message': error.message, **error.extra}) from None
    except SourceError as error:
        raise HTTPException(status_code=422, detail={'code': error.code, 'message': error.message}) from None
    except CordisUnavailable as error:
        raise HTTPException(status_code=503, detail={'code': 'cordis_unavailable', 'state': error.state, 'message': error.reason or 'The plugin host is not running.'}) from None
    except HostRequestError:
        raise HTTPException(status_code=502, detail={'code': 'host_error', 'message': 'The plugin host refused the request.'}) from None


@router.get('/status')
def status(request: Request):
    return _service(request).status()


@router.get('/plugins')
def list_plugins(request: Request):
    return {'plugins': _call(lambda: _service(request).list_plugins())}


@router.post('/plugins/fetch')
async def fetch_plugin(request: Request, body: FetchBody):
    """Download and inspect. If the client goes away before the download finishes, the download is cancelled."""
    _human(request)
    service = _service(request)
    cancel = threading.Event()
    box: dict[str, Any] = {}

    def run() -> None:
        try:
            box['value'] = service.fetch(body.kind, body.spec, version=body.version, commit=body.commit, subdir=body.subdir, cancel=cancel)
        except Exception as exc:  # carried back to this request; _call maps the known errors
            box['error'] = exc

    worker = threading.Thread(target=run, name='cordis-fetch')
    worker.start()
    try:
        while worker.is_alive():
            if await request.is_disconnected():
                cancel.set()
            await anyio.sleep(0.05)
    finally:
        worker.join()
    if 'error' in box:
        error = box['error']

        def _raise() -> Any:
            raise error

        return _call(_raise)
    value = box.get('value')
    if not isinstance(value, dict) or await request.is_disconnected():
        fetch_id = value.get('fetchId') if isinstance(value, dict) else None
        if isinstance(fetch_id, str):
            service.discard(fetch_id)
        return Response(status_code=499)
    return value


@router.get('/plugins/fetch/{fetch_id}/log')
def fetch_log(request: Request, fetch_id: str = Path(max_length=32)):
    return {'lines': _call(lambda: _service(request).fetch_log(fetch_id))}


@router.delete('/plugins/fetch/{fetch_id}', status_code=204)
def discard_fetch(request: Request, fetch_id: str = Path(max_length=32)):
    _human(request)
    _call(lambda: _service(request).discard(fetch_id))
    return Response(status_code=204)


@router.post('/plugins/install')
def install_plugin(request: Request, body: InstallBody):
    _human(request)
    return _call(lambda: _service(request).install(body.fetch_id, accept=body.accept, digest=body.digest, scripts=body.scripts, enable=body.enable))


@router.post('/plugins/{plugin_id}/enable')
def enable_plugin(request: Request, plugin_id: str = Path(pattern=PLUGIN_ID)):
    _human(request)
    return _call(lambda: _service(request).enable(plugin_id))


@router.post('/plugins/{plugin_id}/disable')
def disable_plugin(request: Request, plugin_id: str = Path(pattern=PLUGIN_ID)):
    _human(request)
    return _call(lambda: _service(request).disable(plugin_id))


@router.delete('/plugins/{plugin_id}', status_code=204)
def delete_plugin(request: Request, plugin_id: str = Path(pattern=PLUGIN_ID)):
    _human(request)
    _call(lambda: _service(request).delete(plugin_id))
    return Response(status_code=204)


@router.get('/plugins/{plugin_id}/logs')
def plugin_logs(request: Request, plugin_id: str = Path(pattern=PLUGIN_ID), tail: int = Query(200, ge=1, le=500)):
    return {'lines': _call(lambda: _service(request).logs(plugin_id, tail))}


@router.get('/plugins/{plugin_id}/export')
def export_plugin(request: Request, plugin_id: str = Path(pattern=PLUGIN_ID)):
    filename, data = _call(lambda: _service(request).export(plugin_id))
    return Response(content=data, media_type='application/gzip', headers={'content-disposition': f'attachment; filename="{filename}"'})


@router.post('/plugins/{plugin_id}/share')
def share_plugin(request: Request, body: ShareBody, plugin_id: str = Path(pattern=PLUGIN_ID)):
    _human(request)
    return _call(lambda: _service(request).share(plugin_id, body.target))


@router.get('/marketplace')
def marketplace(request: Request):
    return _call(lambda: _service(request).marketplace())


@router.post('/marketplace')
def marketplace_from(request: Request, body: IndexBody):
    _human(request)
    return _call(lambda: _service(request).marketplace_from(body.url))


@router.get('/creator/apis')
def creator_apis(request: Request):
    _service(request)
    from cordis.creator import APIS
    return {'apis': list(APIS)}


@router.get('/creator/actions')
def creator_actions(request: Request):
    return {'actions': _call(lambda: _service(request).actions.list())}


@router.post('/creator/actions')
def propose_action(request: Request, body: ProposeBody):
    _human(request)
    return _call(lambda: _service(request).propose_action(body.fetch_id, body.digest, body.summary, body.scripts))


@router.post('/creator/actions/{action_id}/decide')
def decide_action(request: Request, body: DecideBody, action_id: str = Path(pattern=PLUGIN_ID)):
    _human(request)
    return _call(lambda: _service(request).decide_action(action_id, body.decision, enable=body.enable))


@router.post('/creator/write')
def write_starter(request: Request, body: WriteBody):
    _human(request)
    return _call(lambda: _service(request).write_plugin_starter(body.folder, body.name, body.description))
