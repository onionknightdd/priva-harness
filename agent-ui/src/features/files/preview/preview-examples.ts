import type { PreviewFile } from "@/features/files/model/file.types"

export const workspaceReadmePreview: PreviewFile = {
  id: "workspace-readme",
  name: "README.md",
  path: "priva-harness/README.md",
  mediaType: "text/markdown",
  renderKind: "markdown",
  content: `# Priva Harness

Priva Harness is an Agent Harness built around Agent Message, projects, and a reusable Workspace.

## Workspace

- Inspect files without leaving the active Agent Message.
- Switch between source and rendered views.
- Keep the same preview behavior across the file browser and Workspace.
`,
}
