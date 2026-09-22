/** Decode Claude's paste envelopes for display and prompt correlation only.
 * Keep the native transcript and model input intact, including paste provenance. */
export function claudePromptText(text: string): string {
  const opening = /<pasted_content id="([0-9a-f]{4})">\n/gu
  let result = '', offset = 0
  for (let match = opening.exec(text); match; match = opening.exec(text)) {
    const body = match.index + match[0].length
    const closing = `\n</pasted_content id="${match[1]}">`
    const end = text.indexOf(closing, body - 1)
    if (end < 0) break
    // Claude adds up to two separating newlines around each paste block.
    // Only remove those separators, retaining whitespace inside the body.
    let start = match.index
    for (let count = 0; count < 2 && start > offset && text[start - 1] === '\n'; count++) start--
    result += text.slice(offset, start) + text.slice(body, end)
    offset = end + closing.length
    for (let count = 0; count < 2 && text[offset] === '\n'; count++) offset++
    // Do not recursively interpret XML the user pasted inside this block.
    opening.lastIndex = offset
  }
  return result + text.slice(offset)
}
