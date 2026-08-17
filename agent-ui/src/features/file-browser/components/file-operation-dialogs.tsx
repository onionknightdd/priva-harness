import * as React from "react"
import gsap from "gsap"
import { LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

import type { FileBrowserItem } from "../file-browser-data"

function useAnimatedError(error: string | null) {
  const errorRef = React.useRef<HTMLParagraphElement>(null)

  React.useLayoutEffect(() => {
    if (
      !error ||
      !errorRef.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const tween = gsap.fromTo(
      errorRef.current,
      { opacity: 0, x: -4 },
      {
        opacity: 1,
        x: 0,
        duration: 0.22,
        ease: "power2.out",
        clearProps: "transform,opacity",
      }
    )

    return () => {
      tween.kill()
    }
  }, [error])

  return errorRef
}

export function CreateFolderDialog({
  directory,
  onCreate,
  onOpenChange,
}: {
  directory: string | null
  onCreate: (directory: string, name: string) => Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const errorRef = useAnimatedError(error)

  React.useEffect(() => {
    setName("")
    setError(null)
    setPending(false)
  }, [directory])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const folderName = name.trim()

    if (!directory || !folderName || pending) {
      return
    }

    setPending(true)
    setError(null)
    try {
      await onCreate(directory, folderName)
      onOpenChange(false)
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : String(submitError)
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={Boolean(directory)}
      onOpenChange={(open) => {
        if (!pending) {
          onOpenChange(open)
        }
      }}
    >
      <DialogContent>
        <form className="grid gap-6" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("fileBrowser.createDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("fileBrowser.createDialog.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
              {directory}
            </p>
            <label className="grid gap-1.5 text-sm">
              <span>{t("fileBrowser.createDialog.name")}</span>
              <Input
                autoFocus
                value={name}
                disabled={pending}
                aria-invalid={Boolean(error) || undefined}
                placeholder={t("fileBrowser.createDialog.placeholder")}
                onChange={(event) => {
                  setName(event.target.value)
                  setError(null)
                }}
              />
            </label>
            {error && (
              <p ref={errorRef} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {t("fileBrowser.createDialog.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending && (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              )}
              {t("fileBrowser.createDialog.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DeletePathDialog({
  item,
  onDelete,
  onOpenChange,
}: {
  item: FileBrowserItem | null
  onDelete: (item: FileBrowserItem) => Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const errorRef = useAnimatedError(error)

  React.useEffect(() => {
    setError(null)
    setPending(false)
  }, [item])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!item || pending) {
      return
    }

    setPending(true)
    setError(null)
    try {
      await onDelete(item)
      onOpenChange(false)
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : String(submitError)
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={(open) => {
        if (!pending) {
          onOpenChange(open)
        }
      }}
    >
      <DialogContent>
        <form className="grid gap-6" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("fileBrowser.deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("fileBrowser.deleteDialog.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <p className="break-all rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
              {item?.path}
            </p>
            {error && (
              <p ref={errorRef} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {t("fileBrowser.deleteDialog.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              )}
              {t("fileBrowser.deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
