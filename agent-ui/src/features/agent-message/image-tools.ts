const MCP_IMAGE_GEN = /^mcp__[a-z0-9_-]+__image_gen$/
const MCP_IMAGE_READ = /^mcp__[a-z0-9_-]+__image_read$/
const MCP_IMAGE_EDIT = /^mcp__[a-z0-9_-]+__image_edit$/

export function isImageGenTool(name: string): boolean {
  const id = name.trim().toLowerCase()
  return id === "image_gen" || MCP_IMAGE_GEN.test(id)
}

export function isImageReadTool(name: string): boolean {
  const id = name.trim().toLowerCase()
  return id === "image_read" || MCP_IMAGE_READ.test(id)
}

export function isImageEditTool(name: string): boolean {
  const id = name.trim().toLowerCase()
  return id === "image_edit" || MCP_IMAGE_EDIT.test(id)
}
