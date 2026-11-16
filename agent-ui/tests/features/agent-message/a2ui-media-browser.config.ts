import { mergeConfig, type Plugin } from "vite"

import appConfig from "../../../vite.config.ts"

// Synthetic SVGs are confined to this isolated server; no workspace file or
// external image service is read by the browser checks.
export default mergeConfig(appConfig, {
  cacheDir: "node_modules/.vite-a2ui-media-checks",
  server: { port: 5188, strictPort: true },
  plugins: [{
    name: "a2ui-media-fixtures",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost")
        const path = url.pathname === "/api/sandbox/files/download" ? url.searchParams.get("path") : url.pathname
        if (!path?.startsWith("/a2ui-media-fixtures/")) return next()
        const name = path.slice("/a2ui-media-fixtures/".length)
        if (!["landscape.svg", "portrait.svg", "retry.svg", "slow.svg"].includes(name)) return next()
        if (name === "retry.svg" && !url.searchParams.has("retry")) {
          response.writeHead(404, { "Cache-Control": "no-store" })
          response.end("Synthetic image is unavailable until retry")
          return
        }
        const portrait = name === "portrait.svg"
        const [width, height] = portrait ? [600, 900] : [1200, 700]
        const send = () => {
          response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" })
          response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#e4ebe8"/><circle cx="${width * 0.76}" cy="${height * 0.26}" r="${width * 0.09}" fill="#dba76a"/><path d="M0 ${height}L${width * 0.34} ${height * 0.31}L${width * 0.8} ${height}Z" fill="#789a91"/><path d="M${width * 0.3} ${height}L${width * 0.78} ${height * 0.5}L${width} ${height * 0.78}V${height}Z" fill="#adc2b9"/><text x="32" y="${height - 34}" font-family="sans-serif" font-size="24" fill="#263c35">ILLUSTRATIVE · ${portrait ? "PORTRAIT" : "LANDSCAPE"}</text></svg>`)
        }
        if (name === "slow.svg") setTimeout(send, 700)
        else send()
      })
    },
  } satisfies Plugin],
})
