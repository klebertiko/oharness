import { notFound } from "next/navigation";

/** Development routes stay out of the production export unless the flag is set. `next dev` keeps them. */
export default function DevGate({ children }: { children: React.ReactNode }) {
  const enabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_OH_DEV_ROUTES === "1";
  if (!enabled) notFound();
  return children;
}
