"use client";

import { useEffect } from "react";
import { PluginsScreen } from "@/components/plugins/PluginsScreen";
import { useLocaleStore } from "@/i18n/store";

export default function PluginsPage() {
  const hydrate = useLocaleStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  return (
    <main className="box-border min-h-dvh min-w-0 bg-sub-000 text-ink">
      <PluginsScreen />
    </main>
  );
}
