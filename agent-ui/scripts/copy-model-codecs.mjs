import { cp, mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)
const destination = new URL("public/model-codecs/", root)
await mkdir(destination, { recursive: true })
for (const [source, target] of [
  ["node_modules/three/examples/jsm/libs/draco/gltf/", "draco/"],
  ["node_modules/three/examples/jsm/libs/basis/", "basis/"],
  ["node_modules/occt-import-js/dist/occt-import-js.wasm", "occt-import-js.wasm"],
  ["node_modules/laz-perf/lib/laz-perf.wasm", "laz-perf.wasm"],
]) {
  await cp(fileURLToPath(new URL(source, root)), fileURLToPath(new URL(target, destination)), { recursive: true })
}
