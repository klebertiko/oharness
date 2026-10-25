import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND =
  process.env.OHARNESS_BACKEND_URL ??
  process.env.OPENHARNESS_BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:8000";

/**
 * Out-of-band control for a run that is already streaming: stop, step, resolve
 * a human gate, or push a steering message into the engine's inbox.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ runId: string }> }
) {
  const { runId } = await ctx.params;
  const body = await req.text();

  try {
    const upstream = await fetch(
      `${BACKEND}/execute/${encodeURIComponent(runId)}/control`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        cache: "no-store",
      }
    );
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
