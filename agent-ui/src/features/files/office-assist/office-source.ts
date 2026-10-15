export async function readOfficeSource(source: string, signal: AbortSignal, invalidMessage: string) {
  const response = await fetch(source, { signal })
  if (!response.ok) throw new Error(response.statusText || "HTTP " + response.status)
  const data = await response.arrayBuffer()
  const signature = new Uint8Array(data, 0, Math.min(4, data.byteLength))
  if (signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 0x03 || signature[3] !== 0x04) {
    throw new Error(invalidMessage)
  }
  const digest = await crypto.subtle.digest("SHA-256", data)
  const fileRevision = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  return { data, fileRevision }
}
