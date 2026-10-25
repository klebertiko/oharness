/**
 * Desktop sidecar shutdown helpers (Nightwolf lessons).
 *
 * - Ports compare with **numeric** equality only — never substring
 *   (`51730` must not match watch port `5173`).
 * - Process kill is gated by an image-name allowlist.
 */

/** Image basenames we are willing to terminate when freeing a watched port. */
export const ALLOWED_IMAGES = Object.freeze([
  "oharness-sidecar.exe",
  "oharness-sidecar",
  "python.exe",
  "python",
  "pythonw.exe",
  "uvicorn.exe",
  "uvicorn",
]);

/**
 * @param {string|number} a
 * @param {string|number} b
 * @returns {boolean}
 */
export function portsEqual(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return na === nb;
}

/**
 * Parse `netstat -ano` style output into `{ port, pid }` rows for LISTENING lines.
 *
 * @param {string} netstatText
 * @returns {Array<{ port: number, pid: number }>}
 */
export function parseListeningPorts(netstatText) {
  const rows = [];
  const lines = String(netstatText ?? "").split(/\r?\n/);
  for (const line of lines) {
    if (!/LISTEN/i.test(line)) continue;
    // Local address is typically the second token: 127.0.0.1:5173 or [::]:8000
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const local = parts[1] ?? "";
    const pidToken = parts[parts.length - 1];
    const portMatch = local.match(/:(\d+)$/);
    if (!portMatch) continue;
    const port = Number(portMatch[1]);
    const pid = Number(pidToken);
    if (!Number.isFinite(port) || !Number.isFinite(pid)) continue;
    rows.push({ port, pid });
  }
  return rows;
}

/**
 * @param {string} imageName
 * @param {readonly string[]} allowlist
 * @returns {boolean}
 */
export function shouldKillProcess(imageName, allowlist = ALLOWED_IMAGES) {
  const base = String(imageName ?? "")
    .trim()
    .split(/[/\\]/)
    .pop()
    ?.toLowerCase();
  if (!base) return false;
  const allowed = new Set(
    allowlist.map((n) => String(n).trim().toLowerCase()).filter(Boolean)
  );
  return allowed.has(base);
}

/**
 * Pids listening on `watchPort` whose image is allowlisted.
 *
 * @param {object} opts
 * @param {string} opts.netstatText
 * @param {string|number} opts.watchPort
 * @param {(pid: number) => string|null|undefined} opts.resolveImage
 * @param {readonly string[]} [opts.allowlist]
 * @returns {number[]}
 */
export function pidsToKill({
  netstatText,
  watchPort,
  resolveImage,
  allowlist = ALLOWED_IMAGES,
}) {
  const hits = parseListeningPorts(netstatText).filter((r) =>
    portsEqual(r.port, watchPort)
  );
  const out = [];
  for (const { pid } of hits) {
    const image = resolveImage(pid);
    if (shouldKillProcess(image ?? "", allowlist)) out.push(pid);
  }
  return out;
}
