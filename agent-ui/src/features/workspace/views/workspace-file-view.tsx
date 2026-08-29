import * as React from "react"

const FileBrowserPage = React.lazy(async () => {
  const module = await import("@/features/file-browser")

  return { default: module.FileBrowserPage }
})

export function WorkspaceFileView() {
  return (
    <React.Suspense fallback={<div className="h-full" aria-hidden="true" />}>
      <FileBrowserPage className="h-full p-0" compact />
    </React.Suspense>
  )
}
