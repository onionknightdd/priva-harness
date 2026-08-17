import type {
  FileRenderKind,
  PreviewFile,
} from "@/features/files"

import {
  fileBrowserItems,
  getFileBrowserPath,
} from "./file-browser-data"

type FilePreviewRecord = {
  content?: string
  mediaType: string
  renderKind?: FileRenderKind
  renderSource?: string
}

const previewRecords: Record<string, FilePreviewRecord> = {
  "app-tsx": {
    mediaType: "text/typescript",
    content: `import { CanvasShell } from "@/components/canvas"
import { AppSidebar } from "@/components/sidebar"

export default function App() {
  return (
    <CanvasShell>
      <AppSidebar />
    </CanvasShell>
  )
}
`,
  },
  "index-css": {
    mediaType: "text/css",
    content: `@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@fontsource-variable/inter";

@custom-variant dark (&:is(.dark *));
`,
  },
  "main-tsx": {
    mediaType: "text/typescript",
    content: `import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "./App"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
`,
  },
  "file-browser-page": {
    mediaType: "text/typescript",
    content: `import * as React from "react"

import { RichFilePreview } from "@/features/files"

export function FileBrowserPage() {
  const [selectedItemId, setSelectedItemId] = React.useState("README.md")

  return (
    <main className="flex min-h-0 flex-1">
      <FileBrowserTree onItemSelect={setSelectedItemId} />
      <RichFilePreview file={selectedItemId} />
    </main>
  )
}
`,
  },
  "file-browser-data": {
    mediaType: "text/typescript",
    content: `export type FileBrowserItem = {
  name: string
  type: "file" | "folder"
  children?: string[]
}

export const FILE_BROWSER_ROOT_ID = "root"
`,
  },
  "app-sidebar-tsx": {
    mediaType: "text/typescript",
    content: `export function AppSidebar() {
  return <Sidebar collapsible="icon" resizable />
}
`,
  },
  "canvas-shell-tsx": {
    mediaType: "text/typescript",
    content: `export function CanvasShell({ children }) {
  return (
    <SidebarProvider>
      <SidebarInset>{children}</SidebarInset>
      <CanvasSidebar />
    </SidebarProvider>
  )
}
`,
  },
  "vite-svg": {
    mediaType: "image/svg+xml",
    renderKind: "image",
    renderSource: "/vite.svg",
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 410 404">
  <path fill="url(#paint0_linear)" d="M399.641 59.524..." />
</svg>
`,
  },
  "agent-runner-ts": {
    mediaType: "text/typescript",
    content: `export async function runAgent(input: string) {
  return {
    input,
    status: "ready",
  }
}
`,
  },
  "agent-package-json": {
    mediaType: "application/json",
    renderKind: "json",
    content: `{
  "name": "agent-ui",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "oxlint ."
  }
}
`,
  },
  "vite-config": {
    mediaType: "text/typescript",
    content: `import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
`,
  },
  "tsconfig-json": {
    mediaType: "application/json",
    renderKind: "json",
    content: `{
  "compilerOptions": {
    "strict": true,
    "jsx": "react-jsx",
    "moduleResolution": "Bundler"
  },
  "include": ["src"]
}
`,
  },
  dockerfile: {
    mediaType: "text/plain",
    content: `FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
`,
  },
  "package-json": {
    mediaType: "application/json",
    renderKind: "json",
    content: `{
  "name": "priva-harness",
  "private": true,
  "workspaces": [
    "agent-ui",
    "services/agent-runner/ts"
  ]
}
`,
  },
  readme: {
    mediaType: "text/markdown",
    renderKind: "markdown",
    content: `# Priva Harness

An Agent Harness frontend for conversations, projects, tools, and reusable Canvas workflows.

## Workspace

- **Agent chat** coordinates with projects and Canvas content.
- **File browser** supports path navigation and reusable rich previews.
- **Canvas** keeps task, file, terminal, and artifact views close to the active session.
`,
  },
  license: {
    mediaType: "text/plain",
    content: `MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files to deal in the Software
without restriction.
`,
  },
}

export function getFileBrowserPreviewFile(
  itemId: string
): PreviewFile | null {
  const item = fileBrowserItems[itemId]
  const preview = previewRecords[itemId]

  if (!item || item.type !== "file" || !preview) {
    return null
  }

  const path = getFileBrowserPath(itemId)
    .map((pathItemId) => fileBrowserItems[pathItemId].name)
    .join("/")

  return {
    id: itemId,
    name: item.name,
    path,
    ...preview,
  }
}
