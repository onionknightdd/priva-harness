import { getDownloadUrl } from "@/lib/api/sandbox-files"
import { sandboxFilePath } from "../sandbox-markdown-links"

/** Resolve stable image references before assigning a browser image source. */
export function dashboardImageUrl(source: string): string {
  const invalid = () => new Error("Image.url must be an HTTP(S) URL or sandbox:/absolute/path to an existing image.")
  if (source !== source.trim() || /\p{Cc}/u.test(source)) throw invalid()
  const path = sandboxFilePath(source)
  if (path) return getDownloadUrl(path)
  if (!/^https?:\/\//i.test(source)) throw invalid()
  let url: URL
  try { url = new URL(source) } catch { throw invalid() }
  if (!url.hostname || !["http:", "https:"].includes(url.protocol)) throw invalid()
  return url.href
}
