import type { ModelFormat } from "./model-types"

const formats: Record<string, ModelFormat> = {
  glb: "glb", gltf: "gltf", obj: "obj", stl: "stl", "3mf": "3mf", ply: "ply", pcd: "pcd",
  step: "step", stp: "step", iges: "iges", igs: "iges", las: "las", laz: "laz", copc: "copc",
}

export function getModelFormat(name: string): ModelFormat | null {
  const filename = name.split(/[?#]/, 1)[0].toLowerCase()
  if (filename.endsWith(".copc.laz")) return "copc"
  return formats[filename.split(".").at(-1) ?? ""] ?? null
}

export function isPointCloudFormat(format: ModelFormat) {
  return ["ply", "pcd", "las", "laz", "copc"].includes(format)
}

export function isCopcHeader(data: ArrayBuffer) {
  if (data.byteLength < 429) return false
  const bytes = new Uint8Array(data)
  const text = new TextDecoder()
  return text.decode(bytes.subarray(0, 4)) === "LASF" &&
    bytes[24] === 1 && bytes[25] === 4 &&
    new DataView(data).getUint16(94, true) === 375 &&
    text.decode(bytes.subarray(377, 381)) === "copc" &&
    new DataView(data).getUint16(393, true) === 1
}
