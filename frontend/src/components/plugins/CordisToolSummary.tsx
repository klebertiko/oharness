"use client";
import { useI18n } from "@/i18n/store";

/** The sentence under the approval card of the plugin tool: Nilo never installs, the install waits for the person in Cordis Plugins. */
export function CordisToolSummary() {
  const { t } = useI18n();
  return (
    <p className="mt-1.5 text-body text-ink-mute" data-cordis-note>
      {t("plugins.approval.note")}
    </p>
  );
}
