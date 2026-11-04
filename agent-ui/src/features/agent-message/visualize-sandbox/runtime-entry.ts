import * as React from "react"
import { createRoot, type Root } from "react-dom/client"
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

import { VISUALIZE_HOST_SOURCE, VISUALIZE_SANDBOX_SOURCE } from "./protocol"
import { sandboxComponents } from "./sandbox-components"
import { createThreeScene, disposeThreeScenes, setThreeScenesVisible } from "./three-scene"

let root: Root | undefined
let observer: ResizeObserver | undefined
let frameId = ""
let generation = 0
let requestSequence = 0
let lastCode = ""
let parentVisible = true
const objectUrls = new Set<string>()
const pending = new Map<string, { resolve(value: { data: ArrayBuffer; mimeType: string }): void; reject(reason: Error): void }>()

function post(payload: object) {
  parent.postMessage({ source: VISUALIZE_SANDBOX_SOURCE, id: frameId, ...payload }, "*")
}
function reportError(error: unknown) {
  post({ kind: "error", message: error instanceof Error ? error.message : String(error) })
}
function dispose() {
  generation += 1
  root?.unmount()
  root = undefined
  observer?.disconnect()
  observer = undefined
  disposeThreeScenes()
  for (const request of pending.values()) request.reject(new Error("Preview content changed"))
  pending.clear()
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls.clear()
}
function readAsset(path: string): Promise<{ data: ArrayBuffer; mimeType: string }> {
  if (typeof path !== "string" || !path || path.length > 4096) return Promise.reject(new Error("Invalid asset path"))
  const requestId = `${generation}:${++requestSequence}`
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    post({ kind: "asset", requestId, path })
  })
}
const assets = {
  async read(path: string) { return (await readAsset(path)).data },
  async url(path: string) {
    const expectedGeneration = generation
    const { data, mimeType } = await readAsset(path)
    if (expectedGeneration !== generation) throw new Error("Preview content changed")
    const url = URL.createObjectURL(new Blob([data], { type: mimeType }))
    objectUrls.add(url)
    return url
  },
}
function mount(Component: React.ComponentType) {
  const el = document.getElementById("root")
  if (!el) throw new Error("visualize sandbox root is missing")
  root = createRoot(el, { onUncaughtError: reportError })
  root.render(React.createElement(Component))
  observer = new ResizeObserver(() => post({ kind: "resize", height: Math.ceil(el.getBoundingClientRect().height) }))
  observer.observe(el)
}
function renderCode(code: string) {
  if (lastCode === code) return
  lastCode = code
  dispose()
  // Script text is set through the DOM, never parsed as HTML or evaluated in the host.
  const script = document.createElement("script")
  script.textContent = `(function () {
    const sandbox = window.VisualizeSandbox;
    const { React, THREE, OrbitControls, createThreeScene, assets } = sandbox;
    const { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, useId, useReducer, Fragment } = React;
    const { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Progress, Separator } = sandbox.components;
    try {
      ${code}
      const Component = typeof App === "function" ? App : typeof Preview === "function" ? Preview : null;
      if (!Component) throw new Error("visualize needs a function named App or a JSX snippet");
      sandbox.mount(Component);
    } catch (error) { sandbox.reportError(error); }
  })();`
  document.body.append(script)
  script.remove()
}
function start(id: string) {
  frameId = id
  window.addEventListener("message", (event) => {
    if (event.source !== parent || !event.data || event.data.source !== VISUALIZE_HOST_SOURCE || event.data.id !== frameId) return
    const message = event.data
    if (message.kind === "render" && typeof message.code === "string") renderCode(message.code)
    else if (message.kind === "theme" && typeof message.css === "string") {
      const style = document.getElementById("visualize-theme")
      if (style) style.textContent = message.css
    } else if (message.kind === "visibility" && typeof message.visible === "boolean") {
      parentVisible = message.visible
      setThreeScenesVisible(parentVisible && !document.hidden)
    }
    else if (message.kind === "asset-result" && typeof message.requestId === "string") {
      const request = pending.get(message.requestId)
      if (!request) return
      pending.delete(message.requestId)
      if (typeof message.error === "string") request.reject(new Error(message.error))
      else if (message.data instanceof ArrayBuffer && typeof message.mimeType === "string") request.resolve({ data: message.data, mimeType: message.mimeType })
      else request.reject(new Error("Invalid resource response"))
    }
  })
  document.addEventListener("visibilitychange", () => setThreeScenesVisible(parentVisible && !document.hidden))
  window.addEventListener("pagehide", dispose, { once: true })
  window.addEventListener("error", (event) => reportError(event.error ?? event.message))
  post({ kind: "ready" })
}

Object.assign(window, { React, THREE, VisualizeSandbox: {
  React, THREE, OrbitControls, createThreeScene, assets, components: sandboxComponents, mount, reportError, start,
} })
