import * as React from "react"
import { createRoot, type Root } from "react-dom/client"

import { VISUALIZE_SANDBOX_SOURCE } from "./protocol"
import { sandboxComponents } from "./sandbox-components"

type SandboxWindow = Window & {
  React: typeof React
  VisualizeSandbox: {
    components: typeof sandboxComponents
    mount: typeof mount
    reportError: typeof reportError
  }
}

const sandboxWindow = window as unknown as SandboxWindow
const roots = new Map<string, Root>()

function post(
  payload:
    | { kind: "resize"; id: string; height: number }
    | { kind: "error"; id: string; message: string }
) {
  parent.postMessage({ source: VISUALIZE_SANDBOX_SOURCE, ...payload }, "*")
}

function reportError(id: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  post({ kind: "error", id, message })
}

function mount(Root: React.ComponentType, id: string) {
  const el = document.getElementById("root")
  if (!el) {
    throw new Error("visualize sandbox root is missing")
  }
  const existing = roots.get(id)
  if (existing) {
    existing.unmount()
  }
  const root = createRoot(el)
  roots.set(id, root)
  root.render(React.createElement(Root))

  const observer = new ResizeObserver(() => {
    const height = Math.ceil(el.getBoundingClientRect().height)
    post({ kind: "resize", id, height })
  })
  observer.observe(el)
  post({ kind: "resize", id, height: Math.ceil(el.getBoundingClientRect().height) })
}

sandboxWindow.React = React
sandboxWindow.VisualizeSandbox = {
  components: sandboxComponents,
  mount,
  reportError,
}
