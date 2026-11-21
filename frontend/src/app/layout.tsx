import type { Metadata, Viewport } from "next";
import "./globals.css";
import { fontVariables } from "./fonts";

export const metadata: Metadata = {
  title: "OHarness",
  description: "Agent desktop with a portable harness — design, validate, run.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  // theme-color is written by /theme-init.js from the person's saved theme.
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme and color-scheme are set before hydration by theme-init.js.
    <html lang="en" className={fontVariables} data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Blocking on purpose: the theme must be known before first paint. */}
        {/* biome-ignore lint/performance/noSyncScripts: same-origin theme bootstrap; async/defer would flash the wrong theme */}
        <script src="/theme-init.js" />
        {/* biome-ignore lint/performance/noSyncScripts: language and frame width must be known before first paint */}
        <script src="/shell-init.js" />
        <style>{`html[data-resizing] .oh-side, html[data-resizing] .oh-dock-col { transition: none !important; } .oh-peek { display: none; pointer-events: none; } .oh-peek-host:hover > .oh-peek, .oh-peek-host:focus-within > .oh-peek { display: flex; }`}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
