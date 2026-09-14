import type { Root } from "mdast"
import { toString } from "mdast-util-to-string"
import { visit } from "unist-util-visit"

import { normalizeFilePath } from "@/lib/file-path"

const CONTROL_CHARACTER = /\p{Cc}/u

export function sandboxFilePath(url: unknown): string | null {
  if (typeof url !== "string" || !/^sandbox:/i.test(url)) return null

  let path: string
  try {
    path = decodeURIComponent(url.slice("sandbox:".length)).replaceAll("\\", "/")
  } catch (error) {
    if (error instanceof URIError) return null
    throw error
  }

  // Only local absolute paths: never reinterpret a URL authority as a file.
  if (CONTROL_CHARACTER.test(path) || !/^(?:\/(?!\/)|[a-z]:\/)/i.test(path)) return null
  return normalizeFilePath(path)
}

export function remarkSandboxFileLinks() {
  return (tree: Root) => {
    const definitions = new Map<string, string>()
    visit(tree, "definition", (node) => {
      const id = node.identifier.toUpperCase()
      if (!definitions.has(id)) definitions.set(id, node.url)
    })

    visit(tree, ["link", "linkReference"], (node) => {
      if (node.type !== "link" && node.type !== "linkReference") return
      const url = node.type === "link" ? node.url : definitions.get(node.identifier.toUpperCase())
      if (!sandboxFilePath(url)) return

      // Keep the URI out of <a href> before URL sanitization. All other links
      // still pass through Streamdown's normal sanitization and link safety.
      const label = toString(node, { includeHtml: false })
      node.data = {
        ...node.data,
        hName: "sandbox-file",
        hProperties: { url, label },
        hChildren: [{ type: "text", value: label }],
      }
    })
  }
}
