import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  /** primary = the one main action per view; secondary = default; ghost = toolbars; danger = destructive. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** Keeps the button's width, hides the label, shows a spinner, ignores clicks. */
  loading?: boolean;
  /** Leading icon, inherits currentColor. */
  icon?: ReactNode;
  /** Square button with an icon and no label. Requires aria-label. */
  iconOnly?: boolean;
  className?: string;
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  label?: string;
  /** Helper text under the field. Replaced by `error` when both are set. */
  hint?: string;
  /** Error message; sets aria-invalid and announces itself. */
  error?: string;
  /** Machine data (keys, ids, paths): set in IBM Plex Mono. */
  mono?: boolean;
  className?: string;
}

export interface BadgeProps {
  tone?: "neutral" | "signal" | "warn" | "fault";
  /** Graph node role; colours the marker dot with --role-<name>. */
  role?: "agent" | "gate" | "hitl" | "skill" | "mcp" | "tool" | "decision";
  children: ReactNode;
  className?: string;
}

export interface PanelProps {
  variant?: "panel" | "float" | "inset";
  title?: string;
  /** Required with `title`, so the section is labelled. */
  titleId?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export interface ListRowProps {
  title: ReactNode;
  /** Machine detail under the title, set in IBM Plex Mono. */
  meta?: ReactNode;
  /** A second line in plain text (the Providers list: status word and short fix). */
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

export interface KbdProps { children: ReactNode; className?: string; }

export type NiloState = "idle" | "thinking" | "working" | "waiting" | "success" | "error" | "sleeping";
export interface NiloProps {
  /** What the agent is doing; Nilo acts it out. */
  state?: NiloState;
  /** CSS px per pixel cell. Keep it an integer so edges stay crisp. 6 = Chats home, 4 = compact panels. */
  cell?: number;
  /** "face" crops to the head, for inline status lines. */
  crop?: "full" | "face";
  /** Follows the pointer, reacts to clicks, dozes off after 90s idle. Renders a button. */
  interactive?: boolean;
  /** Force the still pose per state. Defaults to the user's prefers-reduced-motion. */
  still?: boolean;
  /** Accessible name. Required when not interactive and not decorative. */
  label?: string;
  className?: string;
}

export interface NoticeProps {
  tone?: "info" | "warn" | "fault";
  title?: string;
  children?: ReactNode;
  /** The fix, on the right. */
  action?: ReactNode;
  /** Faults are announced (alert) by default, the rest politely (status). */
  role?: "alert" | "status";
  className?: string;
}

export interface EmptyStateProps {
  /** Says what is true. */
  title: string;
  children?: ReactNode;
  /** The one action that changes it. */
  action?: ReactNode;
  className?: string;
}

export interface SegmentedProps<T extends string = string> {
  /** Names the radio group. */
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  className?: string;
}

export interface StatusMarkProps {
  tone?: "ok" | "warn" | "fault" | "busy" | "idle" | "off";
  className?: string;
}

export interface ConfirmInlineProps {
  prompt: ReactNode;
  /** Names the act ("Remove key"), never "OK". Cancel has the focus. */
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}

export interface PopoverProps {
  /** Accessible name of the list. */
  label: string;
  header?: ReactNode;
  /** Placeholder of the search field; omit for no search. */
  search?: string;
  /** Rendered between the search and the list (the scope toggle). */
  panel?: ReactNode;
  groups: { title?: string; options: { label: string; detail?: string; tone?: StatusMarkProps["tone"]; selected?: boolean; disabled?: boolean }[] }[];
  footer?: ReactNode;
  className?: string;
}

