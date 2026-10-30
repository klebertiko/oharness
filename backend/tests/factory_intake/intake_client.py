"""A minimal synchronous ASGI client for the intake app. The shared ``TestClient`` in this suite stamps the sidecar's bearer token on every
request (``conftest``), which would hide exactly what these tests check: the intake server's *own* authentication."""
import asyncio

import httpx


class TestClient:
    __test__ = False

    def __init__(self, app):
        self._app = app

    def request(self, method, url, **kwargs):
        async def go():
            transport = httpx.ASGITransport(app=self._app, raise_app_exceptions=False)
            async with httpx.AsyncClient(transport=transport, base_url="http://intake.test") as client:
                return await client.request(method, url, **kwargs)

        return asyncio.run(go())

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)
