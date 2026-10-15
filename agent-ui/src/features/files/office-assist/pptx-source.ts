import { strFromU8, unzipSync } from "fflate"

export const PPTX_PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
export const PPTX_DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
const RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
const OFFICE_RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

export type PptxOrigin = "slide" | "layout" | "master"

export interface PptxSourceObject {
  part: string
  origin: PptxOrigin
  id: string
  type: "shape" | "picture" | "table" | "chart" | "media"
  element: Element
  xpath: string
}

export interface PptxSourceSlide {
  part: string
  objects: PptxSourceObject[]
}

export function pptxChildren(element: Element, namespace: string, localName: string) {
  return Array.from(element.children).filter((child) => child.namespaceURI === namespace && child.localName === localName)
}

export function pptxChild(element: Element, namespace: string, localName: string) {
  return pptxChildren(element, namespace, localName)[0]
}

export function pptxXPath(element: Element): string {
  const steps: string[] = []
  let current: Element | null = element
  while (current) {
    const name = current.namespaceURI === PPTX_PRESENTATION_NS ? "p:" + current.localName
      : current.namespaceURI === PPTX_DRAWING_NS ? "a:" + current.localName : current.tagName
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((sibling) => sibling.namespaceURI === current!.namespaceURI && sibling.localName === current!.localName)
      : [current]
    steps.unshift(name + "[" + (siblings.indexOf(current) + 1) + "]")
    current = current.parentElement
  }
  return "/" + steps.join("/")
}

function resolvePart(from: string, target: string): string {
  const segments = target.startsWith("/") ? [] : from.split("/").slice(0, -1)
  for (const segment of target.split("/")) {
    if (segment === "..") segments.pop()
    else if (segment && segment !== ".") segments.push(segment)
  }
  return segments.join("/")
}

function relationshipPart(part: string) {
  const slash = part.lastIndexOf("/")
  return part.slice(0, slash + 1) + "_rels/" + part.slice(slash + 1) + ".rels"
}

/** Resolve parts through OPC relationships; slide numbers are not filenames. */
export function readPptxSources(data: ArrayBuffer): PptxSourceSlide[] {
  const files = unzipSync(new Uint8Array(data), {
    filter: (entry) => /\.(xml|rels)$/i.test(entry.name),
  })
  const documents = new Map<string, Document>()
  const read = (part: string) => {
    const existing = documents.get(part)
    if (existing) return existing
    const bytes = files[part]
    if (!bytes) return undefined
    const document = new DOMParser().parseFromString(strFromU8(bytes), "application/xml")
    if (document.getElementsByTagName("parsererror").length > 0) throw new Error("Invalid PPTX XML: " + part)
    documents.set(part, document)
    return document
  }
  const relationships = (part: string) => {
    const document = read(part ? relationshipPart(part) : "_rels/.rels")
    return Array.from(document?.getElementsByTagNameNS(RELATIONSHIPS_NS, "Relationship") ?? [])
      .filter((relationship) => relationship.getAttribute("TargetMode") !== "External")
      .map((relationship) => ({
        id: relationship.getAttribute("Id"),
        type: relationship.getAttribute("Type")?.split("/").at(-1),
        target: resolvePart(part, relationship.getAttribute("Target") ?? ""),
      }))
  }
  const presentationPart = relationships("").find((relationship) => relationship.type === "officeDocument")?.target
  if (!presentationPart) throw new Error("PPTX presentation relationship is missing")
  const presentation = read(presentationPart)
  if (!presentation) throw new Error("PPTX presentation part is missing")
  const presentationRelationships = relationships(presentationPart)

  const objects = (part: string, origin: PptxOrigin): PptxSourceObject[] => {
    const document = read(part)
    if (!document) return []
    const tree = document.getElementsByTagNameNS(PPTX_PRESENTATION_NS, "spTree")[0]
    if (!tree) return []
    const result: PptxSourceObject[] = []
    const visit = (parent: Element) => {
      for (const element of Array.from(parent.children)) {
        if (element.namespaceURI !== PPTX_PRESENTATION_NS) continue
        if (element.localName === "grpSp") {
          visit(element)
          continue
        }
        if (!["sp", "cxnSp", "pic", "graphicFrame"].includes(element.localName)) continue
        const id = element.getElementsByTagNameNS(PPTX_PRESENTATION_NS, "cNvPr")[0]?.getAttribute("id")
        if (!id) continue
        const has = (name: string) => element.getElementsByTagNameNS("*", name).length > 0
        const type = has("tbl") ? "table" : has("chart") || has("chartEx") ? "chart"
          : has("videoFile") || has("audioFile") || has("media") ? "media"
            : element.localName === "pic" ? "picture" : "shape"
        result.push({ part, origin, id, type, element, xpath: pptxXPath(element) })
      }
    }
    visit(tree)
    return result
  }

  return Array.from(presentation.getElementsByTagNameNS(PPTX_PRESENTATION_NS, "sldId")).map((slide) => {
    const id = slide.getAttributeNS(OFFICE_RELATIONSHIPS_NS, "id")
    const part = presentationRelationships.find((relationship) => relationship.id === id && relationship.type === "slide")?.target
    if (!part || !read(part)) throw new Error("PPTX slide part is missing: " + (id ?? "unknown"))
    const layoutPart = relationships(part).find((relationship) => relationship.type === "slideLayout")?.target
    const masterPart = layoutPart && relationships(layoutPart).find((relationship) => relationship.type === "slideMaster")?.target
    return {
      part,
      objects: [
        ...(masterPart ? objects(masterPart, "master") : []),
        ...(layoutPart ? objects(layoutPart, "layout") : []),
        ...objects(part, "slide"),
      ],
    }
  })
}
