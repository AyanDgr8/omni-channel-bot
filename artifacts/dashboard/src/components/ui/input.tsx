import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-input bg-black/20 px-3.5 py-1 text-base shadow-inner",
          "transition-[border-color,box-shadow,background-color] duration-200",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-muted-foreground/70",
          "hover:border-white/20",
          "focus-visible:outline-none focus-visible:border-primary/70 focus-visible:bg-black/25 focus-visible:ring-4 focus-visible:ring-primary/15",
          "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "aria-[invalid=true]:border-destructive/70 aria-[invalid=true]:ring-destructive/15",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
