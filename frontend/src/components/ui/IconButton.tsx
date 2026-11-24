"use client";
import { forwardRef, type ReactNode } from "react";
import { Button, type ButtonProps } from "./Button";

export interface IconButtonProps extends Omit<ButtonProps, "iconOnly" | "children" | "aria-label"> {
  /** Accessible name. Also the native tooltip. */
  label: string;
  icon: ReactNode;
}

/** A square button with an icon and no visible label. The name is required. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, title, ...rest },
  ref,
) {
  return <Button ref={ref} iconOnly aria-label={label} title={title ?? label} icon={icon} {...rest} />;
});
