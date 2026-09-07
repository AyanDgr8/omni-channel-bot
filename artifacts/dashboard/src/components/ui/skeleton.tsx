import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shimmer rounded-lg bg-white/[0.055]", className)}
      {...props}
    />
  )
}

export { Skeleton }
