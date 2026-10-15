import type {
  BodyElement,
  DocParagraph,
  DocTable,
  DocxDocumentModel,
  DocxSelectionSourceLocator,
  HeadersFooters,
} from "@silurus/ooxml/docx"
import { strFromU8, unzipSync } from "fflate"

import type { OfficeElementLocator } from "./office-assist.types"

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
const WORD_2010 = "http://schemas.microsoft.com/office/word/2010/wordml"
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const WRAPPERS = new Set(["sdt", "sdtContent", "customXml", "ins", "del", "moveFrom", "moveTo", "AlternateContent", "Choice"])

type SourceEntry = {
  node: Element
  part: string
  text: string
  source: DocxSelectionSourceLocator
  paragraph?: DocParagraph
  table?: DocTable
}

export function docxSourceKey(source: DocxSelectionSourceLocator) {
  return `${source.story}:${source.storyInstance}:${source.path.join(".")}`
}

function children(node: Element, name: string) {
  return Array.from(node.children).filter((child) => child.localName === name)
}

function descendants(node: Element, name: string) {
  return Array.from(node.getElementsByTagNameNS("*", name))
}

function wordAttribute(node: Element | undefined, name: string) {
  return node?.getAttributeNS(WORD, name) ?? node?.getAttribute(`w:${name}`) ?? null
}

function blocks(node: Element): Element[] {
  return Array.from(node.children).flatMap((child) => {
    if (child.localName === "p" || child.localName === "tbl") return [child]
    return WRAPPERS.has(child.localName) ? blocks(child) : []
  })
}

function paragraphText(node: Element) {
  const output: string[] = []
  const visit = (child: Element) => {
    if (child.localName === "p" && child !== node) return
    if (child.localName === "t" || child.localName === "delText") output.push(child.textContent ?? "")
    else if (child.localName === "tab") output.push("\t")
    else if (child.localName === "br") output.push("\n")
    else Array.from(child.children).forEach(visit)
  }
  visit(node)
  return output.join("")
}

function elementText(node: Element): string {
  if (node.localName === "p") return paragraphText(node)
  if (node.localName === "tbl") {
    return children(node, "tr").map((row) => children(row, "tc").map(elementText).join("\t")).join("\n")
  }
  return blocks(node).map(elementText).join("\n")
}

// Namespace-independent XPath remains usable for strict OOXML and documents
// whose author chose a different namespace prefix.
function xpath(node: Element): string {
  const siblings = node.parentElement
    ? Array.from(node.parentElement.children).filter((sibling) => sibling.localName === node.localName && sibling.namespaceURI === node.namespaceURI)
    : [node]
  const segment = `*[local-name()='${node.localName}'][${siblings.indexOf(node) + 1}]`
  return node.parentElement ? `${xpath(node.parentElement)}/${segment}` : `/${segment}`
}

function resolvePart(owner: string, target: string) {
  const segments = (target.startsWith("/") ? target.slice(1) : `${owner.slice(0, owner.lastIndexOf("/") + 1)}${target}`).split("/")
  const output: string[] = []
  for (const segment of segments) {
    if (segment === "..") output.pop()
    else if (segment && segment !== ".") output.push(segment)
  }
  return output.join("/")
}

export function createDocxSourceIndex(data: ArrayBuffer, model: DocxDocumentModel) {
  const archive = unzipSync(new Uint8Array(data), {
    filter: (file) => file.name.endsWith(".xml") || file.name.endsWith(".rels"),
  })
  const xmlCache = new Map<string, Document>()
  const readXml = (part: string) => {
    const cached = xmlCache.get(part)
    if (cached) return cached
    const bytes = archive[part]
    if (!bytes) throw new Error(`DOCX source part is missing: ${part}`)
    const document = new DOMParser().parseFromString(strFromU8(bytes), "application/xml")
    if (document.getElementsByTagName("parsererror").length) throw new Error(`DOCX source part is invalid XML: ${part}`)
    xmlCache.set(part, document)
    return document
  }
  const relationshipMap = (owner: string) => {
    const slash = owner.lastIndexOf("/")
    const part = `${owner.slice(0, slash + 1)}_rels/${owner.slice(slash + 1)}.rels`
    if (!archive[part]) return new Map<string, string>()
    return new Map(Array.from(readXml(part).documentElement.children)
      .filter((relation) => relation.getAttribute("TargetMode") !== "External")
      .map((relation) => [relation.getAttribute("Id") ?? "", resolvePart(owner, relation.getAttribute("Target") ?? "")]))
  }
  const rootRelations = readXml("_rels/.rels")
  const officeRelation = Array.from(rootRelations.documentElement.children)
    .find((relation) => relation.getAttribute("Type")?.endsWith("/officeDocument"))
  if (!officeRelation) throw new Error("DOCX has no officeDocument relationship")
  const mainPart = resolvePart("", officeRelation.getAttribute("Target") ?? "")
  const document = readXml(mainPart)
  const body = descendants(document.documentElement, "body")[0]
  if (!body) throw new Error("DOCX main part has no body")
  const entries = new Map<string, SourceEntry>()
  const modelBlockNodes = new Map<number, Element>()

  const indexBlocks = (items: readonly BodyElement[], parent: Element, part: string, story: DocxSelectionSourceLocator, path: number[] = []) => {
    const xmlBlocks = blocks(parent)
    let xmlIndex = 0
    let previousParagraph: Element | undefined
    items.forEach((item, index) => {
      if (item.type === "pageBreak" && item.sameParagraphAsPrevious && previousParagraph) {
        // Explicit breaks may split one original w:p into multiple model blocks.
        xmlIndex = Math.max(0, xmlBlocks.indexOf(previousParagraph))
      }
      if (item.type !== "paragraph" && item.type !== "table") return
      const desiredName = item.type === "paragraph" ? "p" : "tbl"
      const plainText = item.type === "paragraph"
        ? item.runs.map((run) => "text" in run && typeof run.text === "string" ? run.text : "").join("")
        : ""
      const matchingIndex = xmlBlocks.findIndex((candidate, candidateIndex) => {
        if (candidateIndex < xmlIndex || candidate.localName !== desiredName) return false
        if (item.type !== "paragraph") return true
        const nativeId = candidate.getAttributeNS(WORD_2010, "paraId")
        if (nativeId && item.paragraphId === nativeId) return true
        return !plainText || paragraphText(candidate).includes(plainText)
      })
      const node = xmlBlocks[matchingIndex]
      if (!node || node.localName !== (item.type === "paragraph" ? "p" : "tbl")) {
        throw new Error(`DOCX source model does not match ${part} at ${[...path, index].join(".")}`)
      }
      xmlIndex = matchingIndex + 1
      if (item.type === "paragraph") previousParagraph = node
      const source = { ...story, path: [...path, index] }
      if (story.story === "body" && path.length === 0) modelBlockNodes.set(index, node)
      const entry: SourceEntry = { node, part, text: elementText(node), source }
      entries.set(docxSourceKey(source), entry)
      if (item.type === "paragraph") {
        entry.paragraph = item
        const textBoxes = descendants(node, "txbxContent").filter((candidate) => {
          let ancestor = candidate.parentElement
          while (ancestor && ancestor !== node) {
            if (ancestor.localName === "txbxContent") return false
            ancestor = ancestor.parentElement
          }
          return true
        })
        let textBoxIndex = 0
        item.runs.forEach((run, runIndex) => {
          if (run.type !== "shape" || !("textBoxContent" in run) || !Array.isArray(run.textBoxContent)) return
          const textBox = textBoxes[textBoxIndex++]
          if (!textBox) return
          indexBlocks(run.textBoxContent as BodyElement[], textBox, part, {
            story: "textbox",
            storyInstance: `${story.story}:${story.storyInstance}:${source.path.join(".")}.${runIndex}`,
            path: [],
          })
        })
        return
      }
      entry.table = item
      const xmlRows = children(node, "tr")
      item.rows.forEach((row, rowIndex) => {
        const xmlRow = xmlRows[rowIndex]
        if (!xmlRow) throw new Error(`DOCX table row is missing in ${part}`)
        const xmlCells = children(xmlRow, "tc")
        row.cells.forEach((cell, cellIndex) => {
          const xmlCell = xmlCells[cellIndex]
          if (!xmlCell) throw new Error(`DOCX table cell is missing in ${part}`)
          const cellSource = { ...story, path: [...source.path, rowIndex, cellIndex] }
          entries.set(docxSourceKey(cellSource), { node: xmlCell, part, text: elementText(xmlCell), source: cellSource })
          indexBlocks(cell.content, xmlCell, part, story, [...source.path, rowIndex, cellIndex])
        })
      })
    })
  }
  indexBlocks(model.body, body, mainPart, { story: "body", storyInstance: "body", path: [] })

  const mainRelations = relationshipMap(mainPart)
  const sections = descendants(body, "sectPr")
  const inherited = { header: new Map<string, string>(), footer: new Map<string, string>() }
  const sectionReferences = new Map<Element, typeof inherited>()
  sections.forEach((section) => {
    for (const type of ["header", "footer"] as const) {
      children(section, `${type}Reference`).forEach((reference) => {
        const id = reference.getAttributeNS(REL, "id") ?? reference.getAttribute("r:id")
        const part = id ? mainRelations.get(id) : undefined
        if (part) inherited[type].set(wordAttribute(reference, "type") ?? "default", part)
      })
    }
    sectionReferences.set(section, { header: new Map(inherited.header), footer: new Map(inherited.footer) })
  })
  const indexHeaders = (headers: HeadersFooters | undefined, type: "header" | "footer", section: Element | undefined, instance: string | null) => {
    if (!headers || !section) return
    const references = sectionReferences.get(section)?.[type]
    for (const variant of ["default", "first", "even"] as const) {
      const content = headers[variant]
      const part = references?.get(variant)
      if (!content || !part) continue
      indexBlocks(content.body, readXml(part).documentElement, part, {
        story: type,
        storyInstance: instance ? `${instance}:${variant}` : variant,
        path: [],
      })
    }
  }
  const finalSection = sections.at(-1)
  indexHeaders(model.headers, "header", finalSection, null)
  indexHeaders(model.footers, "footer", finalSection, null)
  model.body.forEach((item, index) => {
    if (item.type !== "sectionBreak") return
    let previous = index - 1
    while (previous >= 0 && !modelBlockNodes.has(previous)) previous--
    const paragraph = modelBlockNodes.get(previous)
    const section = paragraph ? descendants(paragraph, "sectPr")[0] : undefined
    indexHeaders(item.headers, "header", section, `section:${index}`)
    indexHeaders(item.footers, "footer", section, `section:${index}`)
  })
  for (const type of ["footnote", "endnote"] as const) {
    const part = Array.from(mainRelations.values()).find((candidate) => candidate.endsWith(`/${type}s.xml`))
    if (!part) continue
    const notes = descendants(readXml(part).documentElement, type)
    for (const note of type === "footnote" ? model.footnotes ?? [] : model.endnotes ?? []) {
      const node = notes.find((candidate) => wordAttribute(candidate, "id") === note.id)
      if (node) indexBlocks(note.content, node, part, { story: type, storyInstance: note.id, path: [] })
    }
  }

  const resolve = (source: DocxSelectionSourceLocator) => entries.get(docxSourceKey(source))
  const canonicalCell = (entry: SourceEntry): SourceEntry => {
    const merge = descendants(children(entry.node, "tcPr")[0] ?? entry.node, "vMerge")[0]
    if (!merge || wordAttribute(merge, "val") === "restart") return entry
    const path = [...entry.source.path]
    const tableSource = { ...entry.source, path: path.slice(0, -2) }
    const table = resolve(tableSource)
    if (!table?.table) return entry
    const rowIndex = path.at(-2) ?? 0
    const cellIndex = path.at(-1) ?? 0
    const row = table.table.rows[rowIndex]
    if (!row) return entry
    const column = (row.gridBefore ?? 0) + row.cells.slice(0, cellIndex).reduce((sum, cell) => sum + cell.colSpan, 0)
    for (let index = rowIndex - 1; index >= 0; index--) {
      const previous = table.table.rows[index]
      if (!previous) break
      let start = previous.gridBefore ?? 0
      const ownerIndex = previous.cells.findIndex((cell) => {
        const matches = start === column
        start += cell.colSpan
        return matches
      })
      const owner = previous.cells[ownerIndex]
      if (!owner || owner.vMerge === null) break
      if (owner.vMerge) return resolve({ ...entry.source, path: [...path.slice(0, -2), index, ownerIndex] }) ?? entry
    }
    return entry
  }

  return {
    resolve(source: DocxSelectionSourceLocator, elementType: string): { locator: OfficeElementLocator; text: string; source: DocxSelectionSourceLocator } | null {
      const isDrawing = elementType === "image" || elementType === "chart" || elementType === "shape"
      const blockSource = isDrawing ? { ...source, path: source.path.slice(0, -1) } : source
      const original = resolve(blockSource)
      if (!original) return null
      const entry = elementType === "table-cell" ? canonicalCell(original) : original
      const paragraphId = entry.node.getAttributeNS(WORD_2010, "paraId") ?? undefined
      const locator: OfficeElementLocator = {
        part: entry.part,
        xpath: xpath(entry.node),
        story: source.story,
        storyInstance: source.storyInstance,
        path: [...(isDrawing ? source.path : entry.source.path)],
        ...(paragraphId ? { paragraphId } : {}),
        ...(elementType === "table-cell" ? { row: entry.source.path.at(-2), column: entry.source.path.at(-1) } : {}),
      }
      return { locator, text: entry.text, source: isDrawing ? source : entry.source }
    },
  }
}
