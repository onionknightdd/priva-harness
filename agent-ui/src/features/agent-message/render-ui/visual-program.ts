import "./disable-devtools"

import { createParser } from "@openuidev/react-lang"

import type { ToolCard } from "../agent-message-data"
import { isToolRunning } from "../tool-activity"
import { interactiveVisualizeLibrary, staticVisualizeLibrary } from "./library"
import { generatedVisualKind, renderUiLangFromTool } from "./lang"

const parsers = new Map<"static" | "interactive", ReturnType<typeof createParser>>()

function parserFor(kind: "static" | "interactive") {
  const cached = parsers.get(kind)
  if (cached !== undefined) return cached
  const library = kind === "interactive" ? interactiveVisualizeLibrary : staticVisualizeLibrary
  const parser = createParser(library.toJSONSchema(), library.root)
  parsers.set(kind, parser)
  return parser
}

function hasBlockingErrors(kind: "static" | "interactive", lang: string): boolean {
  try {
    const result = parserFor(kind).parse(lang)
    const blocking = result.meta.errors.some((error) => error.severity !== "warning")
    return blocking || result.meta.unresolved.length > 0 || result.root === null
  } catch {
    return true
  }
}

/** A finished visualize call whose program the library still rejects. */
export function finishedProgramRejected(block: {
  type: string
  name: string
  input?: unknown
  tool?: ToolCard
}): boolean {
  const kind = block.type === "tool_use" ? generatedVisualKind(block.name) : null
  if (kind === null || block.tool?.ok === false || isToolRunning(block.tool)) return false
  const lang = renderUiLangFromTool(block.tool?.output, block.tool?.input ?? block.input, block.tool?.ok)
  return lang !== "" && hasBlockingErrors(kind, lang)
}
