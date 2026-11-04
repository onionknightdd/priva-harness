import initializeOcct from "occt-import-js"

self.onmessage = async (event: MessageEvent<{ data: ArrayBuffer; format: "step" | "iges"; wasmUrl: string }>) => {
  try {
    const { data, format, wasmUrl } = event.data
    const occt = await initializeOcct({ locateFile: (path) => path.endsWith(".wasm") ? wasmUrl : path })
    const options = { linearUnit: "meter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.001, angularDeflection: 0.5 }
    const result = format === "step" ? occt.ReadStepFile(new Uint8Array(data), options) : occt.ReadIgesFile(new Uint8Array(data), options)
    if (!result.success) throw new Error(`Cannot parse ${format.toUpperCase()} model`)
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "CAD import failed" })
  }
}
