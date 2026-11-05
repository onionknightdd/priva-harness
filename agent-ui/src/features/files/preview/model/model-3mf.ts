import { unzipSync, zipSync } from "fflate"
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js"
import type { LoadingManager } from "three"
import type { ModelUnit } from "./model-types"

const MAX_EXPANDED_BYTES = 128 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 4096
const METERS_PER_UNIT: Record<string, number> = {
  micron: 0.000001, millimeter: 0.001, centimeter: 0.01, inch: 0.0254, foot: 0.3048, meter: 1,
}
const MATERIAL_NAMESPACE = "http://schemas.microsoft.com/3dmanufacturing/material/2015/02"

function parseXml(bytes: Uint8Array | undefined, name: string) {
  if (!bytes) throw new Error(`3MF package is missing ${name}`)
  const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml")
  if (document.querySelector("parsererror")) throw new Error(`Invalid XML in 3MF package: ${name}`)
  return document
}

function packagePath(target: string) {
  if (!target || /[\\?#]/.test(target) || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) throw new Error("3MF model must reference a file inside its package")
  const parts: string[] = []
  for (const part of decodeURIComponent(target).split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (!parts.length) throw new Error("3MF model path escapes its package")
      parts.pop()
    } else parts.push(part)
  }
  return parts.join("/")
}

function inspectPackage(data: ArrayBuffer) {
  let expandedBytes = 0
  let entries = 0
  // Check every entry's declared expansion before the native loader inflates
  // the complete package. This pass only extracts XML needed for metadata.
  const xml = unzipSync(new Uint8Array(data), { filter: (entry) => {
    if (entry.compression === 0 && entry.size !== entry.originalSize) throw new Error("3MF package contains an invalid stored ZIP entry")
    expandedBytes += entry.originalSize
    if (++entries > MAX_ARCHIVE_ENTRIES || expandedBytes > MAX_EXPANDED_BYTES) throw new Error("3MF package exceeds the 128 MiB / 4096 entry preview budget")
    return entry.name.endsWith(".model") || entry.name === "_rels/.rels"
  } })
  const relationships = parseXml(xml["_rels/.rels"], "_rels/.rels")
  const relationship = [...relationships.querySelectorAll("Relationship")].find((entry) => entry.getAttribute("Type")?.endsWith("/3dmodel"))
  if (!relationship || relationship.getAttribute("TargetMode") === "External") throw new Error("3MF package has no internal model relationship")
  const target = relationship.getAttribute("Target") ?? ""
  const modelPath = packagePath(target)
  const model = parseXml(xml[modelPath], modelPath).documentElement
  if (model.localName !== "model") throw new Error("3MF package contains no model document")
  const unitName = model.getAttribute("unit") || "millimeter"
  if (!Object.hasOwn(METERS_PER_UNIT, unitName)) throw new Error(`Unsupported 3MF unit: ${unitName}`)
  const metersPerUnit = METERS_PER_UNIT[unitName]
  for (const [path, bytes] of Object.entries(xml)) {
    if (!path.endsWith(".model")) continue
    const element = path === modelPath ? model : parseXml(bytes, path).documentElement
    for (const prefix of (element.getAttribute("requiredextensions") ?? "").split(/\s+/).filter(Boolean)) {
      if (element.lookupNamespaceURI(prefix) !== MATERIAL_NAMESPACE) throw new Error(`Unsupported required 3MF extension: ${prefix}`)
    }
    if ((element.getAttribute("unit") || "millimeter") !== unitName) throw new Error("3MF parts with different units are not supported")
  }

  let payload = data
  if (target !== "/" + modelPath) {
    // The native loader assumes an absolute OPC relationship. Normalize valid
    // relative targets without changing model coordinates or source bytes.
    relationship.setAttribute("Target", "/" + modelPath)
    const archive = unzipSync(new Uint8Array(data))
    archive["_rels/.rels"] = new TextEncoder().encode(new XMLSerializer().serializeToString(relationships))
    payload = zipSync(archive, { level: 0 }).buffer as ArrayBuffer
  }
  return { payload, unit: { metersPerUnit, source: "format" } satisfies ModelUnit }
}

/** The caller owns model geometry; this helper owns native texture blob URLs. */
export function parseThreeMf(data: ArrayBuffer, manager: LoadingManager) {
  const { payload, unit } = inspectPackage(data)
  const urls = new Set<string>()
  manager.setURLModifier((url) => {
    if (!url.startsWith("blob:")) throw new Error("3MF textures must be embedded in the package")
    urls.add(url)
    return url
  })
  const dispose = () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear() }
  try {
    const root = new ThreeMFLoader(manager).parse(payload)
    return { root, unit, dispose }
  } catch (error) { dispose(); throw error }
}
