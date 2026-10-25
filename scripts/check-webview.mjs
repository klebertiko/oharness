const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("Usage: node scripts/check-webview.mjs <debug-port>");
}

// Cold CI runners can take well over 15s to start the WebView2 runtime.
const deadline = Date.now() + Number(process.env.OH_WEBVIEW_TIMEOUT_MS ?? 60_000);
// Exit codes: 0 rendered; 1 any verification failure (endpoint answered but there
// is no page target, wrong title, document not complete, empty body, CDP error);
// 3 only when the debugging endpoint never answered before the deadline, i.e. the
// WebView2 browser was not started with --remote-debugging-port. Callers may treat
// 3 as "could not verify" (smoke-desktop.ps1 -WebViewOptional); 1 is always fatal.
const EXIT_ENDPOINT_UNAVAILABLE = 3;

let page;
let endpointAnswered = false;
let lastSeen = "no response from the DevTools endpoint";
while (Date.now() < deadline) {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(2_000),
    });
  } catch (error) {
    // WebView2 starts after the native window and sidecar; a closed port or a
    // listener that never answers is "no endpoint", not a failed verification.
    lastSeen = `DevTools endpoint error: ${error.cause?.code ?? error.message}`;
    await new Promise((resolve) => setTimeout(resolve, 250));
    continue;
  }
  endpointAnswered = true;
  try {
    const targets = await response.json();
    lastSeen = `targets: ${JSON.stringify(targets.map(({ type, url }) => ({ type, url })))}`;
    page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
    if (page) break;
  } catch (error) {
    lastSeen = `DevTools endpoint returned an unreadable response: ${error.message}`;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

if (!page) {
  const message = `WebView2 did not expose a page target (${lastSeen})`;
  if (!endpointAnswered) {
    console.error(message);
    process.exit(EXIT_ENDPOINT_UNAVAILABLE);
  }
  throw new Error(message);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("CDP connection timed out")), 5_000);
  socket.addEventListener("open", () => {
    clearTimeout(timeout);
    resolve();
  }, { once: true });
  socket.addEventListener("error", () => {
    clearTimeout(timeout);
    reject(new Error("CDP connection failed"));
  }, { once: true });
});

const result = await new Promise((resolve, reject) => {
  const id = 1;
  const timeout = setTimeout(() => reject(new Error("DOM inspection timed out")), 5_000);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== id) return;
    clearTimeout(timeout);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result.result.value);
  });
  socket.send(JSON.stringify({
    id,
    method: "Runtime.evaluate",
    params: {
      expression: `({ title: document.title, readyState: document.readyState, body: document.body?.innerText ?? "", href: location.href })`,
      returnByValue: true,
    },
  }));
});
socket.close();

if (result.title !== "OHarness") throw new Error(`Unexpected window title: ${result.title}`);
if (result.readyState !== "complete") throw new Error(`WebView document is ${result.readyState}`);
if (result.body.length < 100 || !result.body.includes("OHarness")) {
  throw new Error("OHarness UI did not render expected content");
}

console.log(JSON.stringify({
  title: result.title,
  readyState: result.readyState,
  href: result.href,
  bodyCharacters: result.body.length,
}));
