export type ResourceKind = "skills" | "mcp"
export type ResourceHarness = "claude" | "pi"
export type ResourceQuery = { harness: ResourceHarness; cwd?: string }
export type ResourceSource = {
  id: string; harness: ResourceHarness; scope: "global" | "project" | "local"
  origin: string; label: string; path: string; cwd: string | null; writable: boolean; canAdd: boolean
}
export type Skill = {
  id: string; sourceId: string; name: string; description: string; path: string; filePath: string
  enabled: boolean; canToggle: boolean; canDelete: boolean; toggleDescription: string
}
export type Mcp = {
  id: string; sourceId: string; name: string; transport: string; target: string
  enabled: boolean; effective: boolean | null; override: boolean; headerCount: number
}
export type ResourceItem = Skill | Mcp
export type ResourceGroup<T = ResourceItem> = { source: ResourceSource; items: T[] }
export type ResourceList<T = ResourceItem> = {
  groups: ResourceGroup<T>[]; diagnostics: { path: string; message: string }[]; projects: string[]
}
export type SkillDetail = Skill & { source: ResourceSource; content: string; files: { path: string; size: number }[] }
export type McpDetail = Mcp & {
  source: ResourceSource; definition: Record<string, unknown>; effectiveDefinition: Record<string, unknown> | null
}
export type ResourceDetail = SkillDetail | McpDetail
export type McpCapabilities = {
  tools: Record<string, unknown>[]; resources: Record<string, unknown>[]; prompts: Record<string, unknown>[]; testedAt: string
}

export function resourceUrl(path: string, query: ResourceQuery, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ harness: query.harness, ...extra })
  if (query.cwd) params.set("cwd", query.cwd)
  return `/api/sandbox/resource/${path}?${params.toString()}`
}

export async function resourceRequest<T>(path: string, query: ResourceQuery, init?: RequestInit, extra?: Record<string, string>): Promise<T> {
  const response = await fetch(resourceUrl(path, query, extra), init)
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail || `Request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return await response.json() as T
}

export function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function filterResourceGroups(groups: ResourceGroup[], search: string) {
  const term = search.trim().toLocaleLowerCase()
  if (!term) return groups
  return groups.map((group) => ({ ...group, items: group.items.filter((item) =>
    [item.name, "description" in item ? item.description : item.target, group.source.label, group.source.path, group.source.cwd ?? ""].some((value) => value.toLocaleLowerCase().includes(term))) })).filter((group) => group.items.length > 0)
}

export function resourceProjectName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path
}

export function groupResourcesByProject(groups: ResourceGroup[]) {
  const global: ResourceGroup[] = []
  const projects = new Map<string, { cwd: string; name: string; groups: ResourceGroup[] }>()
  for (const group of groups) {
    if (group.source.scope === "global") {
      global.push(group)
      continue
    }
    const cwd = group.source.cwd ?? group.source.path
    let project = projects.get(cwd)
    if (!project) {
      project = { cwd, name: resourceProjectName(cwd), groups: [] }
      projects.set(cwd, project)
    }
    project.groups.push(group)
  }
  return { global, projects: [...projects.values()] }
}

export function resourceSourceLabel(source: ResourceSource): string {
  if (["package", "plugin", "import"].includes(source.origin)) return source.label
  if (source.cwd && source.path.startsWith(`${source.cwd}/`)) return source.path.slice(source.cwd.length + 1)
  if (source.scope === "local") return `Local · ${resourceProjectName(source.path)}`
  return source.label.replace(/^(?:Global|Project)\s*·\s*/u, "")
}

export type SkillTreeNode = { name: string; path: string; children: SkillTreeNode[]; file: boolean }
export function buildSkillTree(files: SkillDetail["files"]): SkillTreeNode[] {
  const root: SkillTreeNode[] = []
  for (const file of files) {
    let children = root
    const parts = file.path.split("/")
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/")
      let node = children.find((entry) => entry.name === name)
      if (!node) { node = { name, path, children: [], file: index === parts.length - 1 }; children.push(node) }
      children = node.children
    })
  }
  const sort = (nodes: SkillTreeNode[]) => { nodes.sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name)); nodes.forEach((node) => sort(node.children)) }
  sort(root)
  return root
}
