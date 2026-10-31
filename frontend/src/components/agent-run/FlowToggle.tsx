"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { flowApi } from "@/lib/flowApi";
import { useT } from "@/i18n/store";

/**
 * Switch for Flow advice: when on, a harness run records a `flow_advice` event at each step.
 * It is evidence only and never changes what runs. The sidecar keeps the choice (off until turned on).
 * Until the sidecar answers the switch is disabled, so it never shows a guess.
 */
export function FlowToggle() {
  const t = useT();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    flowApi
      .get()
      .then((c) => live && setEnabled(c.enabled))
      .catch(() => {}); // not answered yet: the switch stays disabled rather than showing a guess
    return () => {
      live = false;
    };
  }, []);

  const toggle = () => {
    if (enabled === null) return;
    setFailed(false);
    flowApi
      .set(!enabled)
      .then((c) => setEnabled(c.enabled))
      .catch(() => setFailed(true));
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        role="switch"
        aria-checked={enabled === true}
        disabled={enabled === null}
        onClick={toggle}
        title={t("flow.toggle.title")}
      >
        {t(enabled ? "flow.toggle.on" : "flow.toggle.off")}
      </Button>
      {failed && <span role="alert" className="text-meta text-fault-text">{t("flow.toggle.error")}</span>}
    </>
  );
}
