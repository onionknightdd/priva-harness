"use client"

import * as React from "react"

import { uploadFile, type UploadFileOptions } from "@/lib/api/sandbox-files"

import {
  UploadQueueContext,
  type UploadQueueContextValue,
} from "./upload-queue-context"
import { UploadQueueFloatingPanel } from "./upload-queue-floating-panel"
import type {
  UploadBatchHandle,
  UploadBatchOptions,
  UploadBatchResult,
  UploadTask,
  UploadResult,
} from "./upload.types"

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : String(error)
}

function summarizeBatch(results: UploadResult[]): UploadBatchResult {
  return {
    results,
    total: results.length,
    succeeded: results.filter(({ status }) => status === "succeeded").length,
    failed: results.filter(({ status }) => status === "failed").length,
    canceled: results.filter(({ status }) => status === "canceled").length,
  }
}

export function UploadQueueProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [tasks, setTasks] = React.useState<UploadTask[]>([])
  const controllersRef = React.useRef(new Map<string, AbortController>())
  const nextTaskIdRef = React.useRef(0)

  const updateTask = React.useCallback(
    (taskId: string, patch: Partial<UploadTask>) => {
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === taskId ? { ...task, ...patch } : task
        )
      )
    },
    []
  )

  const runUpload = React.useCallback(
    async (task: UploadTask, file: File, controller: AbortController, options: UploadFileOptions): Promise<UploadResult> => {
      try {
        const uploaded = await uploadFile(task.directory, file, {
          ...options,
          signal: controller.signal,
          onProgress: (progress) => {
            updateTask(task.id, { progress })
            options.onProgress?.(progress)
          },
        })
        updateTask(task.id, { progress: 100, status: "succeeded" })
        return { status: "succeeded", file: uploaded }
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          updateTask(task.id, { status: "canceled" })
          return { status: "canceled" }
        }

        updateTask(task.id, {
          status: "failed",
          error: getErrorMessage(error),
        })
        return { status: "failed", error: getErrorMessage(error) }
      } finally {
        controllersRef.current.delete(task.id)
      }
    },
    [updateTask]
  )

  const enqueueFiles = React.useCallback(
    (directory: string, files: File[], options: UploadBatchOptions = {}): UploadBatchHandle => {
      const nextTasks = files.map<UploadTask>((file) => ({
        id: `${Date.now()}-${nextTaskIdRef.current++}`,
        directory,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        progress: 0,
        status: "uploading",
      }))

      setTasks((currentTasks) => [...currentTasks, ...nextTasks])

      const uploads = nextTasks.map((task, index) => {
        const controller = new AbortController()
        controllersRef.current.set(task.id, controller)
        return runUpload(task, files[index], controller, {
          purpose: options.purpose,
          onProgress: (progress) => options.onProgress?.(index, progress),
        })
      })

      return {
        cancel: () => nextTasks.forEach((task) => controllersRef.current.get(task.id)?.abort()),
        taskIds: nextTasks.map((task) => task.id),
        completion: Promise.all(uploads).then(summarizeBatch),
      }
    },
    [runUpload]
  )

  const cancelTask = React.useCallback((taskId: string) => {
    controllersRef.current.get(taskId)?.abort()
  }, [])

  const removeTask = React.useCallback((taskId: string) => {
    setTasks((currentTasks) =>
      currentTasks.filter(
        (task) => task.id !== taskId || task.status === "uploading"
      )
    )
  }, [])

  const clearFinishedTasks = React.useCallback(() => {
    setTasks((currentTasks) =>
      currentTasks.filter((task) => task.status === "uploading")
    )
  }, [])

  React.useEffect(
    () => () => {
      controllersRef.current.forEach((controller) => controller.abort())
      controllersRef.current.clear()
    },
    []
  )

  const contextValue = React.useMemo<UploadQueueContextValue>(
    () => ({ enqueueFiles }),
    [enqueueFiles]
  )

  return (
    <UploadQueueContext.Provider value={contextValue}>
      {children}
      <UploadQueueFloatingPanel
        tasks={tasks}
        onCancelTask={cancelTask}
        onClearFinishedTasks={clearFinishedTasks}
        onRemoveTask={removeTask}
      />
    </UploadQueueContext.Provider>
  )
}
