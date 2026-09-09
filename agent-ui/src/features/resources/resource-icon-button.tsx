import type * as React from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ResourceIconButton({ className, ...props }: Omit<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return <Button variant="ghost" size="icon-xs" className={cn("size-5 border-0 bg-transparent text-muted-foreground shadow-none hover:text-foreground motion-reduce:transition-none [&_svg:not([class*='size-'])]:size-3.5", className)} {...props} />
}
