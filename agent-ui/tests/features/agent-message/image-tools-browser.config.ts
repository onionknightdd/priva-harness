import { mergeConfig, type Plugin } from "vite"

import appConfig from "../../../vite.config.ts"

// Only this isolated fixture server handles synthetic image paths. It never
// reads workspace files or calls an image model.
export default mergeConfig(appConfig, {
  cacheDir: "node_modules/.vite-image-tools-checks",
  server: { port: 5175, strictPort: true },
  plugins: [{
    name: "image-tool-fixtures",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost")
        const path = url.searchParams.get("path") ?? ""
        if (url.pathname !== "/api/sandbox/files/download" || !path.startsWith("/image-tool-fixtures/")) return next()
        if (path.endsWith("retry.png") && !url.searchParams.has("retry")) {
          response.writeHead(404)
          response.end("Fixture image unavailable")
          return
        }
        const edited = path.endsWith("result.png")
        response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" })
        response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="${edited ? "#27354f" : "#d8e6eb"}"/><circle cx="910" cy="180" r="76" fill="${edited ? "#fff7d3" : "#e8b775"}"/><path d="M0 720L350 200 700 720Z" fill="${edited ? "#546782" : "#719499"}"/><path d="M440 800L880 330 1200 780V800Z" fill="${edited ? "#9cadb8" : "#9cb9b8"}"/><text x="44" y="748" font-family="sans-serif" font-size="32" fill="${edited ? "#ffffff" : "#26383c"}">${edited ? "AFTER · NIGHT" : "BEFORE · DAY"}</text></svg>`)
      })
    },
  } satisfies Plugin],
})
