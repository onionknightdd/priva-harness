import assert from "node:assert/strict"
import { test } from "node:test"
import { Color, type BufferGeometry } from "three"
import { parseStl } from "../../../../../src/features/files/preview/model/model-stl"
import { triangleStl } from "./model-fixtures"

function binaryStl(attributes: number[], magicsColor?: [number, number, number, number]) {
  const bytes = new ArrayBuffer(84 + attributes.length * 50)
  const header = new Uint8Array(bytes, 0, 80)
  header.set(new TextEncoder().encode("binary color fixture"))
  if (magicsColor) {
    header.set(new TextEncoder().encode("COLOR="))
    header.set(magicsColor, 6)
  }
  const view = new DataView(bytes)
  view.setUint32(80, attributes.length, true)
  for (const [face, attribute] of attributes.entries()) {
    const offset = 84 + face * 50
    const normalAndVertices = [0, 0, 1, face, 0, 0, face + 1, 0, 0, face, 1, 0]
    for (const [index, value] of normalAndVertices.entries()) view.setFloat32(offset + index * 4, value, true)
    view.setUint16(offset + 48, attribute, true)
  }
  return bytes
}

function colorAt(geometry: BufferGeometry, vertex: number) {
  const color = geometry.getAttribute("color")
  return [color.getX(vertex), color.getY(vertex), color.getZ(vertex)]
}

function assertChannels(actual: number[], expected: number[]) {
  actual.forEach((channel, index) => assert.ok(Math.abs(channel - expected[index]) < 1e-6, `${actual} matches ${expected}`))
}

test("VisCAM face colors decode red, green and blue without changing geometry or source bytes", () => {
  const bytes = binaryStl([0xfc00, 0x83e0, 0x801f])
  const original = bytes.slice(0)
  const geometry = parseStl(bytes)
  try {
    assert.equal(geometry.getAttribute("position").count, 9)
    assert.equal(geometry.getAttribute("color").count, 9)
    for (let vertex = 0; vertex < 3; vertex++) {
      assert.deepEqual(colorAt(geometry, vertex), [1, 0, 0])
      assert.deepEqual(colorAt(geometry, vertex + 3), [0, 1, 0])
      assert.deepEqual(colorAt(geometry, vertex + 6), [0, 0, 1])
    }
    assert.equal(geometry.getAttribute("position").getX(6), 2)
    assert.equal(geometry.getAttribute("normal").getZ(6), 1)
    assert.deepEqual(bytes, original)
  } finally { geometry.dispose() }
})

test("VisCAM 5-bit channels are converted from sRGB to linear vertex colors", () => {
  const geometry = parseStl(binaryStl([0x8000 | (8 << 10) | (16 << 5) | 24]))
  try {
    const linear = (value: number) => Math.pow((value / 31 + 0.055) / 1.055, 2.4)
    assertChannels(colorAt(geometry, 0), [linear(8), linear(16), linear(24)])
  } finally { geometry.dispose() }
})

test("VisCAM uses the default gray for faces without a valid color flag", () => {
  const geometry = parseStl(binaryStl([0xfc00, 0x001f, 0]))
  try {
    const gray = new Color(0xb5bac4).toArray()
    assert.deepEqual(colorAt(geometry, 0), [1, 0, 0])
    assertChannels(colorAt(geometry, 3), gray)
    assertChannels(colorAt(geometry, 6), gray)
  } finally { geometry.dispose() }
})

test("ordinary binary STL attributes do not invent vertex colors", () => {
  for (const attributes of [[0, 0], [0x001f, 0x7c00]]) {
    const geometry = parseStl(binaryStl(attributes))
    try { assert.equal(geometry.getAttribute("color"), undefined) } finally { geometry.dispose() }
  }
})

test("a valid VisCAM black face is retained", () => {
  const geometry = parseStl(binaryStl([0x8000]))
  try { assert.deepEqual(colorAt(geometry, 0), [0, 0, 0]) } finally { geometry.dispose() }
})

test("Magics header takes precedence over VisCAM and keeps its opposite bit semantics", () => {
  const geometry = parseStl(binaryStl([0x001f, 0x8000, 0xfc00], [255, 0, 255, 128]))
  try {
    assert.deepEqual(colorAt(geometry, 0), [1, 0, 0])
    assert.deepEqual(colorAt(geometry, 3), [1, 0, 1])
    assert.deepEqual(colorAt(geometry, 6), [1, 0, 1])
    assert.equal((geometry as BufferGeometry & { alpha: number }).alpha, 128 / 255)
  } finally { geometry.dispose() }
})

test("ASCII STL continues to parse without invented colors", () => {
  const geometry = parseStl(new TextEncoder().encode(triangleStl).buffer)
  try {
    assert.equal(geometry.getAttribute("position").count, 3)
    assert.equal(geometry.getAttribute("color"), undefined)
  } finally { geometry.dispose() }
})

test("truncated binary STL still fails instead of displaying a partial colored model", () => {
  assert.throws(() => parseStl(new ArrayBuffer(12)))
  assert.throws(() => parseStl(binaryStl([0xfc00, 0x83e0]).slice(0, -1)))
})
