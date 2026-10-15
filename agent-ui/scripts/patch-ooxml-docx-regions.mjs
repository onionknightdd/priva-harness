import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

// Upstream 0.88 exposes drawing hit testing but not retained paragraph/table/cell
// regions. Extend its existing projection traversal so these boxes use exactly
// the transforms, clipping, merge ownership and pagination used by rendering.
const packageRoot = new URL("../node_modules/@silurus/ooxml/", import.meta.url)
const metadata = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"))
assert.equal(metadata.version, "0.88.0", "Review the DOCX region patch before upgrading @silurus/ooxml")

function replaceOnce(source, before, after, file) {
  assert.equal(source.split(before).length, 2, `Unexpected @silurus/ooxml source in ${file}: ${before.slice(0, 90)}`)
  return source.replace(before, after)
}

const regionHelpers = `
// priva-docx-element-regions-v1: derive regions from the retained paint traversal.
function agentDocxRegionBounds(bounds, matrix) {
  const points = [
    { xPt: bounds.xPt, yPt: bounds.yPt },
    { xPt: bounds.xPt + bounds.widthPt, yPt: bounds.yPt },
    { xPt: bounds.xPt, yPt: bounds.yPt + bounds.heightPt },
    { xPt: bounds.xPt + bounds.widthPt, yPt: bounds.yPt + bounds.heightPt }
  ].map(point => Kd(matrix, point));
  const xPt = Math.min(...points.map(point => point.xPt));
  const yPt = Math.min(...points.map(point => point.yPt));
  return { xPt, yPt, widthPt: Math.max(...points.map(point => point.xPt)) - xPt,
    heightPt: Math.max(...points.map(point => point.yPt)) - yPt };
}
function agentCollectDocxRegion(node, context, collector) {
  if (!collector.collectElementRegions) return;
  let bounds = agentDocxRegionBounds(node.flowBounds, context.pointToPage);
  const clips = node.clipBounds ? [...context.clips, { bounds: node.clipBounds, pointToPage: context.pointToPage }] : context.clips;
  for (const clip of clips) {
    const limit = agentDocxRegionBounds(clip.bounds, clip.pointToPage);
    const xPt = Math.max(bounds.xPt, limit.xPt), yPt = Math.max(bounds.yPt, limit.yPt);
    const right = Math.min(bounds.xPt + bounds.widthPt, limit.xPt + limit.widthPt);
    const bottom = Math.min(bounds.yPt + bounds.heightPt, limit.yPt + limit.heightPt);
    bounds = { xPt, yPt, widthPt: Math.max(0, right - xPt), heightPt: Math.max(0, bottom - yPt) };
  }
  if (!(bounds.widthPt > 0 && bounds.heightPt > 0)) return;
  collector.elementRegions.push({ elementType: node.kind, bounds,
    source: { ...node.source, path: [...node.source.path] },
    ...(node.paragraphId === undefined ? {} : { paragraphId: node.paragraphId }) });
}
function agentDocxPageBlockRegions(layout, pageIndex) {
  return mf(layout, pageIndex, { collectTextRuns: false, collectTextRunSources: false,
    collectDrawings: false, collectElementRegions: true }).elementRegions;
}
`

const regionMethod = `
	// priva-docx-element-regions-v1
	async getPageElementRegions(pageIndex) {
		if (this._mode !== "main") throw Error("getPageElementRegions requires mode: 'main'");
		const layout = this._getLayout();
		if (!layout) throw Error("Document not loaded");
		const regions = agentDocxPageBlockRegions(layout, pageIndex).map(region => ({
			...region, pageIndex
		}));
		const services = E(this).services;
		if (!services) throw Error("Document layout services are not initialized");
		for (const [elementIndex, entry] of Ie(layout, pageIndex).entries()) {
			const context = $t(entry, pageIndex, elementIndex, { xPt: 0, yPt: 0 }, Oe(services), 20000);
			if (context) regions.push({ pageIndex, elementType: context.elementType,
				bounds: context.bounds, source: context.source,
				elementIndex, ...(context.text === undefined ? {} : { text: context.text }) });
		}
		return regions;
	}
`

const regionType = `
/** Retained page geometry in points, including empty/padded/merged table cells. */
interface DocxPageElementRegion {
  readonly pageIndex: number;
  readonly elementType: 'paragraph' | 'table' | 'table-cell' | 'chart' | 'image' | 'shape';
  readonly bounds: Readonly<DocxPagePoint & { widthPt: number; heightPt: number }>;
  readonly source: DocxSelectionSourceLocator;
  readonly paragraphId?: string;
  readonly elementIndex?: number;
  readonly text?: string;
}
`

const operations = [
  {
    path: "dist/document-pull-client-B9PTM-pL.js",
    patch(source, file) {
      source = replaceOnce(source, "function df(e, t, n) {\n", "function df(e, t, n) {\n\tagentCollectDocxRegion(e, t, n);\n", file)
      source = replaceOnce(source, "function ff(e, t, n) {\n", "function ff(e, t, n) {\n\tagentCollectDocxRegion(e, t, n);\n", file)
      source = replaceOnce(source, "\t\tlet i = af(r, e.clipBounds);\n\t\tfor (let t of e.blocks)", "\t\tagentCollectDocxRegion(e, r, n);\n\t\tlet i = af(r, e.clipBounds);\n\t\tfor (let t of e.blocks)", file)
      source = replaceOnce(source, "\t\tcollectRasterPaintOccurrences: n.collectRasterPaintOccurrences === !0,\n", "\t\tcollectRasterPaintOccurrences: n.collectRasterPaintOccurrences === !0,\n\t\telementRegions: [],\n", file)
      source = replaceOnce(source, "function hf(e, t) {\n", regionHelpers + "\nfunction hf(e, t) {\n", file)
      return replaceOnce(source, "export { Br as A,", "export { agentDocxPageBlockRegions, Br as A,", file)
    },
  },
  {
    path: "dist/docx-BF9WXrYH.js",
    patch(source, file) {
      source = replaceOnce(source, "import { A as Oe,", "import { agentDocxPageBlockRegions, A as Oe,", file)
      return replaceOnce(source, "\tasync getElementContextAt(e, t, n = {}) {\n", regionMethod + "\tasync getElementContextAt(e, t, n = {}) {\n", file)
    },
  },
  {
    path: "dist/types/docx.d.ts",
    patch(source, file) {
      source = replaceOnce(source, "interface DocxElementContext {\n", regionType + "\ninterface DocxElementContext {\n", file)
      source = replaceOnce(source, "  getElementContextAt(pageIndex: number,", "  getPageElementRegions(pageIndex: number): Promise<readonly DocxPageElementRegion[]>;\n  getElementContextAt(pageIndex: number,", file)
      return replaceOnce(source, "type DocxPagePoint,", "type DocxPageElementRegion, type DocxPagePoint,", file)
    },
  },
]

// Prepare every transformation before writing, so mismatched upstream output
// cannot leave a partially installed patch. Already patched installs are safe.
const updates = []
for (const operation of operations) {
  const url = new URL(operation.path, packageRoot)
  const source = await readFile(url, "utf8")
  const patched = operation.path.endsWith(".d.ts")
    ? source.includes("getPageElementRegions(pageIndex: number)")
    : source.includes("priva-docx-element-regions-v1")
  if (!patched) updates.push({ url, source: operation.patch(source, operation.path) })
}
for (const update of updates) await writeFile(update.url, update.source)
console.log(`@silurus/ooxml DOCX regions: ${updates.length ? "patched" : "already patched"} (${fileURLToPath(packageRoot)})`)
