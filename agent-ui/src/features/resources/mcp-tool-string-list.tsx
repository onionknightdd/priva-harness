import { useRef, useState } from "react"
import { getDefaultRegistry } from "@rjsf/core"
import type { FieldProps, RJSFSchema } from "@rjsf/utils"
import { XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TooltipHint } from "@/components/ui/tooltip"

const DefaultArrayField = getDefaultRegistry().fields.ArrayField

export function ToolArrayField(props: FieldProps) {
  const items = props.schema.items
  if (items && !Array.isArray(items) && typeof items === "object") {
    const item = props.registry.schemaUtils.retrieveSchema(items as RJSFSchema)
    if (item.type === "string" && !item.enum && !item.oneOf && !item.anyOf) return <StringList {...props} />
  }
  return <DefaultArrayField {...props} />
}

function StringList({ fieldPathId, name, schema, formData, required, disabled, readonly, onChange, onBlur, onFocus, errorSchema }: FieldProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState("")
  const input = useRef<HTMLInputElement>(null)
  const values: string[] = Array.isArray(formData) ? formData : []
  const id = fieldPathId.$id
  const maxed = schema.maxItems !== undefined && values.length >= schema.maxItems
  const change = (next: string[]) => onChange(next, fieldPathId.path)
  return <div className="space-y-2">
    <Label htmlFor={id}>{schema.title ?? name}{required && <span aria-hidden="true"> *</span>}</Label>
    <div className="ring-inset flex min-h-9 min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      {values.map((value, index) => <Badge key={index} variant="secondary" className="h-6 min-w-0 max-w-full gap-1 rounded-md pl-2 pr-1">
        <TooltipHint content={value}><span className="truncate">{value}</span></TooltipHint>
        <Button type="button" variant="ghost" size="icon-xs" className="size-4 shrink-0 rounded-sm" disabled={disabled || readonly} aria-label={t("resources.removeValue", { value })} onClick={() => { change(values.filter((_, position) => position !== index)); input.current?.focus() }}><XIcon className="size-3" /></Button>
      </Badge>)}
      <Input ref={input} id={id} value={draft} className="h-6 min-w-24 flex-1 border-0 p-0 shadow-none focus-visible:ring-0" disabled={disabled || readonly || maxed} placeholder={t("resources.addListValue")}
        aria-describedby={`${id}__description ${id}__error`} onFocus={() => onFocus(id, values)} onBlur={() => onBlur(id, values)}
        onChange={(event) => { setDraft(event.target.value); event.target.setCustomValidity(event.target.value ? t("resources.commitListValue") : "") }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return
          event.preventDefault()
          if (!draft) return
          if (schema.uniqueItems && values.includes(draft)) { event.currentTarget.setCustomValidity(t("resources.duplicateListValue")); event.currentTarget.reportValidity(); return }
          change([...values, draft]); setDraft(""); event.currentTarget.setCustomValidity("")
        }} />
    </div>
    {schema.description && <p id={`${id}__description`} className="text-xs text-muted-foreground">{schema.description}</p>}
    {values.map((value, index) => errorSchema?.[index]?.__errors?.map((error, position) => <p role="alert" key={`${index}-${position}`} className="text-xs text-destructive">{value}: {error}</p>))}
  </div>
}
