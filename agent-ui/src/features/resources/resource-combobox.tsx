import { useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"

import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox"
import { OverflowMarquee } from "@/components/motion/overflow-marquee"

export function ResourceCombobox({ id, options, value, onValueChange, disabled = false, allowCustomValue = false, placeholder, "aria-label": label }: {
  id?: string
  options: { value: string; label: string; description?: string }[]
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  allowCustomValue?: boolean
  placeholder?: string
  "aria-label"?: string
}) {
  const { t } = useTranslation()
  const items = useMemo(() => options.map((option) => option.value), [options])
  const displayLabel = useCallback((value: string) => options.find((option) => option.value === value)?.label ?? value, [options])
  return <Combobox
    items={items}
    value={value || null}
    inputValue={allowCustomValue ? value : undefined}
    itemToStringLabel={displayLabel}
    filter={(value, query) => `${displayLabel(value)} ${value}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())}
    disabled={disabled}
    onValueChange={(next) => { if (next !== null || allowCustomValue) onValueChange(next ?? "") }}
    onInputValueChange={(next, details) => { if (allowCustomValue && details.reason === "input-change") onValueChange(next) }}
  >
    <ComboboxInput id={id} aria-label={label} className="w-full" disabled={disabled} placeholder={placeholder ?? label} showClear={allowCustomValue} required />
    <ComboboxContent>
      <ComboboxEmpty>{t(allowCustomValue ? "resources.customDirectoryHint" : "resources.noOptions")}</ComboboxEmpty>
      <ComboboxList>{(value: string) => {
        const option = options.find((option) => option.value === value)
        return <ComboboxItem key={value} value={value} aria-label={option?.description ? `${displayLabel(value)} ${option.description}` : displayLabel(value)}>
          <span className="flex min-w-0 flex-1 items-baseline gap-2"><span className={option?.description ? "max-w-[45%] shrink-0 truncate" : "min-w-0 truncate"}>{displayLabel(value)}</span>
            {option?.description && <OverflowMarquee className="flex-1 text-xs text-muted-foreground/60">{option.description}</OverflowMarquee>}
          </span>
        </ComboboxItem>
      }}</ComboboxList>
    </ComboboxContent>
  </Combobox>
}
