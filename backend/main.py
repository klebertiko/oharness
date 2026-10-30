import hmac
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from database import SessionLocal, init_db
from security.sidecar_token import TOKEN_HEADER, get_or_create_token
from routers.bundles import router as bundles_router
from routers.harnesses import router as harnesses_router
from routers.execution import router as execution_router
from routers.providers import router as providers_router
from routers.cowork import router as cowork_router
from routers.workspaces import router as workspaces_router
from routers.usage import router as usage_router
from routers.chat_tools import router as chat_tools_router
from routers.subagents import router as subagents_router
from routers.turn_diff import router as turn_diff_router
from routers.studio_copilot import router as studio_copilot_router
from routers.studio_assist import router as studio_assist_router
from factory.router import router as factory_router
from secret_store.factory import build_secrets_store
from providers.store import load_all as load_provider_connections
import models  # noqa: F401 — register ORM tables for create_all


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    from run_store import recover_interrupted
    await recover_interrupted()
    # OH_SECRETS=memory|file|keychain (default memory for tests / ephemeral).
    if not hasattr(app.state, "secrets_store") or app.state.secrets_store is None:
        app.state.secrets_store = build_secrets_store()
    if not hasattr(app.state, "provider_connections") or app.state.provider_connections is None:
        # Hydrated from the DB, not a fresh {} — connections used to be
        # in-memory only, so every restart silently forgot them while the
        # frontend kept showing stale "connected" status (surfaced live,
        # 2026-09-12). `providers/store.py` is now the durable half.
        async with SessionLocal() as session:
            app.state.provider_connections = await load_provider_connections(session)
    yield


app = FastAPI(title="OHarness API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # Static export / Tauri: UI is not same-origin with the sidecar. Allow
    # local Next and the real Tauri webview origins only.
    #
    # SEC-3 (harness Security Gate, 2026-09-11): "null" was here for packaged
    # file:// assets, but it is also the Origin any sandboxed <iframe> on any
    # website sends — with allow_credentials=True that made every mutating
    # route on this sidecar reachable from a page the user just has open in a
    # browser tab, no interaction required. Proven live against this app
    # (200 on a POST /execute/direct preflight with Origin: null). The
    # packaged app's real webview origins (tauri://localhost etc.) are listed
    # explicitly below and don't need "null".
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://frontend:3000",
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "https://tauri.localhost",
        "http://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_SIDECAR_TOKEN = get_or_create_token()

# Paths reachable with no token — deliberately just the liveness probe. Every
# other route, including read-only GETs, requires the token: a GET can still
# read secrets/credentials indirectly (e.g. connection metadata), and "which
# routes are safe to leave open" is exactly the kind of judgment call that
# drifts wrong over time. One rule, no exceptions to maintain.
_UNAUTHENTICATED_PATHS = {"/health"}


@app.middleware("http")
async def require_sidecar_token(request: Request, call_next):
    """SEC-3 (harness Security Gate, 2026-09-11): loopback binding + a CORS
    allowlist stop *remote* callers (any website in any browser tab) but not
    a *local* one — any other process running as this user could otherwise
    call every route with no credential at all. This is the local half of
    that fix: every route but /health requires
    ``Authorization: Bearer <token>``, where the token is a random secret
    only a process with real filesystem access to this user's profile can
    read (see security/sidecar_token.py for the full picture, including what
    this does and does not cover)."""
    if request.method == "OPTIONS" or request.url.path in _UNAUTHENTICATED_PATHS:
        return await call_next(request)

    auth = request.headers.get(TOKEN_HEADER, "")
    presented = auth.removeprefix("Bearer ").strip() if auth.lower().startswith("bearer ") else ""
    if not hmac.compare_digest(presented, _SIDECAR_TOKEN):
        return JSONResponse(
            {"detail": "Missing or invalid sidecar token."},
            status_code=401,
        )
    return await call_next(request)


app.include_router(harnesses_router)
app.include_router(execution_router)
app.include_router(bundles_router)
app.include_router(providers_router)
app.include_router(cowork_router)
app.include_router(workspaces_router)
app.include_router(usage_router)
app.include_router(chat_tools_router)
app.include_router(subagents_router)
app.include_router(turn_diff_router)
app.include_router(studio_copilot_router)
app.include_router(studio_assist_router)
app.include_router(factory_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
