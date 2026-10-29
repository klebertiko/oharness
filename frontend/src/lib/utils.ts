import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/* tailwind-merge has to know the design system's own scale: without it,
   `text-body` (a font size) and `text-ink` (a colour) look like the same
   group and one silently eats the other. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ["control-sm", "control-md", "control-lg", "control-touch", "titlebar", "statusbar", "panelhead", "rail"],
      radius: ["control", "panel", "float", "composer", "hero"],
    },
    classGroups: {
      "font-size": [{ text: ["meta", "label", "body", "title", "reading", "code", "display"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
