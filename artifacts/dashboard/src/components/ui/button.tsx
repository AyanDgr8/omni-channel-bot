import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Base: springy press, focus ring that clears the control, and an icon that
  // nudges with the label on hover.
  "relative isolate inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium tracking-[-0.01em]" +
    " transition-[transform,box-shadow,background-color,border-color,color,opacity] duration-200 ease-out" +
    " active:scale-[0.985] active:duration-75" +
    " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background" +
    " disabled:pointer-events-none disabled:opacity-45 disabled:saturate-50" +
    " [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
    " hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        // Brand action: vertical gradient + coloured glow that intensifies on hover.
        default:
          "border border-white/10 bg-gradient-to-b from-primary to-primary-deep text-primary-foreground" +
          " shadow-[var(--glow-primary)] hover:shadow-[var(--glow-primary-strong)] hover:-translate-y-px",
        destructive:
          "border border-white/10 bg-gradient-to-b from-destructive to-destructive/80 text-destructive-foreground" +
          " shadow-[var(--glow-destructive)] hover:-translate-y-px hover:shadow-[0_10px_28px_-8px_hsl(var(--destructive)/0.7)]",
        // Emerald "confirm / go live" action.
        success:
          "border border-white/10 bg-gradient-to-b from-accent to-accent/80 text-accent-foreground" +
          " shadow-[var(--glow-accent)] hover:-translate-y-px",
        // Picks up whatever surface it sits on; gains a brand-tinted edge on hover.
        outline:
          "border [border-color:var(--button-outline)] bg-white/[0.02] shadow-xs backdrop-blur-sm" +
          " hover:border-primary/40 active:shadow-none",
        secondary:
          "border border-white/[0.07] bg-gradient-to-b from-surface-2 to-surface text-secondary-foreground shadow-sm hover:-translate-y-px",
        ghost: "border border-transparent text-foreground/85 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-11 rounded-xl px-7 text-[0.9375rem]",
        icon: "h-9 w-9",
        "icon-sm": "h-7 w-7 rounded-md [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
