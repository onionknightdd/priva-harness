const APP_DECLARATION =
  /^\s*(?:export\s+default\s+)?(?:function\s+App\b|class\s+App\b|const\s+App\s*=|let\s+App\s*=|var\s+App\s*=)/

const EXPORT_DEFAULT = /^\s*export\s+default\s+/gm

export function wrapVisualizeSource(source: string): string {
  const trimmed = stripModuleSyntax(source.trim())
  if (trimmed === "") {
    return "function App() {\n  return null;\n}\n"
  }
  if (APP_DECLARATION.test(trimmed)) {
    return trimmed
  }
  return `function App() {\n  return (\n    <>\n${indent(trimmed)}\n    </>\n  );\n}\n`
}

export function stripModuleSyntax(source: string): string {
  return source
    .replace(/^\s*import\b[^\n]*$/gm, "")
    .replace(EXPORT_DEFAULT, "")
    .trim()
}

function indent(source: string): string {
  return source
    .split("\n")
    .map((line) => (line === "" ? line : `      ${line}`))
    .join("\n")
}
