import { useState, type ReactNode } from "react"
import { LoaderCircle } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs"
import { Button } from "@/components/ui/button"
import { TooltipHint } from "@/components/ui/tooltip"
import { SPRING_LAYOUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

export function GitModeTabs({ value, onChange, label, items, className, size = "default" }: {
  value: string
  onChange: (value: string) => void
  label: string
  items: { value: string; label: string; controls?: string }[]
  className?: string
  size?: "default" | "sm"
}) {
  const [keyboard, setKeyboard] = useState(false)
  return <div className={cn("min-w-0", className)} onKeyDownCapture={() => setKeyboard(true)} onPointerDownCapture={() => setKeyboard(false)}>
    <Tabs value={value} onValueChange={onChange} variant="segment" transition={keyboard ? { duration: 0 } : SPRING_LAYOUT}>
      <TabsList aria-label={label} className={cn("p-0.5", size === "sm" ? "flex h-6" : "h-8 rounded-lg bg-tabs-background")}>
        {items.map((item) => <TabsTrigger key={item.value} value={item.value} aria-controls={item.controls}
          className={cn("py-0 text-xs font-normal", size === "sm" ? "flex h-5 px-2 leading-none" : "h-7 px-3")}
          indicatorClassName={size === "sm" ? "inset-0" : "inset-0.5"}>{item.label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  </div>
}

export function GitIconButton({ label, onClick, disabled, busy, children, className }: {
  label: string; onClick: () => void; disabled?: boolean; busy?: boolean; children: ReactNode; className?: string
}) {
  return <TooltipHint content={label}>
    <Button type="button" variant="ghost" size="icon-xs" aria-label={label} onClick={onClick} disabled={disabled} className={cn("[&_svg]:size-4", className)}>
      {busy ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : children}
    </Button>
  </TooltipHint>
}

export function GitNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p role={error ? "alert" : "status"} className={cn("m-0 break-words px-3 py-2 text-xs leading-relaxed", error ? "text-destructive" : "text-muted-foreground")}>{children}</p>
}

export function GitEmpty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return <div className="flex min-h-28 flex-col items-center justify-center gap-2 px-5 py-7 text-center text-xs text-muted-foreground">
    <span className="mb-1 [&_svg]:size-6 [&_svg]:stroke-[1.5]" aria-hidden="true">{icon}</span>
    <p className="font-medium text-foreground">{title}</p>
    {children && <div className="max-w-64 leading-relaxed">{children}</div>}
  </div>
}
