import type RFB from "@novnc/novnc"

export type ComputerConnectionState =
  | "connecting"
  | "connected"
  | "unavailable"
  | "disconnected"
  | "failed"

type ComputerClient = Pick<RFB,
  | "addEventListener" | "removeEventListener" | "disconnect" | "blur"
  | "scaleViewport" | "resizeSession" | "viewOnly" | "focusOnClick" | "background"
>

type ComputerClientConstructor = new (target: HTMLElement, url: string) => ComputerClient

export function computerStreamUrl(location: Pick<Location, "href"> = window.location) {
  const url = new URL("/api/sandbox/computer/stream", location.href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.href
}

/** One displayed connection owns its canvas, listeners and pending requests. */
export function connectComputer(
  target: HTMLElement,
  onState: (state: ComputerConnectionState) => void,
  loadClient: () => Promise<ComputerClientConstructor> = async () => (await import("@novnc/novnc")).default,
) {
  const controller = new AbortController()
  const surface = document.createElement("div")
  surface.style.width = "100%"
  surface.style.height = "100%"
  target.append(surface)

  let client: ComputerClient | undefined
  let disposed = false
  let finished = false
  const timeout = window.setTimeout(() => fail("failed"), 15_000)

  function closeClient() {
    if (!client) return
    client.removeEventListener("connect", onConnect)
    client.removeEventListener("disconnect", onDisconnect)
    client.removeEventListener("credentialsrequired", onSecurityFailure)
    client.removeEventListener("securityfailure", onSecurityFailure)
    client.removeEventListener("serververification", onSecurityFailure)
    // Blur first so noVNC releases held keys before input is disabled.
    client.blur()
    client.viewOnly = true
    client.disconnect()
    client = undefined
  }

  function fail(state: ComputerConnectionState) {
    if (disposed || finished) return
    finished = true
    window.clearTimeout(timeout)
    controller.abort()
    closeClient()
    surface.remove()
    onState(state)
  }

  function onConnect() {
    if (disposed || finished) return
    window.clearTimeout(timeout)
    const canvas = surface.querySelector("canvas")
    if (canvas) canvas.tabIndex = 0
    onState("connected")
  }

  function onDisconnect() { fail("disconnected") }
  function onSecurityFailure() { fail("failed") }

  onState("connecting")
  void (async () => {
    try {
      const response = await fetch("/api/sandbox/computer", {
        cache: "no-store",
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Computer status: HTTP ${response.status}`)
      const status: unknown = await response.json()
      if (disposed || finished) return
      if (!status || typeof status !== "object" || !("available" in status) || typeof status.available !== "boolean") {
        throw new Error("Invalid computer status")
      }
      if (!status.available) { fail("unavailable"); return }

      const Client = await loadClient()
      if (disposed || finished) return
      client = new Client(surface, computerStreamUrl())
      client.scaleViewport = true
      // The shared desktop has a fixed resolution. Resizing this panel only
      // scales its view, never changes another viewer's desktop dimensions.
      client.resizeSession = false
      client.focusOnClick = true
      client.background = "var(--background)"
      client.addEventListener("connect", onConnect)
      client.addEventListener("disconnect", onDisconnect)
      client.addEventListener("credentialsrequired", onSecurityFailure)
      client.addEventListener("securityfailure", onSecurityFailure)
      client.addEventListener("serververification", onSecurityFailure)
    } catch {
      fail("failed")
    }
  })()

  return () => {
    disposed = true
    window.clearTimeout(timeout)
    controller.abort()
    closeClient()
    surface.remove()
  }
}
