"use client";
import { Button, Notice } from "@/components/ui";
import { useI18n } from "@/i18n/store";

export function OfflineNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Notice
      tone="fault"
      title={t("forja.offline.title")}
      className="m-3"
      action={
        <Button size="sm" onClick={onRetry}>
          {t("forja.retry")}
        </Button>
      }
    >
      {t("forja.offline.body")}
    </Notice>
  );
}
