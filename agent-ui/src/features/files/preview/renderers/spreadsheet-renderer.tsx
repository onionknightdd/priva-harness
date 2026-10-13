import { XlsxRenderer } from "./xlsx-renderer"

export function SpreadsheetRenderer(props: {
  fileId: string
  fileName: string
  mediaType: string
  source: string
}) {
  return <XlsxRenderer {...props} />
}
