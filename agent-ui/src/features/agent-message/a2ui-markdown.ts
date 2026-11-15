import { fromMarkdown } from "mdast-util-from-markdown"
import type { Code, Image, Paragraph, Root } from "mdast"
import { visit } from "unist-util-visit"

const EMBED_ID = /^[a-z][a-z0-9-]{0,63}$/
const SOURCE_META = /^id=([a-z][a-z0-9-]{0,63})$/

export type DashboardDefinition =
  | { status: "pending" }
  | { status: "ready"; source: string }
  | { status: "error"; error: "missing" | "duplicate" | "invalid"; detail?: string }

export type DashboardMarkdown = {
  markdown: string
  definitions: ReadonlyMap<string, DashboardDefinition>
}

export function dashboardEmbedId(url: unknown): string | undefined {
  return typeof url === "string" && url.startsWith("a2ui:") ? url.slice(5) : undefined
}

function sourceClosed(node: Code, markdown: string): boolean {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return false
  const lines = markdown.slice(start, end).split(/\r?\n/)
  const opening = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0])?.[1]
  if (!opening || lines.length < 2) return false
  const closing = /^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(lines.at(-1) ?? "")?.[1]
  return !!closing && closing[0] === opening[0] && closing.length >= opening.length
}

function standaloneImage(node: Root["children"][number]): Image | undefined {
  return node.type === "paragraph" && node.children.length === 1 && node.children[0].type === "image"
    ? node.children[0] : undefined
}

/** Parse original text before Streamdown repairs unfinished fences or image links. */
export function parseDashboardMarkdown(markdown: string, streaming: boolean): DashboardMarkdown {
  if (!markdown.includes("a2ui")) return { markdown, definitions: new Map() }
  const tree = fromMarkdown(markdown)
  const sources = new Map<string, Code[]>()
  const references = new Map<string, number>()
  const definitions = new Map<string, DashboardDefinition>()
  const replacements: { start: number; end: number; text: string }[] = []
  for (const node of tree.children) {
    const image = standaloneImage(node)
    const id = dashboardEmbedId(image?.url)
    if (id !== undefined) references.set(id, (references.get(id) ?? 0) + 1)
    if (node.type !== "code" || node.lang !== "a2ui") continue
    const sourceId = SOURCE_META.exec(node.meta?.trim() ?? "")?.[1]
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) continue
    if (sourceId) sources.set(sourceId, [...(sources.get(sourceId) ?? []), node])
    else {
      const invalidId = `!invalid-definition-${start}`
      definitions.set(invalidId, streaming && !sourceClosed(node, markdown)
        ? { status: "pending" }
        : { status: "error", error: "invalid", detail: "Use an a2ui fence with id=unique-id." })
      replacements.push({ start, end, text: `![Agent dashboard](a2ui:${invalidId})` })
    }
  }
  for (const [id, count] of references) {
    const blocks = sources.get(id) ?? []
    if (!EMBED_ID.test(id)) definitions.set(id, { status: "error", error: "invalid", detail: "Use a lowercase ID containing letters, digits and hyphens, up to 64 characters." })
    else if (count > 1 || blocks.length > 1) definitions.set(id, { status: "error", error: "duplicate" })
    else if (blocks.length === 0) definitions.set(id, streaming ? { status: "pending" } : { status: "error", error: "missing" })
    else if (!sourceClosed(blocks[0], markdown)) definitions.set(id, streaming ? { status: "pending" } : { status: "error", error: "invalid", detail: "The A2UI source block is incomplete." })
    else definitions.set(id, { status: "ready", source: blocks[0].value })
  }
  for (const [id, blocks] of sources) {
    for (const node of blocks) {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) continue
      if (references.has(id)) replacements.push({ start, end, text: "" })
      else {
        // A source may precede its image reference while the reply is still arriving.
        definitions.set(id, streaming ? { status: "pending" } : { status: "error", error: blocks.length > 1 ? "duplicate" : "missing", detail: "Add a standalone image reference to this A2UI source block." })
        if (node === blocks[0]) replacements.push({ start, end, text: `![Agent dashboard](a2ui:${id})` })
        else replacements.push({ start, end, text: "" })
      }
    }
  }
  let rendered = markdown
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    rendered = rendered.slice(0, replacement.start) + replacement.text + rendered.slice(replacement.end)
  }
  return { markdown: rendered, definitions }
}

/** Convert the whole paragraph into a block component; no a2ui URL reaches an img. */
export function remarkDashboardImages() {
  return (tree: Root) => {
    // Only Markdown images create these elements. Raw HTML cannot reuse an embed ID.
    visit(tree, "html", (node) => { node.value = node.value.replace(/<\/?agent-dashboard\b[^>]*>/gi, "") })
    for (const node of tree.children) {
      const image = standaloneImage(node)
      const id = dashboardEmbedId(image?.url)
      if (!image || id === undefined) continue
      const paragraph = node as Paragraph
      paragraph.data = {
        ...paragraph.data,
        hName: "agent-dashboard",
        hProperties: { embed: id, label: image.alt ?? "" },
        hChildren: [],
      }
    }
  }
}
