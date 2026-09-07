import { cn } from "@/lib/utils";

/**
 * Shared page masthead: eyebrow icon chip, title, subtitle and an optional
 * right-hand action slot. Keeps every route's top-of-page rhythm identical.
 */
export default function PageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-4 pb-1",
        className
      )}
    >
      <div className="flex items-center gap-3.5">
        {Icon && (
          <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-surface-3 to-surface shadow-md">
            <Icon className="h-5 w-5 text-primary" />
            <div className="pointer-events-none absolute inset-0 rounded-xl bg-primary/10 blur-md" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.022em] text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
