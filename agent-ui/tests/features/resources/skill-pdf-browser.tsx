import { createRoot } from "react-dom/client"
import "../../../src/i18n"
import "../../../src/index.css"
import { SkillContent } from "../../../src/features/resources/skill-content"
import type { ResourceSource, SkillDetail } from "../../../src/features/resources/resource-api"

// A valid one-page PDF, generated in memory so the fixture has no binary assets.
function pdfFixture() {
  const stream = "BT /F1 20 Tf 50 750 Td (Skill preview fixture) Tj ET"
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` }
  const xref = pdf.length
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}
const host = document.querySelector<HTMLDivElement>("#page")!
const output = document.querySelector<HTMLPreElement>("#results")!
const root = createRoot(host)
const source: ResourceSource = { id: "global", harness: "claude", scope: "global", origin: "directory", label: "Global", path: "/fixture", cwd: null, writable: true, canAdd: true }
const detail: SkillDetail = { id: "pdf-preview", name: "PDF preview", sourceId: source.id, source, description: "", path: "/fixture/pdf-preview", filePath: "/fixture/pdf-preview/SKILL.md", enabled: true, canToggle: true, canDelete: true, toggleDescription: "", content: "# Fixture", files: [{ path: "example.pdf", size: 1000 }] }
function roots(parent: ParentNode): ParentNode[] {
  return [parent, ...Array.from(parent.querySelectorAll("*")).flatMap((element) => element.shadowRoot ? roots(element.shadowRoot) : [])]
}
document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true
  output.textContent = "Running…"
  const originalFetch = window.fetch
  let assetRequested = false
  let textRequested = false
  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes("/skills/pdf-preview/asset?")) { assetRequested = true; return new Response(pdfFixture(), { headers: { "Content-Type": "application/pdf" } }) }
    if (url.includes("/skills/pdf-preview/file?")) textRequested = true
    return originalFetch(input, init)
  }
  try {
    root.render(<SkillContent detail={detail} query={{ harness: "claude" }} file="example.pdf" />)
    const start = performance.now()
    while (!roots(host).some((node) => node.querySelector("canvas, img[src^='blob:']"))) {
      if (performance.now() - start > 45000) throw new Error(`PDF page did not render; asset requested: ${assetRequested}; ${roots(host).map((node) => node.textContent?.slice(-1000)).join("\n")}`)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!assetRequested || textRequested) throw new Error("PDF did not exclusively use the binary asset endpoint")
    if (!host.querySelector<HTMLButtonElement>('[role="tab"][disabled]')) throw new Error("PDF source tab was not disabled")
    output.textContent = "PASS PDF page renders through the shared viewer\nPASS PDF requests binary data only\nPASS PDF source tab is disabled\n3 checks passed"
  } catch (error) { output.textContent = `FAIL ${error instanceof Error ? error.message : String(error)}` }
  finally { window.fetch = originalFetch; button.disabled = false }
})
