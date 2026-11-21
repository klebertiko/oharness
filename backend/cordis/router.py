"""`/cordis/*`: the plugin manager as HTTP routes (ADR 0071).

Reads need the sidecar token like every route. Anything that fetches, installs, switches or removes a plugin needs the
human credential, as `/factory/secrets` does: an agent must not be able to put code on this computer. The host's own
address and token never appear in a response or a log.
"""
from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel, Field, field_validator

from cordis import index
from cordis.service import CordisService, ServiceError
from cordis.sources import SourceError
from cordis.supervisor import CordisUnavailable, HostRequestError
from factory.auth import actor_for

router = APIRouter(prefix='/cordis', tags=['cordis'])
PLUGIN_ID = r'^[0-9a-f]{16}$'


class FetchBody(BaseModel):
    kind: Literal['npm', 'github', 'local']
    spec: str = Field(min_length=1, max_length=1024)
    version: str | None = Field(default=None, max_length=128)
    commit: str | None = Field(default=None, max_length=64)
    subdir: str | None = Field(default=None, max_length=512)


class InstallBody(BaseModel):
    fetch_id: str = Field(max_length=32)
    accept: bool
    digest: str = Field(max_length=128)
    scripts: Literal['do-not-run'] | None = None
    # The plugin's own configuration, as Cordis `apply(ctx, config)` gets it (DSH tool-todo needs one). Small and plain JSON.
    config: dict[str, Any] | None = None

    @field_validator('config')
    @classmethod
    def small_config(cls, value):
        if value is not None and len(json.dumps(value)) > 16384:
            raise ValueError('config is at most 16 KiB')
        return value


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
def fetch_plugin(request: Request, body: FetchBody):
    _human(request)
    return _call(lambda: _service(request).fetch(body.kind, body.spec, version=body.version, commit=body.commit, subdir=body.subdir))


@router.post('/plugins/install')
def install_plugin(request: Request, body: InstallBody):
    _human(request)
    return _call(lambda: _service(request).install(body.fetch_id, accept=body.accept, digest=body.digest, scripts=body.scripts, config=body.config))


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
    _human(request)  # plugin output can carry what the plugin read; only the person sees it
    return {'lines': _call(lambda: _service(request).logs(plugin_id, tail))}


@router.get('/plugins/{plugin_id}/export')
def export_plugin(request: Request, plugin_id: str = Path(pattern=PLUGIN_ID)):
    _human(request)  # the package may be a local folder of the person's; only they export it
    filename, data = _call(lambda: _service(request).export(plugin_id))
    return Response(content=data, media_type='application/gzip', headers={'content-disposition': f'attachment; filename="{filename}"'})


class CreatorBody(BaseModel):
    enabled: bool


class InvokeBody(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    args: Any = None


class CommandBody(BaseModel):
    line: str = Field(min_length=1, max_length=4096)


class IndexBody(BaseModel):
    url: str = Field(min_length=9, max_length=2048)


@router.get('/creator')
def creator_mode(request: Request):
    return {'enabled': _service(request).creator_enabled()}


@router.post('/creator')
def set_creator_mode(request: Request, body: CreatorBody):
    _human(request)  # turning it on gives the chat agent the cordis_plugins tool
    return _service(request).set_creator(body.enabled)


@router.get('/requests')
def list_requests(request: Request):
    return {'requests': _service(request).list_requests()}


@router.post('/requests/{request_id}/approve')
def approve_request(request: Request, request_id: str = Path(pattern=PLUGIN_ID)):
    _human(request)  # the only way a package from Nilo is installed
    return _call(lambda: _service(request).approve_request(request_id))


@router.post('/requests/{request_id}/reject')
def reject_request(request: Request, request_id: str = Path(pattern=PLUGIN_ID)):
    _human(request)
    return _call(lambda: _service(request).reject_request(request_id))


@router.post('/tools/invoke')
def invoke_tool(request: Request, body: InvokeBody):
    return _call(lambda: _service(request).invoke_tool(body.name, body.args))


@router.post('/commands/execute')
def execute_command(request: Request, body: CommandBody):
    return _call(lambda: _service(request).execute_command(body.line))


@router.post('/index/fetch')
def fetch_index(request: Request, body: IndexBody):
    _human(request)  # the person names the index; the sidecar fetches it so the screen never talks to a third party
    service = _service(request)
    try:
        return index.fetch(body.url, fetcher=service.index_fetcher, resolve=service.index_resolver)
    except index.IndexError_ as error:
        raise HTTPException(status_code=422, detail={'code': error.code, 'message': error.message}) from None
