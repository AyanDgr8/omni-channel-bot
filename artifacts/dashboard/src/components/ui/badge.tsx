import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // Badges never wrap; the leading dot slot is sized for a 6px status pip.
  "whitespace-nowrap inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-[0.01em]" +
    " transition-colors focus:outline-none focus:ring-2 focus:ring-ring/60 focus:ring-offset-1 focus:ring-offset-background" +
    " hover-elevate",
  {
    variants: {
      variant: {
        default:
          "border-white/10 bg-gradient-to-b from-primary to-primary-deep text-primary-foreground shadow-xs",
        secondary:
          "border-white/[0.07] bg-secondary text-secondary-foreground",
        destructive:
          "border-white/10 bg-gradient-to-b from-destructive to-destructive/80 text-destructive-foreground shadow-xs",
        outline: "text-foreground border [border-color:var(--badge-outline)] bg-white/[0.02]",
        // Tinted "soft" set — legible on dark without shouting.
        soft: "border-primary/25 bg-primary/12 text-primary-soft",
        success: "border-accent/25 bg-accent/12 text-accent",
        warning: "border-warning/25 bg-warning/12 text-warning",
        danger: "border-destructive/25 bg-destructive/12 text-destructive",
        muted: "border-white/[0.06] bg-white/[0.04] text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
