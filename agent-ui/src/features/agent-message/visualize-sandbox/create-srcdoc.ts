import { escapeScriptText, jsonForScript } from "./escape-script"
import { VISUALIZE_SANDBOX_CSP, VISUALIZE_SANDBOX_CSS } from "./sandbox-css"

export function createVisualizeSrcdoc(input: { runtimeJs: string; themeCss: string; frameId: string }): string {
  const themeCss = input.themeCss.replace(/<\/style/gi, "<\\/style")
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${VISUALIZE_SANDBOX_CSP}">
<style>${VISUALIZE_SANDBOX_CSS}</style>
<style id="visualize-theme">${themeCss}</style>
</head><body><div id="root"></div>
<script>${escapeScriptText(input.runtimeJs)}</script>
<script>window.VisualizeSandbox.start(${jsonForScript(input.frameId)});</script>
</body></html>`
}
