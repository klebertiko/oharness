import type { Config } from "tailwindcss";

/**
 * OHarness token surface.
 *
 * Every value here points at a CSS custom property declared in globals.css.
 * Nothing in this file holds a literal colour — the palette has exactly one
 * definition site, so a token can never drift between Tailwind and CSS.
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        sub: {
          "000": "var(--sub-000)",
          100: "var(--sub-100)",
          200: "var(--sub-200)",
          300: "var(--sub-300)",
          400: "var(--sub-400)",
        },
        line: {
          DEFAULT: "var(--line)",
          soft: "var(--line-soft)",
          strong: "var(--line-strong)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          dim: "var(--ink-dim)",
          mute: "var(--ink-mute)",
          faint: "var(--ink-faint)",
        },
        signal: {
          DEFAULT: "var(--signal)",
          deep: "var(--signal-deep)",
          ink: "var(--signal-ink)",
          text: "var(--signal-text)",
        },
        /* warn and fault are fills, markers and borders; their .text forms are
           the only way either colour reaches text. */
        warn: { DEFAULT: "var(--warn)", text: "var(--warn-text)" },
        fault: { DEFAULT: "var(--fault)", text: "var(--fault-text)" },
        role: {
          input: "var(--role-input)",
          llm: "var(--role-llm)",
          tool: "var(--role-tool)",
          evaluator: "var(--role-evaluator)",
          router: "var(--role-router)",
          hitl: "var(--role-hitl)",
          memory: "var(--role-memory)",
          aggregator: "var(--role-aggregator)",
          output: "var(--role-output)",
        },
      },
      fontFamily: {
        ui: ["var(--font-ui)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      /* Dense-desktop scale. The gaps are deliberate: there is no 14px, no
         15px, no 16px body size anywhere in this app. */
      fontSize: {
        meta: ["11px", { lineHeight: "1.4", letterSpacing: "0.02em" }],
        label: ["10px", { lineHeight: "1.4", letterSpacing: "0.1em" }],
        body: ["12px", { lineHeight: "1.5" }],
        title: ["13px", { lineHeight: "1.3", letterSpacing: "-0.004em" }],
        reading: ["14px", { lineHeight: "1.6" }],
        code: ["12px", { lineHeight: "1.55" }],
        display: ["20px", { lineHeight: "1.2", letterSpacing: "-0.018em" }],
      },
      spacing: {
        titlebar: "var(--h-titlebar)",
        statusbar: "var(--h-statusbar)",
        panelhead: "var(--h-panelhead)",
        rail: "var(--w-rail)",
        "control-sm": "var(--control-sm)",
        "control-md": "var(--control-md)",
        "control-lg": "var(--control-lg)",
      },
      borderRadius: {
        control: "var(--r-control)",
        panel: "var(--r-panel)",
        float: "var(--r-float)",
        composer: "var(--r-composer)",
        hero: "var(--r-hero)",
      },
      transitionDuration: {
        DEFAULT: "var(--duration-fast)",
        base: "var(--duration-base)",
        enter: "var(--duration-enter)",
      },
      transitionTimingFunction: {
        DEFAULT: "var(--ease-standard)",
        enter: "var(--ease-enter)",
      },
    },
  },
  plugins: [],
};

export default config;
