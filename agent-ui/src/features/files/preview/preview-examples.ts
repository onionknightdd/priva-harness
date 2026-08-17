import type { PreviewFile } from "@/features/files/model/file.types"

export const canvasReadmePreview: PreviewFile = {
  id: "canvas-readme",
  name: "README.md",
  path: "priva-harness/README.md",
  mediaType: "text/markdown",
  renderKind: "markdown",
  content: `# Priva Harness

Priva Harness is an Agent Harness workspace built around conversations, projects, and a reusable Canvas.

## Canvas

- Inspect files without leaving the active conversation.
- Switch between source and rendered views.
- Keep the same preview behavior across the file browser and Canvas.
`,
}
