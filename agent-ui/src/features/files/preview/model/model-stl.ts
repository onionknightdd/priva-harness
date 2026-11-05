import { BufferAttribute, Color, SRGBColorSpace } from "three"
import { STLLoader } from "three/addons/loaders/STLLoader.js"

export function parseStl(data: ArrayBuffer) {
  const geometry = new STLLoader().parse(data)
  // Three.js already decodes Magics. Its RGB order and validity bit are the
  // opposite of VisCAM/SolidView, so never reinterpret an existing color buffer.
  if (geometry.hasAttribute("color") || data.byteLength < 84) return geometry
  const view = new DataView(data)
  const faces = view.getUint32(80, true)
  if (geometry.getAttribute("position").count !== faces * 3) return geometry
  if (84 + faces * 50 > data.byteLength) {
    geometry.dispose()
    throw new Error("Binary STL file is truncated")
  }

  let hasColors = false
  for (let face = 0; face < faces; face++) {
    if (view.getUint16(84 + face * 50 + 48, true) & 0x8000) { hasColors = true; break }
  }
  if (!hasColors) return geometry

  const colors = new BufferAttribute(new Float32Array(faces * 9), 3)
  const fallback = new Color(0xb5bac4)
  const color = new Color()
  for (let face = 0; face < faces; face++) {
    const packed = view.getUint16(84 + face * 50 + 48, true)
    // In VisCAM bit 15 marks a valid face color; uncolored faces keep the
    // viewer's neutral material color. RGB values are stored in sRGB.
    if (packed & 0x8000) color.setRGB(((packed >> 10) & 31) / 31, ((packed >> 5) & 31) / 31, (packed & 31) / 31, SRGBColorSpace)
    else color.copy(fallback)
    for (let vertex = 0; vertex < 3; vertex++) colors.setXYZ(face * 3 + vertex, color.r, color.g, color.b)
  }
  geometry.setAttribute("color", colors)
  return geometry
}
