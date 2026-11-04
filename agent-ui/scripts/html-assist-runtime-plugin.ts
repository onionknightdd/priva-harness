import path from "node:path"
import { build } from "esbuild"
import type { Plugin } from "vite"

export function htmlAssistRuntime(): Plugin {
  const virtualId = "virtual:html-assist-runtime"
  const resolvedId = `\0${virtualId}`
  const root = path.resolve(import.meta.dirname, "..")
  const entry = path.resolve(root, "src/features/files/html-assist/runtime-entry.ts")
  return {
    name: "html-assist-runtime",
    resolveId(id) {
      if (id === virtualId) return resolvedId
    },
    async load(id) {
      if (id !== resolvedId) return
      const result = await build({
        absWorkingDir: root,
        bundle: true,
        entryPoints: [entry],
        format: "iife",
        minify: true,
        platform: "browser",
        target: "es2022",
        write: false,
        metafile: true,
        logLevel: "silent",
      })
      for (const input of Object.keys(result.metafile.inputs)) this.addWatchFile(path.resolve(root, input))
      const code = result.outputFiles[0]?.text
      if (!code) throw new Error("HTML assist runtime bundle is empty")
      return `export default ${JSON.stringify(code)};`
    },
  }
}
