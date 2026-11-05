import assert from "node:assert/strict"
import { test } from "node:test"
import { zipSync } from "fflate"
import { JSDOM } from "jsdom"
import { Box3, LoadingManager, Mesh, MeshPhongMaterial } from "three"
import { parseThreeMf } from "../../../../../src/features/files/preview/model/model-3mf"

const dom = new JSDOM()
Object.assign(globalThis, { DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer, document: dom.window.document })
const core = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
const material = "http://schemas.microsoft.com/3dmanufacturing/material/2015/02"
const vertices = '<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>'
const mesh = `<object id="2" type="model"><mesh>${vertices}<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`
const build = '<build><item objectid="2"/></build>'
function model(resources = mesh, attributes = '', modelBuild = build) {
  return `<model xmlns="${core}" ${attributes}><resources>${resources}</resources>${modelBuild}</model>`
}
function archive(modelXml = model(), target = '/3D/3dmodel.model', extras: Record<string, Uint8Array> = {}) {
  const text = new TextEncoder()
  return zipSync({
    '_rels/.rels': text.encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="${target}"/></Relationships>`),
    '3D/3dmodel.model': text.encode(modelXml), ...extras,
  }, { level: 0 }).buffer as ArrayBuffer
}
function dispose(result: ReturnType<typeof parseThreeMf>) {
  result.dispose()
  result.root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const item of materials) item.dispose()
  })
}

test("3MF keeps source geometry and defaults to millimetres", () => {
  const result = parseThreeMf(archive(), new LoadingManager())
  try {
    assert.deepEqual(result.unit, { metersPerUnit: 0.001, source: "format" })
    assert.deepEqual(new Box3().setFromObject(result.root).max.toArray(), [1, 1, 0])
  } finally { dispose(result) }
})

test("3MF reads all core physical units without rescaling coordinates", () => {
  for (const [unit, scale] of Object.entries({ micron: 0.000001, millimeter: 0.001, centimeter: 0.01, inch: 0.0254, foot: 0.3048, meter: 1 })) {
    const result = parseThreeMf(archive(model(mesh, `unit="${unit}"`)), new LoadingManager())
    try {
      assert.equal(result.unit.metersPerUnit, scale)
      assert.equal(new Box3().setFromObject(result.root).max.x, 1)
    } finally { dispose(result) }
  }
})

test("3MF keeps base colors and component/build transforms", () => {
  const colored = `<basematerials id="1"><base name="red" displaycolor="#FF0000"/><base name="green" displaycolor="#00FF00"/></basematerials>
    <object id="2" type="model" pid="1" pindex="0"><mesh>${vertices}<triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="2" v3="1" p1="1"/></triangles></mesh></object>
    <object id="3" type="model"><components><component objectid="2" transform="1 0 0 0 1 0 0 0 1 2 3 4"/></components></object>`
  const result = parseThreeMf(archive(model(colored, '', '<build><item objectid="3" transform="1 0 0 0 1 0 0 0 1 10 0 0"/></build>')), new LoadingManager())
  try {
    const colors: string[] = []
    result.root.traverse((object) => { if (object instanceof Mesh) colors.push((object.material as MeshPhongMaterial).color.getHexString()) })
    assert.deepEqual(colors.sort(), ['00ff00', 'ff0000'])
    const bounds = new Box3().setFromObject(result.root)
    assert.deepEqual(bounds.min.toArray(), [12, 3, 4])
    assert.deepEqual(bounds.max.toArray(), [13, 4, 4])
  } finally { dispose(result) }
})

test("3MF material extension retains per-vertex colors", () => {
  const colored = `<m:colorgroup id="1"><m:color color="#FF0000"/><m:color color="#00FF00"/><m:color color="#0000FF"/></m:colorgroup>
    <object id="2" type="model" pid="1"><mesh>${vertices}<triangles><triangle v1="0" v2="1" v3="2" p1="0" p2="1" p3="2"/></triangles></mesh></object>`
  const result = parseThreeMf(archive(model(colored, `xmlns:m="${material}" requiredextensions="m"`)), new LoadingManager())
  try {
    const meshes: Mesh[] = []
    result.root.traverse((object) => { if (object instanceof Mesh) meshes.push(object) })
    assert.equal(meshes.length, 1)
    assert.deepEqual(Array.from(meshes[0].geometry.getAttribute('color').array), [1, 0, 0, 0, 1, 0, 0, 0, 1])
  } finally { dispose(result) }
})

test("3MF normalizes a relative root relationship without changing source bytes", () => {
  const bytes = archive(model(mesh, 'unit="inch"'), '3D/3dmodel.model')
  const original = bytes.slice(0)
  const result = parseThreeMf(bytes, new LoadingManager())
  try {
    assert.equal(result.unit.metersPerUnit, 0.0254)
    assert.equal(new Box3().setFromObject(result.root).max.x, 1)
    assert.deepEqual(bytes, original)
  } finally { dispose(result) }
})

test("3MF rejects malformed models, invalid units and unsupported required extensions", () => {
  for (const bytes of [archive('<model>'), archive(model(mesh, 'unit="yard"')), archive(model(mesh, 'unit="toString"')), archive(model(mesh, 'xmlns:x="https://example.invalid/unknown" requiredextensions="x"'))]) {
    assert.throws(() => parseThreeMf(bytes, new LoadingManager()), /Invalid XML|Unsupported 3MF unit|Unsupported required 3MF extension/)
  }
  assert.throws(() => parseThreeMf(archive(model(), 'https://example.invalid/model.model'), new LoadingManager()), /inside its package/)
  assert.throws(() => parseThreeMf(archive(model(), '../model.model'), new LoadingManager()), /escapes its package/)
})

test("3MF rejects excessive declared ZIP expansion before native decompression", () => {
  const bytes = zipSync({ 'oversized.bin': new Uint8Array([1]) }, { level: 6 }).buffer as ArrayBuffer
  const view = new DataView(bytes)
  for (let offset = 0; offset <= bytes.byteLength - 46; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 24, 128 * 1024 * 1024 + 1, true)
      break
    }
  }
  assert.throws(() => parseThreeMf(bytes, new LoadingManager()), /preview budget/)
})

test("3MF rejects inconsistent stored ZIP sizes", () => {
  const bytes = archive()
  const view = new DataView(bytes)
  for (let offset = 0; offset <= bytes.byteLength - 46; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 24, 0, true)
      break
    }
  }
  assert.throws(() => parseThreeMf(bytes, new LoadingManager()), /invalid stored ZIP entry/)
})

test("3MF texture URL disposal is idempotent and rejects external URLs", async () => {
  const manager = new LoadingManager()
  const result = parseThreeMf(archive(), manager)
  const url = URL.createObjectURL(new Blob(['texture']))
  assert.equal(manager.resolveURL(url), url)
  assert.equal(await (await fetch(url)).text(), 'texture')
  assert.throws(() => manager.resolveURL('https://example.invalid/texture.png'), /embedded/)
  result.dispose()
  result.dispose()
  await assert.rejects(fetch(url))
  dispose(result)
})

test("3MF revokes texture URLs when the native parser fails after creating textures", async () => {
  const text = new TextEncoder()
  const textured = `<m:texture2d id="1" path="/3D/Textures/pixel.png" contenttype="image/png"/>
    <m:texture2dgroup id="3" texid="1"><m:tex2coord u="0" v="0"/><m:tex2coord u="1" v="0"/><m:tex2coord u="0" v="1"/></m:texture2dgroup>
    <object id="2" type="model" pid="3"><mesh>${vertices}<triangles><triangle v1="0" v2="1" v3="2" p1="0" p2="1" p3="2"/></triangles></mesh></object>`
  const bytes = archive(model(textured, `xmlns:m="${material}"`, '<build><item objectid="999"/></build>'), '/3D/3dmodel.model', {
    '3D/_rels/3dmodel.model.rels': text.encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="texture" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dtexture" Target="/3D/Textures/pixel.png"/></Relationships>'),
    '3D/Textures/pixel.png': new Uint8Array([1, 2, 3]),
  })
  const manager = new LoadingManager()
  const urls: string[] = []
  manager.onStart = (url) => { urls.push(url) }
  assert.throws(() => parseThreeMf(bytes, manager))
  assert.equal(urls.length, 1)
  assert.ok(urls[0].startsWith('blob:'))
  await assert.rejects(fetch(urls[0]))
})
