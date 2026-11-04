export const trianglePositions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
export const triangleObj = "o triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"
export const triangleStl = "solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle\n"
export const pointPly = "ply\nformat ascii 1.0\nelement vertex 2\nproperty double x\nproperty double y\nproperty double z\nend_header\n1000000 2000000 3\n1000000.001 2000000 3\n"
export const pointPcd = "# .PCD v0.7\nVERSION 0.7\nFIELDS x y z\nSIZE 8 8 8\nTYPE F F F\nCOUNT 1 1 1\nWIDTH 2\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS 2\nDATA ascii\n1000000 2000000 3\n1000000.001 2000000 3\n"

export function triangleGltf(uri?: string) {
  return {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ ...(uri ? { uri } : {}), byteLength: trianglePositions.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: trianglePositions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
  }
}

export function triangleGlb() {
  const json = new TextEncoder().encode(JSON.stringify(triangleGltf()))
  const jsonSize = Math.ceil(json.length / 4) * 4
  const result = new ArrayBuffer(12 + 8 + jsonSize + 8 + trianglePositions.byteLength)
  const view = new DataView(result)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, result.byteLength, true)
  view.setUint32(12, jsonSize, true)
  view.setUint32(16, 0x4e4f534a, true)
  new Uint8Array(result, 20, jsonSize).fill(32)
  new Uint8Array(result, 20, json.length).set(json)
  view.setUint32(20 + jsonSize, trianglePositions.byteLength, true)
  view.setUint32(24 + jsonSize, 0x004e4942, true)
  new Uint8Array(result, 28 + jsonSize).set(new Uint8Array(trianglePositions.buffer))
  return result
}

export function doubleBinaryPly() {
  const header = new TextEncoder().encode("ply\nformat binary_little_endian 1.0\nelement vertex 2\nproperty double x\nproperty double y\nproperty double z\nend_header\n")
  const result = new ArrayBuffer(header.length + 48)
  new Uint8Array(result).set(header)
  const view = new DataView(result)
  for (const [index, value] of [1000000, 2000000, 3, 1000000.001, 2000000, 3].entries()) view.setFloat64(header.length + index * 8, value, true)
  return result
}

export function doubleBinaryPcd() {
  const header = new TextEncoder().encode(pointPcd.split("DATA ascii", 1)[0] + "DATA binary\n")
  const result = new ArrayBuffer(header.length + 48)
  new Uint8Array(result).set(header)
  const view = new DataView(result)
  for (const [index, value] of [1000000, 2000000, 3, 1000000.001, 2000000, 3].entries()) view.setFloat64(header.length + index * 8, value, true)
  return result
}
