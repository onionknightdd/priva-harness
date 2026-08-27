import { transform } from "sucrase"

import { wrapVisualizeSource } from "./wrap-source"

export type CompileVisualizeJsxResult =
  | { ok: true; code: string }
  | { ok: false; error: string }

export function compileVisualizeJsx(source: string): CompileVisualizeJsxResult {
  try {
    const wrapped = wrapVisualizeSource(source)
    const result = transform(wrapped, {
      transforms: ["typescript", "jsx"],
      jsxRuntime: "classic",
      production: true,
      filePath: "visualize.jsx",
    })
    return { ok: true, code: result.code }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
