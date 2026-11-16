import { useRef, type ComponentProps } from "react"

import { ChartContainer } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

import { useChartDimensions } from "./use-chart-dimensions"

export function ViewportChartContainer({
  className,
  ...props
}: Omit<ComponentProps<typeof ChartContainer>, "dimensions" | "ref">) {
  const ref = useRef<HTMLDivElement>(null)
  const { dimensions, nearViewport } = useChartDimensions(ref)

  return (
    <ChartContainer
      {...props}
      ref={ref}
      dimensions={dimensions}
      // A frozen, wider offscreen SVG must not enlarge the chat's scroll area.
      className={cn(className, !nearViewport && "overflow-clip")}
    />
  )
}
