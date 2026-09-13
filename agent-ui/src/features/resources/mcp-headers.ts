export type McpHeaderRow = { id: number; key: string; value: string }

export function mcpHeaderRows(headers: unknown): McpHeaderRow[] | null {
  if (headers === undefined) return []
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return null
  const entries = Object.entries(headers)
  if (entries.some(([, value]) => typeof value !== "string")) return null
  return entries.map(([key, value], id) => ({ id, key, value: value as string }))
}

export function mcpHeaders(rows: McpHeaderRow[]): { headers: Record<string, string>; error?: never } | { error: "resources.headerKeyRequired" | "resources.duplicateHeader"; headers?: never } {
  const keys = new Set<string>()
  const entries: [string, string][] = []
  for (const row of rows) {
    const key = row.key.trim()
    if (!key && !row.value) continue
    if (!key) return { error: "resources.headerKeyRequired" }
    // HTTP header names are case-insensitive; never silently overwrite a row.
    if (keys.has(key.toLowerCase())) return { error: "resources.duplicateHeader" }
    keys.add(key.toLowerCase())
    entries.push([key, row.value])
  }
  return { headers: Object.fromEntries(entries) }
}
