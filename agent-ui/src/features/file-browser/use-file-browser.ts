import * as React from "react"

import type { PreviewFile } from "@/features/files"
import { useUploadQueue } from "@/features/uploads"

import {
  createDirectory,
  deletePath as requestPathDeletion,
  listDirectory,
  previewFile,
  type FileSystemDirectory,
} from "./file-browser-api"
import {
  emptyFileBrowserModel,
  getFileBrowserBreadcrumb,
  getFileBrowserParentPath,
  isSameOrDescendantPath,
  mergeDirectoryListing,
  previewResponseToFile,
  removeFileBrowserPath,
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
  const [selectedItemPath, setSelectedItemPath] = React.useState<
    string | null
  >(null)
  const [openedFiles, setOpenedFiles] = React.useState<PreviewFile[]>([])
  const [activeFileId, setActiveFileId] = React.useState<string | null>(null)
  const [loadingDirectories, setLoadingDirectories] = React.useState(
    () => new Set<string>()
  )
  const [initialError, setInitialError] = React.useState<string | null>(null)
  const [initialLoading, setInitialLoading] = React.useState(true)
  const directoryRequestsRef = React.useRef(
    new Map<string, Promise<FileSystemDirectory>>()
  )
  const previewRequestsRef = React.useRef(new Map<string, Promise<void>>())

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
    (requestedPath?: string, attachedPath?: string) => {
      const requestPath = requestedPath ?? INITIAL_DIRECTORY_REQUEST
      const modelPath = attachedPath ?? requestedPath ?? ""
      const requestKey = `${requestPath}\u0000${modelPath}`
      const pendingRequest = directoryRequestsRef.current.get(requestKey)

      if (pendingRequest) {
        return pendingRequest
      }

      setLoadingDirectories((currentPaths) => {
        const nextPaths = new Set(currentPaths)
        nextPaths.add(modelPath || INITIAL_DIRECTORY_REQUEST)
        return nextPaths
      })

      const request = listDirectory(requestedPath)
        .then((directory) => {
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
        setRootPath(directory.path)
        setSelectedItemPath(directory.path)
      })
      .catch((error: unknown) => {
        setInitialError(errorMessage(error))
      })
      .finally(() => setInitialLoading(false))
  }, [loadDirectory])

  React.useEffect(() => {
    void loadInitialDirectory()
  }, [loadInitialDirectory])

  const openFile = React.useCallback((item: FileBrowserItem) => {
    setSelectedItemPath(item.path)
    setActiveFileId(item.path)
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
          ? { ...file, status: "loading", error: undefined }
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

  const selectItem = React.useCallback(
    async (path: string, shouldLoadDirectory = true) => {
      const item = modelRef.current.items[path]
      if (!item) {
        return
      }

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
      try {
        const directory = await loadDirectory(path)
        setRootPath(directory.path)
        setSelectedItemPath(directory.path)
        return true
      } catch {
        return false
      }
    },
    [loadDirectory]
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
      await loadDirectory(path, path)
    },
    [loadDirectory]
  )

  const refreshLoadedDirectories = React.useCallback(async () => {
    const loadedPaths = Object.keys(modelRef.current.childrenByPath).filter(
      (path) => path !== "__file_browser_root__"
    )

    await Promise.all(
      loadedPaths.map((path) => loadDirectory(path, path))
    )
  }, [loadDirectory])

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

      if (rootWasDeleted && parentPath) {
        await goToDirectory(parentPath)
      } else if (parentPath && modelRef.current.childrenByPath[parentPath]) {
        await refreshDirectory(parentPath)
      }

      if (selectionWasDeleted && !rootWasDeleted) {
        setSelectedItemPath(parentPath ?? rootPath)
      }
    },
    [
      goToDirectory,
      refreshDirectory,
      rootPath,
      selectedItemPath,
      updateModel,
    ]
  )

  const setActiveFile = React.useCallback((fileId: string) => {
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
  const breadcrumb = selectedItem
    ? getFileBrowserBreadcrumb(selectedItem.path, selectedItem.type)
    : rootPath
      ? getFileBrowserBreadcrumb(rootPath)
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
    refreshLoadedDirectories,
    rootPath,
    selectItem,
    selectedItem,
    selectedItemPath,
    setActiveFile,
    uploadFiles,
  }
}
