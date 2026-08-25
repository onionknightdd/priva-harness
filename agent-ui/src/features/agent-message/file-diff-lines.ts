import type { FileDiffLine } from "@/components/agents/file-diff"

export function fileDiffLinesFromContent(content: string): FileDiffLine[] {
  return splitFileLines(content).map((line, index) => ({
    id: `n${String(index)}`,
    type: "added" as const,
    newLine: index + 1,
    content: line,
  }))
}

export function fileDiffLinesFromReplacement(
  oldText: string | undefined,
  newText: string | undefined,
): FileDiffLine[] {
  const oldLines = splitFileLines(oldText)
  const newLines = splitFileLines(newText)
  let prefix = 0
  const prefixLimit = Math.min(oldLines.length, newLines.length)
  while (prefix < prefixLimit && oldLines[prefix] === newLines[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] ===
      newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const lines: FileDiffLine[] = []
  let oldLine = 1
  let newLine = 1
  let index = 0

  const push = (
    type: NonNullable<FileDiffLine["type"]>,
    content: string,
    numbers: Pick<FileDiffLine, "oldLine" | "newLine">
  ) => {
    lines.push({
      id: `e${String(index)}`,
      type,
      content,
      ...numbers,
    })
    index += 1
  }

  for (let i = 0; i < prefix; i += 1) {
    const content = oldLines[i]
    if (content === undefined) {
      continue
    }
    push("context", content, { oldLine, newLine })
    oldLine += 1
    newLine += 1
  }
  for (let i = prefix; i < oldLines.length - suffix; i += 1) {
    const content = oldLines[i]
    if (content === undefined) {
      continue
    }
    push("removed", content, { oldLine })
    oldLine += 1
  }
  for (let i = prefix; i < newLines.length - suffix; i += 1) {
    const content = newLines[i]
    if (content === undefined) {
      continue
    }
    push("added", content, { newLine })
    newLine += 1
  }
  for (let i = oldLines.length - suffix; i < oldLines.length; i += 1) {
    const content = oldLines[i]
    if (content === undefined) {
      continue
    }
    push("context", content, { oldLine, newLine })
    oldLine += 1
    newLine += 1
  }
  return lines
}

export function fileDiffLinesFromUnified(patch: string): FileDiffLine[] {
  if (!looksLikeDiff(patch)) {
    return []
  }
  const lines: FileDiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let index = 0
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const hunk = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(raw)
      if (hunk?.[1] !== undefined && hunk[2] !== undefined) {
        oldLine = Number(hunk[1])
        newLine = Number(hunk[2])
      }
      continue
    }
    if (
      raw === "" ||
      raw.startsWith("\\") ||
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("---") ||
      raw.startsWith("+++")
    ) {
      continue
    }
    const id = `p${String(index)}`
    index += 1
    if (raw.startsWith("+")) {
      lines.push({
        id,
        type: "added",
        newLine,
        content: raw.slice(1),
      })
      newLine += 1
      continue
    }
    if (raw.startsWith("-")) {
      lines.push({
        id,
        type: "removed",
        oldLine,
        content: raw.slice(1),
      })
      oldLine += 1
      continue
    }
    const text = raw.startsWith(" ") ? raw.slice(1) : raw
    lines.push({
      id,
      type: "context",
      oldLine,
      newLine,
      content: text,
    })
    oldLine += 1
    newLine += 1
  }
  return lines
}

export function fileDiffLinesFromEdit(
  oldText: string | undefined,
  newText: string | undefined,
  output: string,
): FileDiffLine[] {
  const unified = fileDiffLinesFromUnified(output)
  if (unified.length > 0) {
    return unified
  }
  if (oldText !== undefined || newText !== undefined) {
    // Snippet-relative 1, 2, 3 are not file line numbers.
    return stripLineNumbers(fileDiffLinesFromReplacement(oldText, newText))
  }
  return fileDiffLinesFromCatN(output)
}

export function fileDiffCopyText(lines: FileDiffLine[]): string {
  return lines
    .map((line) => {
      const mark =
        line.type === "added" ? "+" : line.type === "removed" ? "-" : " "
      return `${mark}${line.content}`
    })
    .join("\n")
}

function splitFileLines(text: string | undefined): string[] {
  if (text === undefined || text === "") {
    return []
  }
  const lines = text.split("\n")
  if (lines.at(-1) === "") {
    lines.pop()
  }
  return lines
}

function looksLikeDiff(text: string): boolean {
  return /^(?:diff --git |--- |\+\+\+ |@@ )/m.test(text)
}

function parseCatNLines(
  output: string
): Array<{ n: number; text: string }> {
  const lines: Array<{ n: number; text: string }> = []
  for (const raw of output.split("\n")) {
    const match = /^[ \t]*(\d+)\t(.*)$/.exec(raw)
    if (match?.[1] === undefined) {
      continue
    }
    lines.push({ n: Number(match[1]), text: match[2] ?? "" })
  }
  return lines
}

function fileDiffLinesFromCatN(output: string): FileDiffLine[] {
  return parseCatNLines(output).map((line, index) => ({
    id: `c${String(index)}`,
    type: "context" as const,
    newLine: line.n,
    content: line.text,
  }))
}

function stripLineNumbers(lines: FileDiffLine[]): FileDiffLine[] {
  return lines.map((line) => ({
    id: line.id,
    type: line.type,
    content: line.content,
  }))
}
