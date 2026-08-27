import { cp } from "node:fs/promises"
import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { build as esbuildBuild } from "esbuild"
import { defineConfig, type Plugin } from "vite"

function materialIconThemeAssets(): Plugin {
  const sourceDirectory = path.resolve(
    import.meta.dirname,
    "node_modules/material-icon-theme/icons"
  )
  let outputDirectory = ""

  return {
    name: "material-icon-theme-assets",
    apply: "build",
    configResolved(config) {
      outputDirectory = path.resolve(
        config.root,
        config.build.outDir,
        "material-icon-theme"
      )
    },
    async writeBundle() {
      await cp(sourceDirectory, outputDirectory, { recursive: true })
    },
  }
}

function visualizeSandboxRuntime(): Plugin {
  const virtualId = "virtual:visualize-sandbox-runtime"
  const resolvedId = `\0${virtualId}`
  const entry = path.resolve(
    import.meta.dirname,
    "src/features/agent-message/visualize-sandbox/runtime-entry.ts"
  )
  const components = path.resolve(
    import.meta.dirname,
    "src/features/agent-message/visualize-sandbox/sandbox-components.tsx"
  )

  return {
    name: "visualize-sandbox-runtime",
    resolveId(id) {
      if (id === virtualId) {
        return resolvedId
      }
    },
    async load(id) {
      if (id !== resolvedId) {
        return
      }
      this.addWatchFile(entry)
      this.addWatchFile(components)
      const result = await esbuildBuild({
        absWorkingDir: import.meta.dirname,
        bundle: true,
        entryPoints: [entry],
        format: "iife",
        jsx: "automatic",
        minify: true,
        platform: "browser",
        target: "es2022",
        write: false,
        logLevel: "silent",
      })
      const code = result.outputFiles[0]?.text
      if (!code) {
        throw new Error("visualize sandbox runtime bundle is empty")
      }
      return `export default ${JSON.stringify(code)};`
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    materialIconThemeAssets(),
    visualizeSandboxRuntime(),
  ],
  server: {
    proxy: {
      "/api": {
        target: process.env.AGENT_RUNNER_URL ?? "http://127.0.0.1:8000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: [
      "@headless-tree/core",
      "@headless-tree/react",
      "react-resizable-panels",
      "recharts",
      "react-is",
      "xlsx",
    ],
  },
})
