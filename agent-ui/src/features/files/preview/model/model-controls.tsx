import { Slider } from "@base-ui/react/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function ModelSelect({ label, value, options, onChange, disabled }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean
}) {
  return <label className="flex min-w-0 flex-col gap-1.5 text-xs">
    <span className="text-muted-foreground">{label}</span>
    <Select value={value} onValueChange={(next) => { if (next) onChange(next) }} disabled={disabled}>
      <SelectTrigger size="sm" className="w-full text-xs" aria-label={label}><SelectValue>{options.find((item) => item.value === value)?.label}</SelectValue></SelectTrigger>
      <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  </label>
}

export function ModelSlider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void
}) {
  return <Slider.Root value={value} min={min} max={max} step={step} onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)} className="flex flex-col gap-2">
    <div className="flex items-center justify-between gap-2 text-xs"><span className="text-muted-foreground">{label}</span><Slider.Value /></div>
    <Slider.Control className="flex h-6 touch-none items-center select-none">
      <Slider.Track className="relative h-1 w-full rounded-full bg-muted-foreground/20">
        <Slider.Indicator className="rounded-full bg-primary" />
        <Slider.Thumb aria-label={label} className="size-3.5 rounded-full border border-primary bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </Slider.Track>
    </Slider.Control>
  </Slider.Root>
}
