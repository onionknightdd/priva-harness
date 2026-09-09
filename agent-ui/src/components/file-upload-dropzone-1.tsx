import { Upload, X } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import type * as React from "react"

import { Button } from "@/components/ui/button"
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from "@/components/ui/file-upload"
import { cn } from "@/lib/utils"

type FileUploadDropzone1Props = Omit<React.ComponentProps<typeof FileUpload>, "children" | "defaultValue"> & {
  labels: { title: string; description: string; browse: string; remove: string }
}

// @shadcnblocks/file-upload/file-upload-dropzone-1, composed with Dice UI's Base UI primitives.
export default function FileUploadDropzone1({ value = [], labels, className, disabled, ...props }: FileUploadDropzone1Props) {
  const reduceMotion = useReducedMotion()

  return (
    <FileUpload {...props} value={value} disabled={disabled} className={cn("w-full", className)}>
      <FileUploadDropzone className="transition-colors duration-150 motion-reduce:transition-none">
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="flex items-center justify-center rounded-full border p-2.5">
            <Upload aria-hidden className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">{labels.title}</p>
          <p className="text-xs text-muted-foreground">{labels.description}</p>
        </div>
        <FileUploadTrigger render={<Button type="button" variant="outline" size="sm" className="mt-2 w-fit" />}>
          {labels.browse}
        </FileUploadTrigger>
      </FileUploadDropzone>
      <FileUploadList>
        {value.map((file) => (
          <FileUploadItem key={`${file.name}:${file.size}:${file.lastModified}`} value={file}
            render={<motion.div initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} />}>
            <FileUploadItemPreview />
            <FileUploadItemMetadata />
            <FileUploadItemDelete disabled={disabled} aria-label={`${labels.remove}: ${file.name}`} render={<Button type="button" variant="ghost" size="icon" className="size-7" />}>
              <X aria-hidden className="size-4" />
            </FileUploadItemDelete>
          </FileUploadItem>
        ))}
      </FileUploadList>
    </FileUpload>
  )
}
