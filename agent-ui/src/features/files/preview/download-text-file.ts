export function downloadTextFile(
  fileName: string,
  content: string,
  mediaType = "text/html"
) {
  const blob = new Blob([content], { type: `${mediaType};charset=utf-8` })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")

  anchor.href = objectUrl
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}
