export type FileBrowserItem = {
  name: string
  type: "file" | "folder"
  children?: string[]
}

export const FILE_BROWSER_ROOT_ID = "root"

export const FILE_BROWSER_INITIAL_EXPANDED_ITEMS = [
  "workspace",
  "agent-ui",
  "agent-ui-src",
]

export const fileBrowserItems: Record<string, FileBrowserItem> = {
  root: {
    name: "Root",
    type: "folder",
    children: ["workspace"],
  },
  workspace: {
    name: "priva-harness",
    type: "folder",
    children: [
      "agent-ui",
      "services",
      "dockerfile",
      "package-json",
      "readme",
      "license",
    ],
  },
  "agent-ui": {
    name: "agent-ui",
    type: "folder",
    children: [
      "agent-ui-src",
      "agent-ui-public",
      "agent-package-json",
      "vite-config",
      "tsconfig-json",
    ],
  },
  "agent-ui-src": {
    name: "src",
    type: "folder",
    children: [
      "app-tsx",
      "index-css",
      "main-tsx",
      "features-folder",
      "components-folder",
    ],
  },
  "features-folder": {
    name: "features",
    type: "folder",
    children: ["file-browser-folder"],
  },
  "file-browser-folder": {
    name: "file-browser",
    type: "folder",
    children: ["file-browser-page", "file-browser-data"],
  },
  "components-folder": {
    name: "components",
    type: "folder",
    children: ["sidebar-folder", "canvas-folder"],
  },
  "sidebar-folder": {
    name: "sidebar",
    type: "folder",
    children: ["app-sidebar-tsx"],
  },
  "canvas-folder": {
    name: "canvas",
    type: "folder",
    children: ["canvas-shell-tsx"],
  },
  "agent-ui-public": {
    name: "public",
    type: "folder",
    children: ["vite-svg"],
  },
  services: {
    name: "services",
    type: "folder",
    children: ["agent-runner-folder"],
  },
  "agent-runner-folder": {
    name: "agent-runner",
    type: "folder",
    children: ["agent-runner-ts"],
  },
  "app-tsx": { name: "App.tsx", type: "file" },
  "index-css": { name: "index.css", type: "file" },
  "main-tsx": { name: "main.tsx", type: "file" },
  "file-browser-page": {
    name: "file-browser-page.tsx",
    type: "file",
  },
  "file-browser-data": {
    name: "file-browser-data.ts",
    type: "file",
  },
  "app-sidebar-tsx": { name: "app-sidebar.tsx", type: "file" },
  "canvas-shell-tsx": { name: "canvas-shell.tsx", type: "file" },
  "vite-svg": { name: "vite.svg", type: "file" },
  "agent-runner-ts": { name: "runner.ts", type: "file" },
  "agent-package-json": { name: "package.json", type: "file" },
  "vite-config": { name: "vite.config.ts", type: "file" },
  "tsconfig-json": { name: "tsconfig.json", type: "file" },
  dockerfile: { name: "Dockerfile", type: "file" },
  "package-json": { name: "package.json", type: "file" },
  readme: { name: "README.md", type: "file" },
  license: { name: "LICENSE", type: "file" },
}

export const fileBrowserItemCount = Object.keys(fileBrowserItems).length - 1
