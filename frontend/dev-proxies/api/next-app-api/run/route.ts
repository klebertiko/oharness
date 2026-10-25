import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND =
  process.env.OHARNESS_BACKEND_URL ??
  process.env.OPENHARNESS_BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:8000";

/**
 * Same-origin proxy in front of the execution service.
 *
 * The panel talks to this route instead of the Python process directly. Two
 * reasons, both load-bearing: the packaged Tauri webview refuses a cross-origin
 * call to a localhost port, and the backend's SSE response has to reach the
 * browser unbuffered — which means passing the upstream body through untouched
 * rather than awaiting it.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND}/execute/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: req.signal,
      cache: "no-store",
    });
  } catch (err) {
    return Response.json(
      { error: `Execution service unreachable at ${BACKEND}: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: await upstream.text() },
      { status: upstream.status || 502 }
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
