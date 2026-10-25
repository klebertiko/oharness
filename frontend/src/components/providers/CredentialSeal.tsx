"use client";
import { Button } from "@/components/ui/Button";
import { useRef, useState } from "react";
import { KeyRound, ShieldCheck, Terminal, Trash2, TriangleAlert } from "lucide-react";
import { VAULT_LABEL, activeVault, prefixMatches } from "./secrets";
import { providerReadiness } from "@/components/agent/chatProvider";
import type { Connection } from "./providerStore";
import type { ProviderSpec } from "./catalog";
import { Chip } from "./atoms";

/**
 * Credential block.
 *
 * The POC had a plain `<input type="text">` bound to the key. This replaces it
 * outright, and the replacement is built around one idea: a stored credential
 * is not a *field*, it is a *seal*. A field implies a value you can read, edit
 * and copy. A seal shows you which key is in there and offers exactly two
 * verbs — replace it, or destroy it.
 *
 * The redaction is drawn, not typed. It is a striped bar with `user-select:
 * none`, not a run of bullet characters, because a run of bullets still looks
 * like text that is merely hidden and invites people to try selecting it. A bar
 * that is visibly not text tells the truth: there is nothing here to reveal.
 */

function fmtDate(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** The drawn redaction. Width tracks the real key length, capped so a 164-char
 *  OpenAI project key does not blow the layout out. `length: null` means the
 *  seal was restored from the backend as a bare reference — the vault never
 *  told us how long the value is, and the bar must not pretend otherwise
 *  (DOSSIER-CRED-LENGTH, 2026-09-18: a 0 here used to render "0 characters"
 *  and a negative-width bar, i.e. an invented measurement). */
function Redaction({ length }: { length: number | null }) {
  const width = length === null ? 96 : Math.min(260, Math.max(48, length * 1.9));
  return (
    <span
      role="img"
      aria-label={length === null ? "Credential value withheld; length unavailable" : `${length} characters withheld`}
      className="inline-block h-[9px] flex-none select-none rounded-none bg-[repeating-linear-gradient(90deg,var(--sub-400)_0_2px,transparent_2px_4px)]"
      style={{ width }}
    />
  );
}

export function CredentialSeal({
  connection,
  spec,
  onAttach,
  onRevoke,
}: {
  connection: Connection;
  spec: ProviderSpec;
  onAttach: (plaintext: string) => Promise<void>;
  /** Resolves false when the sidecar could not delete the key. */
  onRevoke: () => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [entering, setEntering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<"store" | "remove" | null>(null);
  /* Two booleans derived from the pasted value. The value itself is never
     lifted out of the DOM node — this is the whole point of the component. */
  const [len, setLen] = useState(0);
  const [prefixOk, setPrefixOk] = useState(true);

  const vault = activeVault();

  /* ── No credential exists for this connection by design ─────────────────── */
  if (spec.credential.kind === "none" && !entering) {
    return (
      <Section title="Credential" chip={<Chip>none required</Chip>}>
        <p className="t-body max-w-[62ch] text-ink-dim">
          The local daemon is unauthenticated. Anything on this machine that can reach{" "}
          <span className="t-meta text-ink">{connection.endpoint}</span> can use it, including other
          applications — that is Ollama&rsquo;s design, not a gap in this one.
        </p>
      </Section>
    );
  }

  /* ── CLI-session auth — nothing pasted, nothing stored ───────────────────
     Anthropic and Cursor ride their own CLI's login (`claude login` /
     `cursor-agent login`). There is no key for this app to hold, so the
     paste flow below never applies here — connection health *is* the
     credential state, read straight from the adapter's probe(). */
  if (spec.credential.kind === "cli") {
    // Same gate as the list and the header chip: turned-off never reads
    // "connected" even when a Test passed, and turned-on-but-untested is not
    // "not connected".
    const readiness = providerReadiness(connection);
    const connected = readiness.verified;
    return (
      <Section
        title="Credential"
        chip={
          connected ? (
            <Chip tone="signal">
              <Terminal size={11} strokeWidth={1.8} />
              connected via CLI
            </Chip>
          ) : readiness.ready ? (
            <Chip>
              <Terminal size={11} strokeWidth={1.8} />
              turned on, not tested
            </Chip>
          ) : (
            <Chip tone="warn">
              <Terminal size={11} strokeWidth={1.8} />
              CLI not connected
            </Chip>
          )
        }
      >
        <p className="t-body max-w-[62ch] text-ink-dim">
          OHarness stores no credential for this connection. It runs the local{" "}
          <span className="t-meta text-ink">{spec.vendor === "Cursor" ? "cursor-agent" : "claude"}</span>{" "}
          CLI in your own login session — there is nothing to paste here, and nothing this app could
          leak even if it tried.
        </p>
        {failure === "store" && (
        <p role="alert" className="t-body mt-1.5 text-fault-text">
          The key was not stored: the OHarness sidecar did not accept it. Check the app is running and try again.
        </p>
      )}
      <p className="t-body mt-2.5 max-w-[62ch] text-ink-mute">
          {connected
            ? `Signed in as ${connection.facts.find((f) => f.k === "account")?.v ?? "unknown"}.`
            : spec.credential.where}
        </p>
      </Section>
    );
  }

  /* ── Sealed ─────────────────────────────────────────────────────────────── */
  if (connection.secret && !entering) {
    const s = connection.secret;
    return (
      <Section
        title="Credential"
        chip={
          <Chip tone="signal">
            <ShieldCheck size={11} strokeWidth={1.8} />
            sealed
          </Chip>
        }
      >
        <div className="flex min-w-0 items-center gap-2.5 overflow-hidden rounded-control border border-line-soft bg-sub-200 px-2.5 py-2">
          <span className="h-[15px] w-[2px] flex-none rounded-none bg-signal-deep" aria-hidden />
          <span className="t-meta flex min-w-0 items-center gap-1.5">
            <span className="text-ink-dim">{s.prefix}</span>
            <Redaction length={s.length > 0 ? Math.max(0, s.length - s.prefix.length - 4) : null} />
            <span className="text-ink">{s.tail}</span>
          </span>
        </div>

        <dl className="mt-2.5 grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
          <Row k="Stored in" v={`${VAULT_LABEL[s.vault]} · ${s.service}`} />
          <Row k="Length" v={s.length > 0 ? `${s.length} characters` : "not reported by the vault"} />
          <Row k="Added" v={fmtDate(s.savedAt)} />
        </dl>

        <p className="t-body mt-3 max-w-[62ch] text-ink-mute">
          OHarness cannot read this value back — not into this window, not into a node, not into
          a run log. The runtime asks the vault for it at request time and never hands it across.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Btn onClick={() => setEntering(true)}>
            <KeyRound size={12} strokeWidth={1.7} />
            Replace key
          </Btn>
          <Btn
            tone="fault"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setFailure(null);
              const removed = await onRevoke();
              setBusy(false);
              if (!removed) setFailure("remove");
            }}
          >
            <Trash2 size={12} strokeWidth={1.7} />
            {busy ? "Removing…" : "Remove"}
          </Btn>
        </div>
        {failure === "remove" && (
          <p role="alert" className="t-body mt-2 text-fault-text">
            Couldn&apos;t remove the key: the sidecar did not confirm it. It is still stored; try again.
          </p>
        )}
      </Section>
    );
  }

  /* ── Entry ──────────────────────────────────────────────────────────────── */
  const expected = spec.credential.prefix;
  const submit = async () => {
    const el = input.current;
    if (!el || !el.value.trim() || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await onAttach(el.value); // value goes straight through; never stored here
      setEntering(false);
    } catch {
      // Generic on purpose: never echo the thrown text, it may carry the value.
      // Stay on the entry form so the message is seen and a retry is one paste away.
      setFailure("store");
    } finally {
      el.value = ""; // and is gone from the DOM before the next paint
      setLen(0);
      setPrefixOk(true);
      setBusy(false);
    }
  };

  return (
    <Section
      title="Credential"
      chip={connection.secret ? <Chip tone="warn">replacing</Chip> : <Chip>not set</Chip>}
    >
      <label className="t-body mb-1.5 block text-ink-dim" htmlFor="oh-cred">
        Paste your {spec.vendor} key
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="oh-cred"
          ref={input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          data-1p-ignore
          placeholder={expected ? `${expected}…` : "key"}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setLen(v.length);
            setPrefixOk(prefixMatches(v, expected));
          }}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          className="oh-focus-inner t-meta h-control-md min-w-0 flex-[1_1_10rem] rounded-control border border-line-strong bg-sub-200 px-2 tracking-[0.16em] text-ink max-sm:h-control-lg focus-visible:border-signal-deep"
        />
        <Btn onClick={() => void submit()} primary disabled={!len || !prefixOk || busy}>
          {busy ? "Storing…" : "Store"}
        </Btn>
        {connection.secret && <Btn onClick={() => setEntering(false)}>Cancel</Btn>}
      </div>

      {!prefixOk && (
        <p className="t-body mt-1.5 flex items-start gap-1.5 text-warn-text">
          <TriangleAlert size={12} strokeWidth={1.8} className="mt-[2px] flex-none" />
          {spec.vendor} keys begin <span className="t-meta">{expected}</span>. This one does not —
          check you have not pasted a key from another vendor.
        </p>
      )}

      <p className="t-body mt-2.5 max-w-[62ch] text-ink-mute">
        Stored in the {VAULT_LABEL[vault]} under{" "}
        <span className="t-meta text-ink-dim">oharness/{connection.id}</span>, then{" "}
        <span className="text-ink-dim">never shown again</span> — including to you. Keep the vendor
        copy if you need it elsewhere.
      </p>
      {vault === "memory" && (
        <p className="t-body mt-1 max-w-[62ch] text-warn-text">
          This build is running in a browser, so there is no OS keychain to write to. The key is
          held in memory for this session only and is lost on reload.
        </p>
      )}
      <p className="t-body mt-2 text-ink-mute">
        Get one at <span className="text-ink-mute">{spec.credential.where}</span>
      </p>
    </Section>
  );
}

/* ── Local chrome ─────────────────────────────────────────────────────────── */

function Section({
  title,
  chip,
  children,
}: {
  title: string;
  chip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line-soft py-4">
      <header className="mb-2.5 flex flex-wrap items-center gap-2">
        <h2 className="t-title text-ink">{title}</h2>
        {chip}
      </header>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="t-body text-ink-mute">{k}</dt>
      <dd className="t-meta text-ink-dim [overflow-wrap:anywhere]">{v}</dd>
    </>
  );
}

export function Btn({
  children,
  onClick,
  primary,
  tone,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  tone?: "fault";
  disabled?: boolean;
}) {
  return (
    <Button variant={primary ? "primary" : tone === "fault" ? "danger" : "secondary"} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}
