import { ModelConversionRequiredError, type ModelVector } from "./model-types"

type Scalar = { size: number; get: (view: DataView, offset: number, little: boolean) => number; set: (view: DataView, offset: number, value: number, little: boolean) => void }
const scalars: Record<string, Scalar> = {
  char: { size: 1, get: (v, o) => v.getInt8(o), set: (v, o, n) => v.setInt8(o, n) },
  uchar: { size: 1, get: (v, o) => v.getUint8(o), set: (v, o, n) => v.setUint8(o, n) },
  short: { size: 2, get: (v, o, l) => v.getInt16(o, l), set: (v, o, n, l) => v.setInt16(o, n, l) },
  ushort: { size: 2, get: (v, o, l) => v.getUint16(o, l), set: (v, o, n, l) => v.setUint16(o, n, l) },
  int: { size: 4, get: (v, o, l) => v.getInt32(o, l), set: (v, o, n, l) => v.setInt32(o, n, l) },
  uint: { size: 4, get: (v, o, l) => v.getUint32(o, l), set: (v, o, n, l) => v.setUint32(o, n, l) },
  float: { size: 4, get: (v, o, l) => v.getFloat32(o, l), set: (v, o, n, l) => v.setFloat32(o, n, l) },
  double: { size: 8, get: (v, o, l) => v.getFloat64(o, l), set: (v, o, n, l) => v.setFloat64(o, n, l) },
}
for (const [alias, type] of Object.entries({ int8: "char", uint8: "uchar", int16: "short", uint16: "ushort", int32: "int", uint32: "uint", float32: "float", float64: "double" })) scalars[alias] = scalars[type]

function scalar(type: string) {
  const value = scalars[type]
  if (!value) throw new Error(`Unsupported coordinate data type: ${type}`)
  return value
}

function readHeader(data: ArrayBuffer, end: RegExp) {
  const bytes = new Uint8Array(data)
  const prefix = new TextDecoder("ascii").decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)))
  const match = end.exec(prefix)
  if (!match) throw new Error("Invalid point cloud header")
  const length = match.index + match[0].length
  return { text: prefix.slice(0, length), length }
}

function coordinate(value: number) {
  if (!Number.isFinite(value)) throw new Error("Point cloud contains a non-finite coordinate")
  return value
}

/** Rebase in JS float64 before stock loaders allocate their Float32 attributes. */
export function rebasePly(data: ArrayBuffer): { data: ArrayBuffer; origin: ModelVector; hasFaces: boolean } {
  const header = readHeader(data, /end_header\r?\n/)
  if (!header.text.startsWith("ply")) throw new Error("Invalid PLY signature")
  const format = /^format\s+(\S+)/m.exec(header.text)?.[1]
  type Property = { name: string; type: string; countType?: string }
  const elements: { name: string; count: number; properties: Property[] }[] = []
  for (const raw of header.text.split(/\r?\n/)) {
    const words = raw.trim().split(/\s+/)
    if (words[0] === "element") elements.push({ name: words[1], count: Number(words[2]), properties: [] })
    if (words[0] === "property") {
      const element = elements.at(-1)
      if (!element) throw new Error("PLY property without element")
      element.properties.push(words[1] === "list" ? { name: words[4], type: words[3], countType: words[2] } : { name: words[2], type: words[1] })
    }
  }
  const vertices = elements.find((element) => element.name === "vertex")
  if (!vertices || !["x", "y", "z"].every((name) => vertices.properties.some((property) => property.name === name))) throw new Error("PLY has no XYZ vertices")
  if (elements.some((element) => !Number.isSafeInteger(element.count) || element.count < 0)) throw new Error("Invalid PLY element count")
  const origin: ModelVector = [0, 0, 0]
  const hasFaces = elements.some((element) => element.name === "face" && element.count > 0)
  if (format === "ascii") {
    const tokens = new TextDecoder().decode(new Uint8Array(data, header.length)).trim().split(/\s+/)
    const lines: string[] = []
    let index = 0
    for (const element of elements) for (let row = 0; row < element.count; row++) {
      const start = index
      for (const property of element.properties) {
      if (property.countType) {
        const count = Number(tokens[index++])
        if (!Number.isSafeInteger(count) || count < 0 || index + count > tokens.length) throw new Error("Invalid PLY list")
        index += count
      } else {
        if (index >= tokens.length) throw new Error("Truncated PLY data")
        const axis = ["x", "y", "z"].indexOf(property.name)
        if (element.name === "vertex" && axis !== -1) {
          const value = coordinate(Number(tokens[index]))
          if (row === 0) origin[axis] = value
          tokens[index] = String(value - origin[axis])
        }
        index++
      }
      }
      lines.push(tokens.slice(start, index).join(" "))
    }
    return { data: new TextEncoder().encode(header.text + lines.join("\n") + "\n").buffer, origin, hasFaces }
  }
  if (format !== "binary_little_endian" && format !== "binary_big_endian") throw new Error("Unsupported PLY format")
  const result = data.slice(0)
  const view = new DataView(result)
  const little = format === "binary_little_endian"
  let offset = header.length
  for (const element of elements) for (let row = 0; row < element.count; row++) for (const property of element.properties) {
    const type = scalar(property.type)
    if (property.countType) {
      const countType = scalar(property.countType)
      const count = countType.get(view, offset, little)
      offset += countType.size
      if (!Number.isSafeInteger(count) || count < 0 || offset + count * type.size > result.byteLength) throw new Error("Invalid PLY list")
      offset += count * type.size
    } else {
      const axis = ["x", "y", "z"].indexOf(property.name)
      if (element.name === "vertex" && axis !== -1) {
        const value = coordinate(type.get(view, offset, little))
        if (row === 0) origin[axis] = value
        type.set(view, offset, value - origin[axis], little)
        if (!/float|double/.test(property.type) && type.get(view, offset, little) !== value - origin[axis]) throw new ModelConversionRequiredError("Integer coordinate range requires point cloud conversion")
      }
      offset += type.size
    }
  }
  return { data: result, origin, hasFaces }
}

export function rebasePcd(data: ArrayBuffer): { data: ArrayBuffer; origin: ModelVector } {
  const header = readHeader(data, /(?:^|\n)DATA\s+\S+\r?\n/m)
  const fields = (key: string) => new RegExp(`^${key}\\s+(.+)$`, "m").exec(header.text)?.[1].trim().split(/\s+/) ?? []
  const names = fields("FIELDS")
  const sizes = fields("SIZE").map(Number)
  const types = fields("TYPE")
  const counts = fields("COUNT").length ? fields("COUNT").map(Number) : names.map(() => 1)
  const rows = Number(fields("POINTS")[0] ?? Number(fields("WIDTH")[0]) * Number(fields("HEIGHT")[0] ?? 1))
  const encoding = fields("DATA")[0]
  if (encoding === "binary_compressed") throw new ModelConversionRequiredError("Compressed PCD uses the precision-preserving point cloud conversion path")
  if (encoding === "ascii" && counts.some((count) => count !== 1)) throw new ModelConversionRequiredError("PCD vector fields use the precision-preserving point cloud conversion path")
  if (sizes.length !== names.length || types.length !== names.length || counts.length !== names.length || counts.some((count) => !Number.isSafeInteger(count) || count < 1)) throw new Error("Invalid PCD field layout")
  if (!Number.isSafeInteger(rows) || rows < 0 || !["x", "y", "z"].every((name) => names.includes(name))) throw new Error("Invalid PCD XYZ header")
  const origin: ModelVector = [0, 0, 0]
  if (encoding === "ascii") {
    const tokens = new TextDecoder().decode(new Uint8Array(data, header.length)).trim().split(/\s+/)
    const lines: string[] = []
    let index = 0
    for (let row = 0; row < rows; row++) {
      const start = index
      for (let field = 0; field < names.length; field++) {
      const axis = ["x", "y", "z"].indexOf(names[field])
      if (index + counts[field] > tokens.length) throw new Error("Truncated PCD data")
      if (axis !== -1) {
        const value = coordinate(Number(tokens[index]))
        if (row === 0) origin[axis] = value
        tokens[index] = String(value - origin[axis])
      }
      index += counts[field]
      }
      lines.push(tokens.slice(start, index).join(" "))
    }
    return { data: new TextEncoder().encode(header.text + lines.join("\n") + "\n").buffer, origin }
  }
  if (encoding !== "binary") throw new Error("Unsupported PCD encoding")
  const result = data.slice(0)
  const view = new DataView(result)
  let offset = header.length
  for (let row = 0; row < rows; row++) for (let field = 0; field < names.length; field++) {
    const axis = ["x", "y", "z"].indexOf(names[field])
    if (axis !== -1) {
      const type = scalar(({ F: { 4: "float", 8: "double" }, I: { 1: "char", 2: "short", 4: "int" }, U: { 1: "uchar", 2: "ushort", 4: "uint" } } as Record<string, Record<number, string>>)[types[field]]?.[sizes[field]])
      const value = coordinate(type.get(view, offset, true))
      if (row === 0) origin[axis] = value
      type.set(view, offset, value - origin[axis], true)
      if (types[field] !== "F" && type.get(view, offset, true) !== value - origin[axis]) throw new ModelConversionRequiredError("Integer coordinate range requires point cloud conversion")
    }
    offset += sizes[field] * counts[field]
  }
  return { data: result, origin }
}
