import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[72px] w-full rounded-lg border border-input bg-black/20 px-3.5 py-2.5 text-base shadow-inner",
        "transition-[border-color,box-shadow,background-color] duration-200",
        "placeholder:text-muted-foreground/70",
        "hover:border-white/20",
        "focus-visible:outline-none focus-visible:border-primary/70 focus-visible:bg-black/25 focus-visible:ring-4 focus-visible:ring-primary/15",
        "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
