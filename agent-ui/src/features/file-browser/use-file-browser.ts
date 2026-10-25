import * as React from "react"

import type { PreviewFile } from "@/features/files"
import { useUploadQueue } from "@/features/uploads/upload-queue-context"

import {
  createDirectory,
  deletePath as requestPathDeletion,
  listDirectory,
  previewFile,
  type FileSystemDirectory,
} from "@/lib/api/sandbox-files"
import {
  emptyFileBrowserModel,
  getFileBrowserBreadcrumb,
  getFileBrowserParentPath,
  getFileBrowserPathName,
  isSameOrDescendantPath,
  mergeDirectoryListing,
  previewResponseToFile,
  removeFileBrowserPath,
  revealFileBrowserDirectory,
  type FileBrowserItem,
  type FileBrowserModel,
} from "./file-browser-data"

const INITIAL_DIRECTORY_REQUEST = "__initial_directory_request__"

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useFileBrowser() {
  const { enqueueFiles } = useUploadQueue()
  const [model, setModel] = React.useState<FileBrowserModel>(
    emptyFileBrowserModel
  )
  const modelRef = React.useRef(model)
  const [rootPath, setRootPath] = React.useState<string | null>(null)
  const workspaceRootRef = React.useRef<string | null>(null)
  const [selectedItemPath, setSelectedItemPath] = React.useState<
    string | null
  >(null)
  const [openedFiles, setOpenedFiles] = React.useState<PreviewFile[]>([])
  const openedFilesRef = React.useRef(openedFiles)
  React.useLayoutEffect(() => { openedFilesRef.current = openedFiles }, [openedFiles])
  const [activeFileId, setActiveFileId] = React.useState<string | null>(null)
  const [loadingDirectories, setLoadingDirectories] = React.useState(
    () => new Set<string>()
  )
  const [initialError, setInitialError] = React.useState<string | null>(null)
  const [initialLoading, setInitialLoading] = React.useState(true)
  const directoryRequestsRef = React.useRef(
    new Map<string, Promise<FileSystemDirectory>>()
  )
  const directoryGenerationRef = React.useRef(new Map<string, number>())
  const previewRequestsRef = React.useRef(new Map<string, Promise<void>>())
  const navigationGenerationRef = React.useRef(0)

  const updateModel = React.useCallback(
    (updater: (currentModel: FileBrowserModel) => FileBrowserModel) => {
      setModel((currentModel) => {
        const nextModel = updater(currentModel)
        modelRef.current = nextModel
        return nextModel
      })
    },
    []
  )

  const loadDirectory = React.useCallback(
    (
      requestedPath?: string,
      attachedPath?: string,
      options: { force?: boolean } = {}
    ) => {
      const requestPath = requestedPath ?? INITIAL_DIRECTORY_REQUEST
      const modelPath = attachedPath ?? requestedPath ?? ""
      const requestKey = `${requestPath}\u0000${modelPath}`

      if (options.force) {
        directoryGenerationRef.current.set(
          requestKey,
          (directoryGenerationRef.current.get(requestKey) ?? 0) + 1
        )
      } else {
        const pendingRequest = directoryRequestsRef.current.get(requestKey)
        if (pendingRequest) {
          return pendingRequest
        }
      }

      const generation = directoryGenerationRef.current.get(requestKey) ?? 0

      setLoadingDirectories((currentPaths) => {
        const nextPaths = new Set(currentPaths)
        nextPaths.add(modelPath || INITIAL_DIRECTORY_REQUEST)
        return nextPaths
      })

      const request = listDirectory(requestedPath)
        .then((directory) => {
          if (
            (directoryGenerationRef.current.get(requestKey) ?? 0) !==
            generation
          ) {
            return directory
          }

          workspaceRootRef.current = directory.root
          setRootPath(directory.root)
          updateModel((currentModel) =>
            mergeDirectoryListing(
              currentModel,
              directory,
              attachedPath ?? directory.path
            )
          )
          return directory
        })
        .finally(() => {
          if (directoryRequestsRef.current.get(requestKey) !== request) {
            return
          }

          directoryRequestsRef.current.delete(requestKey)
          setLoadingDirectories((currentPaths) => {
            const nextPaths = new Set(currentPaths)
            nextPaths.delete(modelPath || INITIAL_DIRECTORY_REQUEST)
            return nextPaths
          })
        })

      directoryRequestsRef.current.set(requestKey, request)
      return request
    },
    [updateModel]
  )

  const loadInitialDirectory = React.useCallback(() => {
    setInitialLoading(true)
    setInitialError(null)

    return loadDirectory()
      .then((directory) => {
        setSelectedItemPath((current) => current ?? directory.path)
      })
      .catch((error: unknown) => {
        setInitialError(errorMessage(error))
      })
      .finally(() => setInitialLoading(false))
  }, [loadDirectory])

  React.useEffect(() => {
    void loadInitialDirectory()
  }, [loadInitialDirectory])

  const openFile = React.useCallback((
    item: FileBrowserItem,
    activate = true
  ) => {
    if (activate) {
      navigationGenerationRef.current += 1
      setSelectedItemPath(item.path)
      setActiveFileId(item.path)
    }

    setOpenedFiles((currentFiles) => {
      const existingFile = currentFiles.find((file) => file.id === item.path)
      if (existingFile?.status !== "error") {
        return existingFile
          ? currentFiles
          : [
              ...currentFiles,
              {
                id: item.path,
                path: item.path,
                name: item.name,
                mediaType: "application/octet-stream",
                status: "loading",
              },
            ]
      }

      return currentFiles.map((file) =>
        file.id === item.path
          ? { ...file, status: "loading", error: undefined, previewError: undefined }
          : file
      )
    })

    const pendingRequest = previewRequestsRef.current.get(item.path)
    if (pendingRequest) {
      return pendingRequest
    }

    const request = previewFile(item.path)
      .then((preview) => {
        const nextFile = previewResponseToFile(preview)
        setOpenedFiles((currentFiles) =>
          currentFiles.map((file) =>
            file.id === item.path ? nextFile : file
          )
        )
      })
      .catch((error: unknown) => {
        setOpenedFiles((currentFiles) =>
          currentFiles.map((file) =>
            file.id === item.path
              ? {
                  ...file,
                  status: "error",
                  error: errorMessage(error),
                }
              : file
          )
        )
      })
      .finally(() => previewRequestsRef.current.delete(item.path))

    previewRequestsRef.current.set(item.path, request)
    return request
  }, [])

  const openPath = React.useCallback(
    async (path: string) => {
      const navigation = ++navigationGenerationRef.current
      const parentPath = getFileBrowserParentPath(path)
      if (parentPath) {
        const workspaceRoot = workspaceRootRef.current ?? await loadDirectory()
          .then((directory) => directory.root)
          .catch(() => null)
        // A message can preview a file outside the workspace without loading
        // that file's parent directory into the bounded file tree.
        if (workspaceRoot && isSameOrDescendantPath(parentPath, workspaceRoot)) {
          await loadDirectory(parentPath, parentPath).catch(() => undefined)
        }
      }

      if (navigationGenerationRef.current !== navigation) return
      return openFile({
        path,
        name: getFileBrowserPathName(path),
        type: "file",
        size: null,
        modifiedAt: null,
        permissions: null,
        parentPath,
      })
    },
    [loadDirectory, openFile]
  )

  const selectItem = React.useCallback(
    async (path: string, shouldLoadDirectory = true) => {
      const item = modelRef.current.items[path]
      if (!item) {
        return
      }

      navigationGenerationRef.current += 1
      setSelectedItemPath(path)
      if (item.type === "file") {
        await openFile(item)
        return
      }

      if (
        !shouldLoadDirectory ||
        Object.hasOwn(modelRef.current.childrenByPath, path)
      ) {
        return
      }

      await loadDirectory(path, path)
    },
    [loadDirectory, openFile]
  )

  const goToDirectory = React.useCallback(
    async (path: string) => {
      const navigation = ++navigationGenerationRef.current
      try {
        const directory = await loadDirectory(path)
        if (navigationGenerationRef.current !== navigation) return false
        updateModel((current) => revealFileBrowserDirectory(current, directory.path, directory.root))
        const ancestors = getFileBrowserBreadcrumb(directory.path, directory.root).slice(0, -1)
        await Promise.all(ancestors.map((entry) => loadDirectory(entry.path)))
        if (navigationGenerationRef.current !== navigation) return false
        setSelectedItemPath(directory.path)
        return true
      } catch {
        return false
      }
    },
    [loadDirectory, updateModel]
  )

  const navigateBreadcrumb = React.useCallback(
    async (path: string, type: FileBrowserItem["type"]) => {
      if (type === "file") {
        const item = modelRef.current.items[path]
        if (item) {
          await openFile(item)
        }
        return
      }

      await goToDirectory(path)
    },
    [goToDirectory, openFile]
  )

  const refreshDirectory = React.useCallback(
    async (path: string) => {
      await loadDirectory(path, path, { force: true })
    },
    [loadDirectory]
  )

  const refreshLoadedDirectories = React.useCallback(async () => {
    const loadedPaths = Object.keys(modelRef.current.childrenByPath).filter(
      (path) => path !== "__file_browser_root__"
    )

    await Promise.all(
      loadedPaths.map((path) => loadDirectory(path, path, { force: true }))
    )
  }, [loadDirectory])

  const refreshOpenedFiles = React.useCallback(async () => {
    await Promise.all(openedFilesRef.current.map(async (file) => {
      // A preview started before checkout may still be reading the old file.
      // Let it finish, then read the current working tree without activating tabs.
      await previewRequestsRef.current.get(file.path)
      // A user can close this tab while its previous preview is still pending.
      if (!openedFilesRef.current.some((current) => current.id === file.id)) return
      await openFile({
        path: file.path,
        name: file.name,
        type: "file",
        size: null,
        modifiedAt: null,
        permissions: null,
        parentPath: getFileBrowserParentPath(file.path),
      }, false)
    }))
  }, [openFile])

  const makeDirectory = React.useCallback(
    async (directory: string, name: string) => {
      const createdDirectory = await createDirectory(directory, name)
      await refreshDirectory(directory)
      return createdDirectory
    },
    [refreshDirectory]
  )

  const uploadFiles = React.useCallback(
    async (directory: string, files: File[]) => {
      const batch = enqueueFiles(directory, files)
      const result = await batch.completion

      if (result.succeeded > 0) {
        await refreshDirectory(directory)
      }

      return result
    },
    [enqueueFiles, refreshDirectory]
  )

  const deleteItem = React.useCallback(
    async (item: FileBrowserItem) => {
      const parentPath = item.parentPath ?? getFileBrowserParentPath(item.path)

      await requestPathDeletion(item.path)
      updateModel((currentModel) =>
        removeFileBrowserPath(currentModel, item.path)
      )
      setOpenedFiles((currentFiles) =>
        currentFiles.filter(
          (file) => !isSameOrDescendantPath(file.path, item.path)
        )
      )
      setActiveFileId((currentFileId) =>
        currentFileId && isSameOrDescendantPath(currentFileId, item.path)
          ? null
          : currentFileId
      )

      const rootWasDeleted = Boolean(
        rootPath && isSameOrDescendantPath(rootPath, item.path)
      )
      const selectionWasDeleted = Boolean(
        selectedItemPath &&
          isSameOrDescendantPath(selectedItemPath, item.path)
      )

      if (rootWasDeleted) {
        await loadInitialDirectory()
      } else if (parentPath && modelRef.current.childrenByPath[parentPath]) {
        await refreshDirectory(parentPath)
      }

      if (selectionWasDeleted && !rootWasDeleted) {
        setSelectedItemPath(parentPath ?? rootPath)
      }
    },
    [
      loadInitialDirectory,
      refreshDirectory,
      rootPath,
      selectedItemPath,
      updateModel,
    ]
  )

  const setActiveFile = React.useCallback((fileId: string) => {
    navigationGenerationRef.current += 1
    setActiveFileId(fileId)
    setSelectedItemPath(fileId)
  }, [])

  const closeFile = React.useCallback(
    (fileId: string) => {
      setOpenedFiles((currentFiles) => {
        const fileIndex = currentFiles.findIndex((file) => file.id === fileId)
        if (fileIndex === -1) {
          return currentFiles
        }

        const adjacentFile =
          currentFiles[fileIndex + 1] ?? currentFiles[fileIndex - 1] ?? null

        setActiveFileId((currentFileId) => {
          if (currentFileId !== fileId) {
            return currentFileId
          }
          setSelectedItemPath(adjacentFile?.id ?? rootPath)
          return adjacentFile?.id ?? null
        })

        return currentFiles.filter((file) => file.id !== fileId)
      })
    },
    [rootPath]
  )

  const closeAllFiles = React.useCallback(() => {
    setOpenedFiles([])
    setActiveFileId(null)
    setSelectedItemPath(rootPath)
  }, [rootPath])

  const selectedItem = selectedItemPath
    ? model.items[selectedItemPath] ?? null
    : null
  const currentDirectory =
    selectedItem?.type === "folder"
      ? selectedItem.path
      : selectedItem?.parentPath ?? rootPath
  const breadcrumb = rootPath
    ? getFileBrowserBreadcrumb(selectedItem?.path ?? rootPath, rootPath, selectedItem?.type)
    : []

  return {
    activeFileId,
    breadcrumb,
    closeAllFiles,
    closeFile,
    currentDirectory,
    deleteItem,
    goToDirectory,
    initialError,
    initialLoading,
    loadInitialDirectory,
    loadingDirectories,
    makeDirectory,
    model,
    navigateBreadcrumb,
    openedFiles,
    openFile,
    openPath,
    refreshDirectory,
    refreshLoadedDirectories,
    refreshOpenedFiles,
    rootPath,
    selectItem,
    selectedItem,
    selectedItemPath,
    setActiveFile,
    uploadFiles,
  }
}
