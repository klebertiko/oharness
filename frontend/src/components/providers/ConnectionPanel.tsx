"use client";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, TriangleAlert } from "lucide-react";
import { Button, ConfirmInline, Input, Panel } from "@/components/ui";
import { useT } from "@/i18n/store";
import { PROVIDER_TEXT_KEY } from "./labels";
import { Row, Rows, WithCode } from "./rows";
import { VAULT_LABEL, activeVault, prefixMatches } from "./secrets";
import { specOf, useProviderStore, type Connection } from "./providerStore";
import { ENDPOINT_FIELD_ID, KEY_FIELD_ID, type ConnectionActions } from "./useConnectionActions";
import { providerKey } from "./providerText";

const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "");

/** The drawn redaction: a striped bar, not bullets, so nobody tries to select text that is not there (the width tracks the key's length, capped). */
function Redaction({ length }: { length: number | null }) {
  const t = useT();
  const width = length === null ? 96 : Math.min(200, Math.max(48, length * 1.9));
  return (
    <span
      role="img"
      aria-label={length === null ? t("key.redaction.unknown") : t("key.redaction", { n: length })}
      className="inline-block h-2 flex-none select-none rounded-none bg-[repeating-linear-gradient(90deg,var(--sub-400)_0_2px,transparent_2px_4px)]"
      style={{ width }}
    />
  );
}

/**
 * The key row. A stored credential is a seal, not a field: it shows which key
 * is in there (prefix, a drawn redaction, the last four) and offers two verbs,
 * replace and remove. The pasted value lives in an uncontrolled input and goes
 * straight to the store; it is never lifted into state and never echoed in an
 * error (secrets.ts, ADR 0001). `secretRef` stays opaque.
 */
function KeyRow({ c, actions }: { c: Connection; actions: ConnectionActions }) {
  const t = useT();
  const spec = specOf(c);
  const { attachSecret, revokeSecret } = useProviderStore();
  const input = useRef<HTMLInputElement>(null);
  const replaceButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<"store" | "remove" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [len, setLen] = useState(0);
  const [prefixOk, setPrefixOk] = useState(true);
  const [savedId, setSavedId] = useState<string | null>(null);
  const vault = activeVault();
  const entering = !c.secret || actions.replacing;

  // Replacing mounts the field focused; saving hands focus back to the seal's Replace button.
  useEffect(() => {
    if (actions.replacing) input.current?.focus();
  }, [actions.replacing]);
  useEffect(() => {
    if (savedId === c.id && c.secret) replaceButton.current?.focus();
  }, [savedId, c.id, c.secret]);

  if (spec.credential.kind === "none") {
    return (
      <Row label={t("key.label.none")}>
        <p className="t-body text-ink">{t("key.none.value")}</p>
        <p className="t-body mt-0.5 max-w-[62ch] text-ink-mute">{t("key.none.note", { endpoint: c.endpoint || spec.endpoint.default })}</p>
      </Row>
    );
  }

  if (spec.credential.kind === "cli") {
    const account = c.facts.find((f) => f.k === "account")?.v;
    const cli = spec.credential.login?.split(" ")[0] ?? spec.vendor;
    return (
      <Row label={t("key.label.cli")}>
        <p className="t-body text-ink">{t("key.cli.value", { cli })}</p>
        <p className="t-body mt-0.5 max-w-[62ch] text-ink-mute">
          {account ? t("key.cli.signedIn", { account }) : <WithCode text={t(PROVIDER_TEXT_KEY[providerKey(c)].where)} />}
        </p>
      </Row>
    );
  }

  if (!entering && c.secret) {
    const s = c.secret;
    return (
      <Row
        label={t("key.label")}
        action={
          confirming ? undefined : (
            <>
              <Button ref={replaceButton} onClick={() => actions.setReplacing(true)}>
                {t("key.replace")}
              </Button>
              <Button variant="danger" onClick={() => setConfirming(true)}>
                {t("key.remove")}
              </Button>
            </>
          )
        }
      >
        <p className="t-meta flex min-w-0 items-center gap-1.5">
          <span className="text-ink-dim">{s.prefix}</span>
          <Redaction length={s.length > 0 ? Math.max(0, s.length - s.prefix.length - 4) : null} />
          <span className="text-ink">{s.tail}</span>
        </p>
        <p className="t-body mt-1 text-ink-mute">
          {s.savedAt ? t("key.savedIn", { vault: VAULT_LABEL[s.vault], date: fmtDate(s.savedAt) }) : t("key.savedInNoDate", { vault: VAULT_LABEL[s.vault] })}
        </p>
        {confirming && (
          <ConfirmInline
            className="mt-2"
            prompt={t("key.remove.prompt", { vendor: spec.vendor })}
            confirmLabel={t("key.remove.confirm")}
            busy={busy}
            onCancel={() => {
              setConfirming(false);
              replaceButton.current?.focus();
            }}
            onConfirm={async () => {
              setBusy(true);
              setFailure(null);
              const removed = await revokeSecret(c.id);
              setBusy(false);
              if (removed) setConfirming(false);
              else setFailure("remove");
            }}
          />
        )}
        {failure === "remove" && (
          <p role="alert" className="t-body mt-1.5 text-fault-text">
            {t("key.fail.remove")}
          </p>
        )}
      </Row>
    );
  }

  const expected = spec.credential.prefix;
  const submit = async () => {
    const el = input.current;
    if (!el || !el.value.trim() || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await attachSecret(c.id, el.value); // straight through; never held here
      setSavedId(c.id);
      actions.setReplacing(false);
    } catch {
      // Generic on purpose: the thrown text may carry the value.
      setFailure("store");
    } finally {
      el.value = "";
      setLen(0);
      setPrefixOk(true);
      setBusy(false);
    }
  };

  return (
    <Row
      label={t("key.label")}
      action={
        <>
          {c.secret && <Button onClick={() => actions.setReplacing(false)}>{t("common.cancel")}</Button>}
          <Button variant="primary" onClick={() => void submit()} disabled={!len || !prefixOk || busy} loading={busy}>
            {t("key.save")}
          </Button>
        </>
      }
    >
      <Input
        compact
        mono
        id={KEY_FIELD_ID}
        ref={input}
        type="password"
        autoComplete="off"
        spellCheck={false}
        data-1p-ignore
        aria-label={t("key.aria", { vendor: spec.vendor })}
        aria-describedby={`${KEY_FIELD_ID}-help`}
        placeholder={expected ? `${expected}…` : t("key.placeholder")}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setLen(v.length);
          setPrefixOk(prefixMatches(v, expected));
        }}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
      />
      <div id={`${KEY_FIELD_ID}-help`} className="mt-1.5 max-w-[62ch] space-y-1 text-body">
        {!prefixOk && (
          <p className="flex items-start gap-1.5 text-warn-text">
            <TriangleAlert size={12} strokeWidth={1.8} className="mt-0.5 flex-none" aria-hidden />
            <span>{t("key.prefix", { vendor: spec.vendor, prefix: expected ?? "" })}</span>
          </p>
        )}
        <p className="text-ink-mute">{t("key.hint", { vault: VAULT_LABEL[vault] })}</p>
        <p className="text-ink-mute">{t("key.where", { where: spec.credential.where })}</p>
        {vault === "memory" && <p className="text-warn-text">{t("key.memory")}</p>}
        {failure === "store" && (
          <p role="alert" className="text-fault-text">
            {t("key.fail.store")}
          </p>
        )}
      </div>
    </Row>
  );
}

export function ConnectionPanel({ c, actions }: { c: Connection; actions: ConnectionActions }) {
  const t = useT();
  const spec = specOf(c);
  const toggleEnabled = useProviderStore((s) => s.toggleEnabled);
  const editable = spec.endpoint.editable;
  return (
    <Panel title={t("connection.title")} titleId="oh-connection" level={3}>
      <Rows label={t("connection.title")}>
        <KeyRow c={c} actions={actions} />
        <Row
          label={t("endpoint.label")}
          action={
            <a
              href={spec.docs}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-control-md items-center gap-1.5 rounded-control px-2 text-body text-ink-dim transition-colors hover:bg-sub-200 hover:text-ink pointer-coarse:h-control-touch"
            >
              {t("endpoint.docs", { vendor: spec.vendor })}
              <ExternalLink size={12} strokeWidth={1.7} aria-hidden />
            </a>
          }
        >
          <Input
            compact
            mono
            id={ENDPOINT_FIELD_ID}
            aria-label={t("endpoint.aria", { name: c.label })}
            value={actions.endpointValue}
            readOnly={!editable}
            spellCheck={false}
            onChange={(e) => actions.editEndpoint(e.target.value)}
            onBlur={() => void actions.commitEndpoint()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void actions.commitEndpoint();
              }
            }}
            className={editable ? undefined : "[&_input]:text-ink-mute"}
          />
          <div className="mt-1 min-h-4 text-body">
            {!editable && <p className="text-ink-mute">{t("endpoint.fixed")}</p>}
            {actions.endpointState === "saving" && <p role="status" className="text-ink-dim">{t("endpoint.saving")}</p>}
            {actions.endpointState === "saved" && <p role="status" className="text-signal-text">{t("endpoint.saved")}</p>}
            {actions.endpointState === "failed" && (
              <p role="alert" className="text-fault-text">
                {t("endpoint.failed", { current: c.endpoint || t("endpoint.previous") })}
              </p>
            )}
          </div>
        </Row>
        <Row
          label={t("enabled.label")}
          action={
            <Button onClick={() => void toggleEnabled(c.id)}>{c.enabled ? t("enabled.turnOff") : t("enabled.turnOn")}</Button>
          }
        >
          <p className="t-body text-ink">{c.enabled ? t("enabled.on") : t("enabled.off")}</p>
          <p className="t-body mt-0.5 text-ink-mute">{c.enabled ? t("enabled.note.on") : t("enabled.note.off")}</p>
        </Row>
      </Rows>
    </Panel>
  );
}
