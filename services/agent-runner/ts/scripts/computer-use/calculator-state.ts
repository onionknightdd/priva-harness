function controlIndex(tree: string, id: 'One' | 'Add' | 'Equals'): number {
  const matches = tree.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(?:button|按钮)(?=[,\s]).*\bID: ([^,]+?)(?:,.*)?$/iu.exec(line.trimEnd())
    return match?.[2] === id ? [Number(match[1])] : []
  })
  const [index] = matches
  if (matches.length !== 1 || index === undefined || !Number.isSafeInteger(index)) {
    throw new Error(`Calculator must expose one ${id} control in the current window`)
  }
  return index
}

function printedValue(tree: string, id: 'StandardInputView' | 'StandardResultView'): string {
  const lines = tree.split('\n')
  const headers = lines.flatMap((line, index) => (
    new RegExp(`\\bID: ${id}(?:,|$)`, 'u').test(line.trimEnd()) ? [index] : []
  ))
  const [header] = headers
  if (headers.length !== 1 || header === undefined) throw new Error(`Missing unique Calculator field ${id}`)
  const fieldIndent = lines[header]!.search(/\S/u)
  const childIndent = lines[header + 1]?.search(/\S/u) ?? -1
  if (childIndent <= fieldIndent) throw new Error(`Missing Calculator readback for ${id}`)
  let value: string | undefined
  for (const line of lines.slice(header + 1)) {
    const indent = line.search(/\S/u)
    if (indent <= fieldIndent) break
    if (indent !== childIndent) continue
    const match = /^\d+\s+(?:text|static text|文本)\s+(.+)$/iu.exec(line.trim())
    if (!match) continue
    if (value !== undefined) throw new Error(`Ambiguous Calculator readback for ${id}`)
    // Preserve the entire displayed expression. Only spacing and bidirectional
    // formatting marks are presentation characters in these numeric fields.
    value = match[1]!.replace(/[\s\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '')
  }
  if (value === undefined) throw new Error(`Missing Calculator readback for ${id}`)
  return value
}

export function clearedKeypad(tree: string): number[] {
  if (printedValue(tree, 'StandardInputView') !== '0') throw new Error('Calculator must display zero after clearing')
  const one = controlIndex(tree, 'One')
  return [one, controlIndex(tree, 'Add'), one, controlIndex(tree, 'Equals')]
}

export function readCalculation(tree: string): { expression: string, result: string } {
  const expression = printedValue(tree, 'StandardResultView')
  const result = printedValue(tree, 'StandardInputView')
  if (expression !== '1+1' || result !== '2') throw new Error('Calculator did not report the requested expression and result')
  return { expression, result }
}
