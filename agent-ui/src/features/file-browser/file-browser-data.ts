export type FileBrowserItem = {
  name: string
  type: "file" | "folder"
  children?: string[]
}

export type FileBrowserItemMetadata = {
  modifiedAt: string
  size?: number
}

export const FILE_BROWSER_ROOT_ID = "root"

export const FILE_BROWSER_DEFAULT_ITEM_ID = "file-browser-page"

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

const fileBrowserFileSizes: Record<string, number> = {
  "app-tsx": 6842,
  "index-css": 4891,
  "main-tsx": 516,
  "file-browser-page": 9826,
  "file-browser-data": 4184,
  "app-sidebar-tsx": 1734,
  "canvas-shell-tsx": 3218,
  "vite-svg": 1497,
  "agent-runner-ts": 3672,
  "agent-package-json": 1248,
  "vite-config": 482,
  "tsconfig-json": 736,
  dockerfile: 524,
  "package-json": 891,
  readme: 2864,
  license: 1072,
}

const metadataItemIds = Object.keys(fileBrowserItems).filter(
  (itemId) => itemId !== FILE_BROWSER_ROOT_ID
)
const metadataBaseTime = Date.parse("2026-08-17T06:30:00.000Z")

export const fileBrowserItemMetadata = Object.fromEntries(
  metadataItemIds.map((itemId, index) => [
    itemId,
    {
      modifiedAt: new Date(
        metadataBaseTime - index * 37 * 60 * 1000
      ).toISOString(),
      size: fileBrowserFileSizes[itemId],
    },
  ])
) as Record<string, FileBrowserItemMetadata>

const fileBrowserParentIds = Object.entries(fileBrowserItems).reduce<
  Record<string, string>
>((parentIds, [parentId, item]) => {
  item.children?.forEach((childId) => {
    parentIds[childId] = parentId
  })

  return parentIds
}, {})

export function getFileBrowserPath(itemId: string) {
  const path: string[] = []
  let currentId: string | undefined = itemId

  while (currentId && currentId !== FILE_BROWSER_ROOT_ID) {
    path.unshift(currentId)
    currentId = fileBrowserParentIds[currentId]
  }

  return path
}

export function getFileBrowserChildFolderIds(itemId: string) {
  return (fileBrowserItems[itemId]?.children ?? []).filter(
    (childId) => fileBrowserItems[childId]?.type === "folder"
  )
}

export function findFileBrowserFolderIdByPath(path: string) {
  const workspaceId = fileBrowserItems[FILE_BROWSER_ROOT_ID].children?.find(
    (itemId) => fileBrowserItems[itemId]?.type === "folder"
  )

  if (!workspaceId) {
    return null
  }

  const segments = path
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== ".")

  if (
    segments[0]?.toLocaleLowerCase() ===
    fileBrowserItems[workspaceId].name.toLocaleLowerCase()
  ) {
    segments.shift()
  }

  let currentId = workspaceId

  for (const segment of segments) {
    if (segment === "..") {
      return null
    }

    const childFolderId = (
      fileBrowserItems[currentId].children ?? []
    ).find(
      (itemId) =>
        fileBrowserItems[itemId]?.type === "folder" &&
        fileBrowserItems[itemId].name.toLocaleLowerCase() ===
          segment.toLocaleLowerCase()
    )

    if (!childFolderId) {
      return null
    }

    currentId = childFolderId
  }

  return currentId
}
