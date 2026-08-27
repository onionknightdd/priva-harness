const TAG_REGEX = /<\/?([a-zA-Z][a-zA-Z0-9]*)\s*([^>]*?)(\/)?>/

function matchJsxTag(code: string) {
  if (code.trim() === "") {
    return null
  }

  const match = code.match(TAG_REGEX)
  if (!match || match.index === undefined) {
    return null
  }

  const [fullMatch, tagName, , selfClosing] = match
  let type: "self-closing" | "closing" | "opening"
  if (selfClosing) {
    type = "self-closing"
  } else if (fullMatch.startsWith("</")) {
    type = "closing"
  } else {
    type = "opening"
  }

  return {
    endIndex: match.index + fullMatch.length,
    tagName,
    type,
  }
}

function stripIncompleteTag(text: string) {
  const lastOpen = text.lastIndexOf("<")
  if (lastOpen === -1) {
    return text
  }
  const afterOpen = text.slice(lastOpen)
  if (!afterOpen.includes(">")) {
    return text.slice(0, lastOpen)
  }
  return text
}

export function completeJsxTag(code: string) {
  const stack: string[] = []
  let result = ""
  let currentPosition = 0

  while (currentPosition < code.length) {
    const match = matchJsxTag(code.slice(currentPosition))
    if (!match) {
      result += stripIncompleteTag(code.slice(currentPosition))
      break
    }
    const { tagName, type, endIndex } = match
    result += code.slice(currentPosition, currentPosition + endIndex)
    if (type === "opening") {
      stack.push(tagName)
    } else if (type === "closing") {
      stack.pop()
    }
    currentPosition += endIndex
  }

  return (
    result +
    [...stack]
      .reverse()
      .map((tag) => `</${tag}>`)
      .join("")
  )
}
