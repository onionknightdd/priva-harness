import * as React from "react"
import { createRoot } from "react-dom/client"
import "../../../src/index.css"
import { VisualizeSandboxFrame } from "../../../src/features/agent-message/visualize-sandbox/visualize-sandbox-frame"

const host = document.querySelector<HTMLDivElement>("#preview")!
const results = document.querySelector<HTMLPreElement>("#results")!
const root = createRoot(host)
const messages: Record<string, unknown>[] = []
let requests = 0
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  if (String(input).startsWith("/api/sandbox/files/download?")) {
    requests += 1
    if (new URL(String(input), location.href).searchParams.get("path") !== "/fixture/color.bin") throw new Error("Unexpected resource request")
    return new Response(new Uint8Array([12, 34, 56]), { headers: { "Content-Type": "application/octet-stream" } })
  }
  return originalFetch(input, init)
}
window.addEventListener("message", (event) => {
  if (event.source === host.querySelector("iframe")?.contentWindow && event.data?.source === "three-browser-check") messages.push(event.data)
})
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(test: () => boolean, label: string) {
  const deadline = performance.now() + 20000
  while (!test()) {
    if (performance.now() > deadline) throw new Error(label + ": " + host.textContent)
    await wait(25)
  }
}
function program(version: number) {
  return `function App() {
    const ref = useRef(null);
    useEffect(() => {
      const view = createThreeScene(ref.current);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial());
      view.scene.add(mesh); view.requestRender();
      window.fixtureMounts = (window.fixtureMounts || 0) + 1;
      const send = (data) => parent.postMessage({ source: "three-browser-check", version: ${version}, ...data }, "*");
      const animate = event => { if (event.data?.source === "fixture-motion") view.setAnimation(delta => { mesh.rotation.y += delta; }); };
      window.addEventListener("message", animate);
      const timer = setInterval(() => send({ kind: "status", mounts: window.fixtureMounts, calls: view.renderer.info.render.calls, frames: view.renderer.info.render.frame, theme: getComputedStyle(document.documentElement).colorScheme }), 50);
      assets.read("/fixture/color.bin").then(data => send({ kind: "asset", bytes: [...new Uint8Array(data)] }));
      assets.read("/fixture/secret.bin").then(() => send({ kind: "unexpected" }), error => send({ kind: "denied", message: error.message }));
      return () => { clearInterval(timer); window.removeEventListener("message", animate); view.dispose(); send({ kind: "disposed", geometries: view.renderer.info.memory.geometries }); };
    }, []);
    return <div ref={ref} style={{height:320}} />;
  }`
}
function show(version: number, streaming = false) {
  root.render(<React.StrictMode><VisualizeSandboxFrame jsx={program(version)} streaming={streaming} assets={["/fixture/color.bin"]} title="Three fixture" /></React.StrictMode>)
}
async function run() {
  results.textContent = "Running…"
  try {
    show(1, true)
    await wait(120)
    if (host.querySelector("iframe")) throw new Error("Streaming must not initialize WebGL")
    show(1)
    await until(() => messages.some((message) => message.kind === "status" && Number(message.calls) > 0), "WebGL did not draw")
    await until(() => messages.some((message) => message.kind === "asset") && messages.some((message) => message.kind === "denied"), "Asset bridge did not settle")
    const frame = host.querySelector("iframe")!
    const initialMounts = Number(messages.find((message) => message.kind === "status")!.mounts)
    const initialFrame = messages.filter((message) => message.kind === "status").at(-1)!.frames
    await wait(180)
    if (messages.filter((message) => message.kind === "status").at(-1)!.frames !== initialFrame) throw new Error("Static scene continuously redraws")
    document.documentElement.classList.add("dark")
    await until(() => messages.some((message) => message.theme === "dark"), "Theme update did not reach sandbox")
    show(1)
    await wait(120)
    if (host.querySelector("iframe") !== frame || messages.some((message) => message.kind === "status" && Number(message.mounts) !== initialMounts)) throw new Error("Same program or theme remounted the scene")
    show(2)
    await until(() => messages.some((message) => message.kind === "disposed" && message.version === 1), "Previous scene was not disposed")
    await until(() => messages.some((message) => message.kind === "status" && message.version === 2), "Changed program did not mount")
    if (host.querySelector("iframe") !== frame) throw new Error("Code update replaced the iframe")
    if (Number(messages.find((message) => message.kind === "disposed")?.geometries) !== 0) throw new Error("Geometry was not released")
    const frames = () => Number(messages.filter((message) => message.kind === "status" && message.version === 2).at(-1)?.frames)
    const still = frames()
    frame.contentWindow!.postMessage({ source: "fixture-motion" }, "*")
    await until(() => frames() > still + 2, "Animation did not start")
    host.style.display = "none"
    await wait(200)
    const hidden = frames()
    await wait(200)
    if (frames() !== hidden) throw new Error("Hidden scene animation did not pause")
    host.style.display = "block"
    await until(() => frames() > hidden + 2, "Visible scene animation did not resume")
    root.unmount()
    await until(() => !host.querySelector("iframe"), "Unmount retained the iframe")
    if (messages.some((message) => message.kind === "unexpected")) throw new Error("Undeclared resource was readable")
    if (requests !== 1) throw new Error("Resource reads were not deduplicated")
    results.textContent = "PASS: WebGL drawing, stream deferral, static frame budget, local assets, denied undeclared assets, stable iframe, theme state preservation, scene disposal, hidden animation pause/resume, unmount."
  } catch (error) { results.textContent = "FAIL: " + String(error) }
}
document.getElementById("run")!.addEventListener("click", () => { void run() })
if (new URLSearchParams(location.search).has("auto")) void run()
