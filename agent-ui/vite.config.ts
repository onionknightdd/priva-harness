import { cp } from "node:fs/promises"
import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
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

export default defineConfig({
  plugins: [react(), tailwindcss(), materialIconThemeAssets()],
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
})
