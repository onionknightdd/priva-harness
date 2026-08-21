import { FolderIcon, FolderOpenIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export function FileTreeFolderIcon({ expanded }: { expanded: boolean }) {
  return (
    <span aria-hidden="true" className="relative size-4 shrink-0">
      <FolderIcon
        className={cn(
          "absolute inset-0 size-4 text-muted-foreground transition-opacity duration-200 motion-reduce:transition-none",
          expanded ? "opacity-0" : "opacity-100"
        )}
      />
      <FolderOpenIcon
        className={cn(
          "absolute inset-0 size-4 text-muted-foreground transition-opacity duration-200 motion-reduce:transition-none",
          expanded ? "opacity-100" : "opacity-0"
        )}
      />
    </span>
  )
}
