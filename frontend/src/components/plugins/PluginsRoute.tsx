"use client";
import { useEffect } from "react";
import { useLocaleStore } from "@/i18n/store";
import { PluginsScreen } from "./PluginsScreen";

/** The screen as its own route: reads the saved language (the shell does this for the screens it hosts) and fills the window. */
export function PluginsRoute() {
  useEffect(() => {
    useLocaleStore.getState().hydrate();
  }, []);
  return (
    <main className="h-dvh">
      <PluginsScreen />
    </main>
  );
}
