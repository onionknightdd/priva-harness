import { PlusIcon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { McpHeaderRow } from "./mcp-headers"

export function McpHeaderFields({ rows, onChange, disabled }: {
  rows: McpHeaderRow[]
  onChange: (rows: McpHeaderRow[]) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const update = (id: number, field: "key" | "value", value: string) => onChange(rows.map((row) => row.id === id ? { ...row, [field]: value } : row))
  return <fieldset className="min-w-0 space-y-2" disabled={disabled}>
    <legend className="mb-2 text-sm font-medium">{t("resources.headers")}</legend>
    {rows.map((row, index) => <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
      <Input value={row.key} onChange={(event) => update(row.id, "key", event.target.value)} placeholder="Key" aria-label={t("resources.headerKey", { index: index + 1 })} autoComplete="off" spellCheck={false} />
      <Input value={row.value} onChange={(event) => update(row.id, "value", event.target.value)} placeholder="Value" aria-label={t("resources.headerValue", { index: index + 1 })} autoComplete="off" spellCheck={false} />
      <Button type="button" variant="ghost" size="icon" aria-label={t("resources.removeHeader", { index: index + 1 })} onClick={() => onChange(rows.filter((entry) => entry.id !== row.id))}><Trash2Icon className="size-4 text-muted-foreground" /></Button>
    </div>)}
    <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onChange([...rows, { id: Math.max(-1, ...rows.map((row) => row.id)) + 1, key: "", value: "" }])}><PlusIcon />{t("resources.addHeader")}</Button>
  </fieldset>
}
