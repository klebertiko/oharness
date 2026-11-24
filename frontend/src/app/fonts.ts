import localFont from "next/font/local";

/**
 * Self-hosted, no CDN at runtime. Sora carries display, titles and the mark
 * (400, 500, 600). Interface text uses the system face. IBM Plex Mono carries
 * code (400, 500). Both shipped faces are SIL OFL 1.1; licences sit beside the files.
 *
 * Only the `latin` subset ships (Latin-1: English, Portuguese, Spanish, French,
 * German). next/font/local cannot express unicode-range, so a second latin-ext
 * file would be downloaded on every load; glyphs outside Latin-1 fall back to
 * the system face until a locale needs the extension.
 *
 * `adjustFontFallback` gives the fallback the web font's metrics (size-adjust,
 * ascent and descent override), so the swap moves nothing (experience.md).
 */
const sora = localFont({
  src: [
    { path: "./fonts/Sora-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Sora-latin-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Sora-latin-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-sora",
  display: "swap",
  adjustFontFallback: "Arial",
});

const plexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexMono-latin-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  adjustFontFallback: "Arial",
});

/** Class names for <html>; they define --font-sora and --font-plex-mono. */
export const fontVariables = `${sora.variable} ${plexMono.variable}`;
