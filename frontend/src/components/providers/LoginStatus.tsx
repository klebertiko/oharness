"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/store";
import { useProviderStore } from "./providerStore";
import { LOGIN_POLL_LIMIT_MS, LOGIN_POLL_MS, decideLogin, readSignedIn } from "./subscriptionLogin";
import { apiUrl } from "@/lib/apiBase";

/** Polls the CLI status until the sign-in is detected, then tests the connection. */
export function LoginStatus({ connectionId }: { connectionId: string }) {
  const t = useT();
  const watch = useProviderStore((s) => s.loginWatch);
  const finish = useProviderStore((s) => s.finishLogin);
  const cancel = useProviderStore((s) => s.cancelLogin);
  const timeout = useProviderStore((s) => s.timeoutLogin);
  const notice = useProviderStore((s) => (s.loginNotice?.connectionId === connectionId ? s.loginNotice.reason : null));
  const probe = useProviderStore((s) => s.probe);
  const active = watch?.connectionId === connectionId ? watch : null;

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const tick = async () => {
      const elapsed = Date.now() - active.startedAt;
      let signedIn = false;
      try {
        const res = await fetch(apiUrl("/providers/clis"));
        if (res.ok) signedIn = readSignedIn(await res.json(), active.cliId);
      } catch {
        signedIn = false;
      }
      if (stopped) return;
      const decision = decideLogin(elapsed, signedIn, false);
      if (decision === "signed-in") {
        finish();
        void probe(active.connectionId);
      } else if (decision === "timeout" || elapsed >= LOGIN_POLL_LIMIT_MS) {
        void timeout();
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), LOGIN_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [active, timeout, finish, probe]);

  if (!active) {
    if (!notice) return null;
    const sentence =
      notice === "timeout" ? t("providers.login.timeout")
      : notice === "not-installed" ? t("providers.login.notInstalled")
      : t("providers.login.notStarted");
    return (
      <p role="status" className="t-body text-ink-dim">
        {sentence}
      </p>
    );
  }
  return (
    <p role="status" className="t-body flex flex-wrap items-center gap-2 text-ink-dim">
      <span>{t("providers.login.waiting")}</span>
      <Button size="sm" onClick={() => void cancel()}>{t("providers.login.cancel")}</Button>
    </p>
  );
}
