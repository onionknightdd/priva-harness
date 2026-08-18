"use client"

import * as React from "react"
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  FileIconDisplay,
  FileName,
  FileRoot,
  FileSize,
} from "@/components/assistant-ui/file"
import { buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

import type { UploadTask } from "./upload.types"

function taskFillClass(task: UploadTask) {
  switch (task.status) {
    case "succeeded":
      return "bg-emerald-500/18 dark:bg-emerald-400/24"
    case "failed":
      return "bg-destructive/14 dark:bg-destructive/28"
    case "canceled":
      return "bg-muted-foreground/10 dark:bg-muted-foreground/18"
    case "uploading":
      return "bg-primary/12 dark:bg-primary/24"
  }
}

function UploadTaskCard({
  task,
  onCancel,
  onRemove,
}: {
  task: UploadTask
  onCancel: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const percentage = Math.round(task.progress)
  const isUploading = task.status === "uploading"
  const canRemove = task.status === "failed" || task.status === "canceled"
  const statusLabel = isUploading
    ? t("uploadQueue.percentage", { percentage })
    : t(`uploadQueue.status.${task.status}`)

  return (
    <motion.li
      layout
      initial={reducedMotion ? false : { opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? undefined : { opacity: 0, x: 12, scale: 0.98 }}
      transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}
    >
      <FileRoot
        variant="outline"
        size="sm"
        className="relative isolate w-full overflow-hidden bg-popover py-2.5"
      >
        <motion.span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 z-0 origin-left",
            taskFillClass(task)
          )}
          initial={false}
          animate={{ scaleX: task.progress / 100 }}
          transition={{ duration: reducedMotion ? 0 : 0.2, ease: "easeOut" }}
        />

        <FileIconDisplay
          mimeType={task.mimeType}
          className="relative z-10"
        />
        <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-0.5">
          <FileName title={task.fileName}>{task.fileName}</FileName>
          <div className="flex min-w-0 items-center gap-2">
            <FileSize bytes={task.size} className="text-[11px]" />
            {task.error && (
              <span
                className="truncate text-[11px] text-destructive"
                title={task.error}
              >
                {task.error}
              </span>
            )}
          </div>
        </div>

        <div className="relative z-10 flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "min-w-10 text-right text-xs font-medium tabular-nums",
              task.status === "failed" && "text-destructive",
              task.status === "canceled" && "text-muted-foreground",
              task.status === "succeeded" &&
                "text-emerald-700 dark:text-emerald-300"
            )}
          >
            {statusLabel}
          </span>

          {task.status === "succeeded" && (
            <CheckCircle2Icon
              aria-hidden="true"
              className="size-4 text-emerald-700 dark:text-emerald-300"
            />
          )}

          {(isUploading || canRemove) && (
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label={t(
                isUploading
                  ? "uploadQueue.cancelFile"
                  : "uploadQueue.removeFile",
                { fileName: task.fileName }
              )}
              title={t(
                isUploading
                  ? "uploadQueue.cancelFile"
                  : "uploadQueue.removeFile",
                { fileName: task.fileName }
              )}
              onClick={isUploading ? onCancel : onRemove}
            >
              <XIcon aria-hidden="true" className="size-3.5" />
            </button>
          )}
        </div>
      </FileRoot>
    </motion.li>
  )
}

export function UploadQueueFloatingPanel({
  tasks,
  onCancelTask,
  onClearFinishedTasks,
  onRemoveTask,
}: {
  tasks: UploadTask[]
  onCancelTask: (taskId: string) => void
  onClearFinishedTasks: () => void
  onRemoveTask: (taskId: string) => void
}) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const constraintsRef = React.useRef<HTMLDivElement>(null)
  const draggedRef = React.useRef(false)
  const successWasViewedRef = React.useRef(false)
  const [open, setOpen] = React.useState(false)
  const activeCount = tasks.filter((task) => task.status === "uploading").length
  const completedCount = tasks.filter(
    (task) => task.status !== "uploading"
  ).length
  const allSucceeded =
    tasks.length > 0 && tasks.every((task) => task.status === "succeeded")
  const hasFailure = tasks.some(
    (task) => task.status === "failed" || task.status === "canceled"
  )

  React.useEffect(() => {
    if (!allSucceeded) {
      successWasViewedRef.current = false
      return
    }

    if (open) {
      successWasViewedRef.current = true
    }
  }, [allSucceeded, open])

  React.useEffect(() => {
    if (tasks.length === 0) {
      setOpen(false)
    }
  }, [tasks.length])

  const handleOpenChange = (nextOpen: boolean) => {
    if (draggedRef.current) {
      return
    }

    if (nextOpen && allSucceeded) {
      successWasViewedRef.current = true
    }

    setOpen(nextOpen)

    if (
      !nextOpen &&
      allSucceeded &&
      successWasViewedRef.current
    ) {
      onClearFinishedTasks()
    }
  }

  const floatingLabel = t("uploadQueue.open", {
    count: tasks.length,
  })

  return (
    <div
      ref={constraintsRef}
      className="pointer-events-none fixed inset-3 z-40"
    >
      <AnimatePresence>
        {tasks.length > 0 && (
          <Popover open={open} onOpenChange={handleOpenChange}>
            <motion.div
              drag
              dragConstraints={constraintsRef}
              dragElastic={0}
              dragMomentum={false}
              className="pointer-events-auto absolute right-0 bottom-0 touch-none"
              initial={
                reducedMotion ? false : { opacity: 0, scale: 0.8, y: 8 }
              }
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={
                reducedMotion ? undefined : { opacity: 0, scale: 0.8, y: 8 }
              }
              transition={{ duration: reducedMotion ? 0 : 0.2, ease: "easeOut" }}
              whileDrag={reducedMotion ? undefined : { scale: 1.06 }}
              onDragStart={() => {
                draggedRef.current = true
                setOpen(false)
              }}
              onDragEnd={() => {
                window.setTimeout(() => {
                  draggedRef.current = false
                }, 0)
              }}
              onClickCapture={(event) => {
                if (draggedRef.current) {
                  event.preventDefault()
                  event.stopPropagation()
                }
              }}
            >
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      buttonVariants({ variant: "default", size: "icon-lg" }),
                      "relative size-11 rounded-full shadow-lg"
                    )}
                    aria-label={floatingLabel}
                    title={floatingLabel}
                  />
                }
              >
                <AnimatePresence initial={false} mode="wait">
                  <motion.span
                    key={
                      activeCount > 0
                        ? "uploading"
                        : hasFailure
                          ? "failure"
                          : "succeeded"
                    }
                    initial={reducedMotion ? false : { opacity: 0, scale: 0.65 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reducedMotion ? undefined : { opacity: 0, scale: 0.65 }}
                    transition={{ duration: reducedMotion ? 0 : 0.16 }}
                  >
                    {activeCount > 0 ? (
                      <UploadCloudIcon aria-hidden="true" />
                    ) : hasFailure ? (
                      <AlertCircleIcon aria-hidden="true" />
                    ) : (
                      <CheckCircle2Icon aria-hidden="true" />
                    )}
                  </motion.span>
                </AnimatePresence>
                <span className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full border-2 border-background bg-foreground px-1 text-[10px] leading-4 font-semibold text-background tabular-nums">
                  {tasks.length}
                </span>
              </PopoverTrigger>
            </motion.div>

            <PopoverContent
              side="top"
              align="end"
              sideOffset={8}
              className="w-[min(22rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0 data-open:animate-none data-closed:animate-none"
            >
              <motion.div
                initial={
                  reducedMotion
                    ? false
                    : { opacity: 0, y: 8, scale: 0.98 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}
              >
                <div className="flex items-center justify-between gap-3 border-b px-3.5 py-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-medium">
                      {t("uploadQueue.title")}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {activeCount > 0
                        ? t("uploadQueue.activeSummary", {
                            active: activeCount,
                            total: tasks.length,
                          })
                        : t("uploadQueue.completedSummary", {
                            completed: completedCount,
                            total: tasks.length,
                          })}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {completedCount} / {tasks.length}
                  </span>
                </div>

                <ul className="max-h-80 space-y-2 overflow-y-auto overscroll-contain p-2.5">
                  <AnimatePresence initial={false} mode="popLayout">
                    {tasks.map((task) => (
                      <UploadTaskCard
                        key={task.id}
                        task={task}
                        onCancel={() => onCancelTask(task.id)}
                        onRemove={() => onRemoveTask(task.id)}
                      />
                    ))}
                  </AnimatePresence>
                </ul>

                <p className="sr-only" role="status" aria-live="polite">
                  {t("uploadQueue.accessibleSummary", {
                    active: activeCount,
                    completed: completedCount,
                    total: tasks.length,
                  })}
                </p>
              </motion.div>
            </PopoverContent>
          </Popover>
        )}
      </AnimatePresence>
    </div>
  )
}
