import { useMemo } from "react"
import { ariaDescribedByIds, getInputProps, type BaseInputTemplateProps, type WidgetProps } from "@rjsf/utils"
import { useTranslation } from "react-i18next"

import { Switch } from "@/components/animate-ui/components/radix/switch"
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, useComboboxAnchor } from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function ToolInput({ id, schema, type, options, value, required, disabled, readonly, placeholder, onChange, onChangeOverride, onBlur, onFocus, rawErrors }: BaseInputTemplateProps) {
  return <Input {...getInputProps(schema, type, options)} id={id} value={value ?? ""} required={required} disabled={disabled} readOnly={readonly} placeholder={placeholder}
    aria-invalid={Boolean(rawErrors?.length)} aria-describedby={ariaDescribedByIds(id)}
    onChange={onChangeOverride ?? ((event) => onChange(event.target.value === "" ? options.emptyValue : event.target.value))}
    onBlur={(event) => onBlur(id, event.target.value)} onFocus={(event) => onFocus(id, event.target.value)} />
}

export function ToolTextarea({ id, value, required, disabled, readonly, placeholder, onChange, onBlur, onFocus, rawErrors }: WidgetProps) {
  return <Textarea id={id} value={value ?? ""} required={required} disabled={disabled} readOnly={readonly} placeholder={placeholder}
    aria-invalid={Boolean(rawErrors?.length)} aria-describedby={ariaDescribedByIds(id)}
    onChange={(event) => onChange(event.target.value || undefined)} onBlur={(event) => onBlur(id, event.target.value)} onFocus={(event) => onFocus(id, event.target.value)} />
}

export function ToolBoolean({ id, label, schema, value, required, disabled, readonly, onChange, onBlur, onFocus, rawErrors }: WidgetProps) {
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-3"><Label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</Label>
      <Switch id={id} checked={Boolean(value)} disabled={disabled || readonly} onCheckedChange={onChange} aria-invalid={Boolean(rawErrors?.length)} aria-describedby={ariaDescribedByIds(id)} onBlur={() => onBlur(id, value)} onFocus={() => onFocus(id, value)} />
    </div>
    {schema.description && <p id={`${id}__description`} className="text-xs text-muted-foreground">{schema.description}</p>}
  </div>
}

export function ToolSelect({ id, label, options, value, multiple, disabled, readonly, onChange, onBlur, onFocus, rawErrors }: WidgetProps) {
  const { t } = useTranslation()
  const anchor = useComboboxAnchor()
  const entries = useMemo(() => options.enumOptions ?? [], [options.enumOptions])
  const items = useMemo(() => entries.map((_, index) => String(index)), [entries])
  const displayLabel = (key: string) => entries[Number(key)]?.label ?? key
  const list = <ComboboxContent anchor={multiple ? anchor : undefined}><ComboboxEmpty>{t("resources.noOptions")}</ComboboxEmpty><ComboboxList>{(key: string) => <ComboboxItem key={key} value={key} disabled={options.enumDisabled?.includes(entries[Number(key)].value)}>{displayLabel(key)}</ComboboxItem>}</ComboboxList></ComboboxContent>
  if (multiple) {
    const selected = items.filter((key) => Array.isArray(value) && value.includes(entries[Number(key)].value))
    return <Combobox multiple items={items} value={selected} itemToStringLabel={displayLabel} disabled={disabled || readonly} onValueChange={(keys) => onChange(keys.map((key) => entries[Number(key)].value))}>
      <ComboboxChips ref={anchor} className="w-full">{selected.map((key) => <ComboboxChip key={key} removeLabel={t("resources.removeValue", { value: displayLabel(key) })}>{displayLabel(key)}</ComboboxChip>)}
        <ComboboxChipsInput id={id} aria-label={label} aria-invalid={Boolean(rawErrors?.length)} aria-describedby={ariaDescribedByIds(id)} onBlur={() => onBlur(id, value)} onFocus={() => onFocus(id, value)} />
      </ComboboxChips>{list}
    </Combobox>
  }
  const selected = items.find((key) => entries[Number(key)].value === value) ?? null
  return <Combobox items={items} value={selected} itemToStringLabel={displayLabel} disabled={disabled || readonly} onValueChange={(key) => onChange(key === null ? undefined : entries[Number(key)].value)}>
    <ComboboxInput id={id} className="w-full" placeholder={t("resources.selectValue")} showClear aria-invalid={Boolean(rawErrors?.length)} aria-describedby={ariaDescribedByIds(id)} onBlur={() => onBlur(id, value)} onFocus={() => onFocus(id, value)} />{list}
  </Combobox>
}
