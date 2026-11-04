import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

// Tone → pill + dot classes. Uses theme tokens so it adapts to light/dark.
const TONES: Record<Tone, { pill: string; dot: string }> = {
  success: { pill: "bg-success/10 text-success", dot: "bg-success" },
  warning: { pill: "bg-warning/15 text-warning", dot: "bg-warning" },
  danger: { pill: "bg-destructive/10 text-destructive", dot: "bg-destructive" },
  info: { pill: "bg-primary/10 text-primary", dot: "bg-primary" },
  neutral: { pill: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/60" },
};

/**
 * Small status pill with a leading dot — for connection state (connected/offline),
 * plan/health status, broadcast state, etc. `dot={false}` for a plain chip.
 */
export function StatusPill({
  tone = "neutral",
  children,
  dot = true,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", t.pill, className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />}
      {children}
    </span>
  );
}
