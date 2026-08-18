import type {
  FileRenderKind,
  PreviewFile,
} from "@/features/files"

import type {
  FilePreviewResponse,
  FileSystemDirectory,
  FileSystemEntry,
} from "./file-browser-api"
import { getDownloadUrl } from "./file-browser-api"

export type FileBrowserItem = {
  path: string
  name: string
  type: "file" | "folder"
  size: number | null
  modifiedAt: number | null
  permissions: string | null
  parentPath: string | null
}

export type FileBrowserModel = {
  items: Record<string, FileBrowserItem>
  childrenByPath: Record<string, string[]>
}

export type FileBrowserBreadcrumbEntry = {
  path: string
  name: string
  type: "file" | "folder"
}

export const FILE_BROWSER_ROOT_ID = "__file_browser_root__"

export const emptyFileBrowserModel: FileBrowserModel = {
  items: {
    [FILE_BROWSER_ROOT_ID]: {
      path: FILE_BROWSER_ROOT_ID,
      name: "Root",
      type: "folder",
      size: null,
      modifiedAt: null,
      permissions: null,
      parentPath: null,
    },
  },
  childrenByPath: {
    [FILE_BROWSER_ROOT_ID]: [],
  },
}

export function mergeDirectoryListing(
  model: FileBrowserModel,
  directory: FileSystemDirectory,
  attachedPath = directory.path
): FileBrowserModel {
  const items = { ...model.items }
  const childrenByPath = { ...model.childrenByPath }
  const nextChildPaths = directory.entries.map((entry) => entry.path)
  const nextChildPathSet = new Set(nextChildPaths)

  for (const previousChildPath of childrenByPath[attachedPath] ?? []) {
    if (!nextChildPathSet.has(previousChildPath)) {
      removePathFromModel(items, childrenByPath, previousChildPath)
    }
  }

  const previousDirectory = items[attachedPath]
  items[attachedPath] = {
    path: attachedPath,
    name: getFileBrowserPathName(attachedPath),
    type: "folder",
    size: null,
    modifiedAt: previousDirectory?.modifiedAt ?? null,
    permissions: previousDirectory?.permissions ?? null,
    parentPath:
      attachedPath === directory.path
        ? directory.parent
        : getFileBrowserParentPath(attachedPath),
  }

  for (const entry of directory.entries) {
    const previousItem = items[entry.path]
    items[entry.path] = toFileBrowserItem(entry, directory.path)

    if (entry.type === "file" && previousItem?.type === "folder") {
      removeDescendantsFromModel(items, childrenByPath, entry.path)
    }
  }

  childrenByPath[attachedPath] = nextChildPaths

  return { items, childrenByPath }
}

export function removeFileBrowserPath(
  model: FileBrowserModel,
  path: string
): FileBrowserModel {
  const items = { ...model.items }
  const childrenByPath = { ...model.childrenByPath }

  removePathFromModel(items, childrenByPath, path)

  for (const [parentPath, childPaths] of Object.entries(childrenByPath)) {
    if (childPaths.includes(path)) {
      childrenByPath[parentPath] = childPaths.filter(
        (childPath) => childPath !== path
      )
    }
  }

  return { items, childrenByPath }
}

export function getFileBrowserBreadcrumb(
  path: string,
  selectedType: FileBrowserItem["type"] = "folder"
): FileBrowserBreadcrumbEntry[] {
  const normalizedPath = normalizeFileBrowserPath(path)
  const isWindowsPath = /^[A-Za-z]:\//.test(normalizedPath)
  const entries: FileBrowserBreadcrumbEntry[] = []

  if (isWindowsPath) {
    const driveRoot = normalizedPath.slice(0, 3)
    entries.push({
      path: driveRoot,
      name: driveRoot.slice(0, 2),
      type: "folder",
    })

    let currentPath = driveRoot.slice(0, -1)
    for (const segment of normalizedPath.slice(3).split("/").filter(Boolean)) {
      currentPath = `${currentPath}/${segment}`
      entries.push({ path: currentPath, name: segment, type: "folder" })
    }
  } else if (normalizedPath.startsWith("/")) {
    entries.push({ path: "/", name: "/", type: "folder" })

    let currentPath = ""
    for (const segment of normalizedPath.split("/").filter(Boolean)) {
      currentPath = `${currentPath}/${segment}`
      entries.push({ path: currentPath, name: segment, type: "folder" })
    }
  } else {
    let currentPath = ""
    for (const segment of normalizedPath.split("/").filter(Boolean)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      entries.push({ path: currentPath, name: segment, type: "folder" })
    }
  }

  const lastEntry = entries.at(-1)
  if (lastEntry) {
    lastEntry.type = selectedType
  }

  return entries
}

export function getFileBrowserAncestorPaths(
  items: Record<string, FileBrowserItem>,
  path: string,
  stopAtPath?: string
) {
  const ancestors: string[] = []
  let parentPath = items[path]?.parentPath ?? getFileBrowserParentPath(path)

  while (parentPath) {
    ancestors.unshift(parentPath)
    if (parentPath === stopAtPath) {
      break
    }
    parentPath =
      items[parentPath]?.parentPath ?? getFileBrowserParentPath(parentPath)
  }

  return ancestors
}

export function getFileBrowserChildFolders(
  model: FileBrowserModel,
  path: string
) {
  return (model.childrenByPath[path] ?? [])
    .map((childPath) => model.items[childPath])
    .filter(
      (item): item is FileBrowserItem => item?.type === "folder"
    )
}

export function countFileBrowserTreeItems(
  model: FileBrowserModel,
  rootPath: string | null
) {
  if (!rootPath || !model.items[rootPath]) {
    return 0
  }

  const pendingPaths = [rootPath]
  const visitedPaths = new Set<string>()

  while (pendingPaths.length > 0) {
    const path = pendingPaths.pop()
    if (!path || visitedPaths.has(path) || !model.items[path]) {
      continue
    }

    visitedPaths.add(path)
    pendingPaths.push(...(model.childrenByPath[path] ?? []))
  }

  return visitedPaths.size
}

export function getFileBrowserParentPath(path: string) {
  const normalizedPath = normalizeFileBrowserPath(path)

  if (normalizedPath === "/" || /^[A-Za-z]:\/$/.test(normalizedPath)) {
    return null
  }

  const separatorIndex = normalizedPath.lastIndexOf("/")
  if (separatorIndex < 0) {
    return null
  }
  if (separatorIndex === 0) {
    return "/"
  }
  if (separatorIndex === 2 && /^[A-Za-z]:/.test(normalizedPath)) {
    return `${normalizedPath.slice(0, 2)}/`
  }

  return normalizedPath.slice(0, separatorIndex)
}

export function getFileBrowserPathName(path: string) {
  const normalizedPath = normalizeFileBrowserPath(path)

  if (normalizedPath === "/") {
    return "/"
  }
  if (/^[A-Za-z]:\/$/.test(normalizedPath)) {
    return normalizedPath.slice(0, 2)
  }

  return normalizedPath.split("/").at(-1) || normalizedPath
}

export function isSameOrDescendantPath(path: string, ancestorPath: string) {
  const candidate = comparablePath(path)
  const ancestor = comparablePath(ancestorPath)
  const ancestorPrefix = ancestor.endsWith("/")
    ? ancestor
    : `${ancestor}/`

  return candidate === ancestor || candidate.startsWith(ancestorPrefix)
}

export function previewResponseToFile(
  preview: FilePreviewResponse
): PreviewFile {
  const renderKind = getFileRenderKind(preview)
  const needsBinarySource =
    renderKind === "document" ||
    renderKind === "image" ||
    renderKind === "pdf" ||
    renderKind === "presentation" ||
    renderKind === "spreadsheet"

  return {
    id: preview.path,
    path: preview.path,
    name: preview.name,
    mediaType: preview.mime_type,
    content: preview.content ?? undefined,
    renderKind,
    renderSource: needsBinarySource
      ? preview.preview_url ?? getDownloadUrl(preview.path)
      : undefined,
    status: "ready",
  }
}

function toFileBrowserItem(
  entry: FileSystemEntry,
  parentPath: string
): FileBrowserItem {
  return {
    path: entry.path,
    name: entry.name,
    type: entry.type === "directory" ? "folder" : "file",
    size: entry.size,
    modifiedAt: entry.modified,
    permissions: entry.permissions,
    parentPath,
  }
}

function getFileRenderKind(
  preview: FilePreviewResponse
): FileRenderKind | undefined {
  const extension = preview.name.split(".").at(-1)?.toLocaleLowerCase()
  const mediaType = preview.mime_type.toLocaleLowerCase()

  if (
    mediaType === "application/pdf" ||
    extension === "pdf"
  ) {
    return "pdf"
  }
  if (
    mediaType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mediaType ===
      "application/vnd.ms-excel.sheet.macroenabled.12" ||
    ["xlsx", "xlsm", "xltx", "xltm"].includes(extension ?? "")
  ) {
    return "spreadsheet"
  }
  if (
    mediaType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ["docx", "dotx"].includes(extension ?? "")
  ) {
    return "document"
  }
  if (
    mediaType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    ["pptx", "ppsx", "potx"].includes(extension ?? "")
  ) {
    return "presentation"
  }
  if (preview.preview_url && mediaType.startsWith("image/")) {
    return "image"
  }
  if (
    mediaType === "text/html" ||
    mediaType === "application/xhtml+xml" ||
    ["html", "htm", "xhtml"].includes(extension ?? "")
  ) {
    return "html"
  }
  if (
    mediaType === "text/markdown" ||
    ["md", "markdown", "mdown", "mdx", "mkd"].includes(extension ?? "")
  ) {
    return "markdown"
  }
  if (
    mediaType === "application/json" ||
    mediaType.endsWith("+json") ||
    extension === "json"
  ) {
    return "json"
  }

  return undefined
}

function removePathFromModel(
  items: Record<string, FileBrowserItem>,
  childrenByPath: Record<string, string[]>,
  path: string
) {
  delete items[path]
  removeDescendantsFromModel(items, childrenByPath, path)
}

function removeDescendantsFromModel(
  items: Record<string, FileBrowserItem>,
  childrenByPath: Record<string, string[]>,
  path: string
) {
  for (const childPath of childrenByPath[path] ?? []) {
    removePathFromModel(items, childrenByPath, childPath)
  }
  delete childrenByPath[path]
}

function normalizeFileBrowserPath(path: string) {
  const normalizedPath = path.replaceAll("\\", "/").replace(/\/{2,}/g, "/")

  if (normalizedPath === "/" || /^[A-Za-z]:\/$/.test(normalizedPath)) {
    return normalizedPath
  }

  return normalizedPath.replace(/\/$/, "")
}

function comparablePath(path: string) {
  const normalizedPath = normalizeFileBrowserPath(path)
  return /^[A-Za-z]:\//.test(normalizedPath)
    ? normalizedPath.toLocaleLowerCase()
    : normalizedPath
}
