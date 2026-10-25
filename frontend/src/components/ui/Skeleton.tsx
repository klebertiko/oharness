import { cn } from "@/lib/utils";

/**
 * A placeholder with the exact size of what will load, so nothing shifts when
 * content arrives. Shown only when there is nothing to show yet; otherwise keep
 * the previous content and mark it `aria-busy` (experience.md).
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-sub-200 motion-reduce:animate-none", className)} />;
}

/** `rows` skeleton lines at list-row height, announced once as a loading status. */
export function SkeletonRows({ rows = 3, label = "Loading", className }: { rows?: number; label?: string; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("flex flex-col gap-1", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-control-lg w-full" />
      ))}
    </div>
  );
}
