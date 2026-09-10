import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/i18n"
import "../../../src/index.css"
import { SkillResourceTree } from "../../../src/features/resources/skill-resource-tree"
import { createResourceCache, useResource } from "../../../src/features/resources/resource-hooks"
import type { ResourceDetail, ResourceQuery, ResourceSource, SkillDetail } from "../../../src/features/resources/resource-api"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const query: ResourceQuery = { harness: "claude" }
const source: ResourceSource = { id: "global", harness: "claude", scope: "global", origin: "user", label: "Global", path: "/skills", cwd: null, writable: true, canAdd: true }
const skills: SkillDetail[] = ["alpha", "beta", "gamma"].map((id) => ({
  id, sourceId: source.id, name: id, description: "Test skill", path: `/skills/${id}`, filePath: `/skills/${id}/SKILL.md`, enabled: true, canToggle: true, canDelete: true, toggleDescription: "",
  source, content: `# ${id}`, files: [{ path: "SKILL.md", size: 256 }, { path: "references/example.ts", size: 64 }],
}))
const previewSnapshots: { selected: string | null; data: string | null; loading: boolean }[] = []

export function Harness({ mobile }: { mobile: boolean }) {
  const [selection, setSelection] = React.useState<{ id: string; file: string | null } | null>(null)
  const [revision, refresh] = React.useReducer((value: number) => value + 1, 0)
  const scope = React.useMemo(() => ({ revision, cache: createResourceCache<ResourceDetail>() }), [revision])
  const detail = useResource(selection ? `skills/${selection.id}` : null, query, scope.revision, scope.cache)
  React.useLayoutEffect(() => {
    previewSnapshots.push({ selected: selection?.id ?? null, data: detail.data?.id ?? null, loading: detail.loading })
  }, [selection, detail.data, detail.loading])
  const onSelect = React.useCallback((id: string, file: string | null) => setSelection({ id, file }), [])
  return <>
    {skills.map((skill) => <SkillResourceTree key={skill.id} skill={skill} source={source} query={query} revision={scope.revision} cache={scope.cache} selected={selection?.id === skill.id} file={selection?.file ?? null} mobile={mobile} onSelect={onSelect} onRetry={refresh} />)}
    <output id="preview">{selection ? `${selection.id}:${selection.file ?? "SKILL.md"}:${detail.data ? "ready" : "loading"}` : "none"}</output>
  </>
}

async function runChecks() {
  const host = document.querySelector<HTMLDivElement>("#tree")!
  const results = document.querySelector<HTMLPreElement>("#results")!
  const root = createRoot(host)
  const originalFetch = window.fetch
  const requests: string[] = []
  const pending = new Map<string, (response: Response) => void>()
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href)
    if (!url.pathname.startsWith("/api/sandbox/resource/skills/")) return originalFetch(input, init)
    const id = url.pathname.split("/").at(-1)!
    requests.push(id)
    return new Promise((resolve) => pending.set(id, resolve))
  }
  const passed: string[] = []
  const check = (name: string, condition: boolean) => {
    if (!condition) throw new Error(name)
    passed.push(name)
  }
  const row = (path: string) => {
    const element = host.querySelector<HTMLButtonElement>(`[data-file-tree-item-id="/skills/${path}"]`)
    if (!element) throw new Error(`Missing row: ${path}`)
    return element
  }
  const preview = () => host.querySelector("#preview")!.textContent
  const settle = async () => {
    for (let frame = 0; frame < 6; frame += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    }
  }
  const respond = async (id: string, fail = false) => {
    const resolve = pending.get(id)
    if (!resolve) throw new Error(`Missing request: ${id}`)
    pending.delete(id)
    await act(async () => {
      resolve(Response.json(fail ? { detail: "Cannot read skill files" } : skills.find((skill) => skill.id === id), { status: fail ? 500 : 200 }))
    })
    await settle()
  }
  const key = async (element: HTMLElement, value: string) => {
    await act(async () => {
      element.focus()
      element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true }))
      element.dispatchEvent(new KeyboardEvent("keyup", { key: value, bubbles: true }))
    })
  }

  try {
    results.textContent = "Running…"
    await act(async () => { root.render(<Harness mobile={false} />) })
    check("skills start collapsed without fetching file lists", requests.length === 0 && skills.every((skill) => row(skill.id).getAttribute("aria-expanded") === "false"))
    check("skill roots use the Skill icon", Boolean(row("alpha").querySelector(".lucide-scroll-text")))

    await act(async () => { row("alpha").click() })
    check("tree and preview share a single request", requests.join(",") === "alpha")
    check("loading appears on the expanding skill row", row("alpha").getAttribute("aria-busy") === "true")
    await act(async () => { row("alpha").click() })
    await respond("alpha")
    check("loading completion respects a manual collapse", row("alpha").getAttribute("aria-expanded") === "false")
    check("clicking a skill opens its default preview", preview() === "alpha:SKILL.md:ready")

    await act(async () => { row("alpha").click() })
    await settle()
    const skillFile = row("alpha/SKILL.md")
    check("reopening uses cached files", requests.length === 1 && row("alpha").getAttribute("aria-expanded") === "true")
    check("files use the shared tree row and file type icon", Boolean(skillFile.querySelector('[data-slot="tree-item-label"]')) && !skillFile.querySelector(".lucide-scroll-text"))
    check("child rows preserve the shared file size column", skillFile.textContent!.includes("256 B"))
    await act(async () => { row("alpha/references").click() })
    await settle()
    const example = row("alpha/references/example.ts")
    check("compact nested rows use the matching sticky offset", getComputedStyle(row("alpha/references")).top === "26px" && row("alpha/references").getBoundingClientRect().height === 26 && example.getBoundingClientRect().height === 26)
    await act(async () => { example.click() })
    check("nested file selection opens its relative path", preview() === "alpha:references/example.ts:ready" && example.getAttribute("aria-selected") === "true")

    const beforeSwitch = previewSnapshots.length
    await act(async () => { row("beta").click() })
    check("switching never commits the previous resource under the new selection", previewSnapshots.slice(beforeSwitch).every((snapshot) => snapshot.selected !== "beta" || snapshot.data === null || snapshot.data === "beta"))
    await respond("beta")
    check("switching skills retains other expanded trees", row("alpha").getAttribute("aria-expanded") === "true" && row("alpha/references").getAttribute("aria-expanded") === "true" && row("alpha/references/example.ts") === example)
    check("switching skills clears the previous file selection", example.getAttribute("aria-selected") === "false" && preview() === "beta:SKILL.md:ready")
    const beforeCacheHit = previewSnapshots.length
    await act(async () => { row("alpha").click() })
    await settle()
    check("a resolved cache hit never commits a loading or stale preview", previewSnapshots.slice(beforeCacheHit).filter((snapshot) => snapshot.selected === "alpha").every((snapshot) => snapshot.data === "alpha" && !snapshot.loading))
    check("an expanded unselected skill can be collapsed", row("alpha").getAttribute("aria-expanded") === "false")
    await act(async () => { row("alpha").click() })
    await settle()
    check("collapse and reopen reuse mounted child rows", row("alpha/references/example.ts") === example && requests.length === 2)

    await key(row("gamma"), "ArrowRight")
    check("keyboard expansion loads an unopened skill", requests.join(",") === "alpha,beta,gamma")
    await respond("gamma", true)
    check("loading failures have an actionable retry", host.querySelector('[role="alert"]')?.textContent?.includes("Cannot read skill files") === true && Boolean(host.querySelector('[role="alert"] button')))
    await act(async () => { host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click() })
    for (const skill of skills) await respond(skill.id)
    check("refresh invalidates shared details and recovers errors", requests.length === 6 && !host.querySelector('[role="alert"]'))
    await key(row("gamma"), "ArrowLeft")
    await settle()
    check("keyboard collapse works after retry", row("gamma").getAttribute("aria-expanded") === "false")
    check("narrow tree rows fit the list width", Array.from(host.querySelectorAll<HTMLElement>('[data-slot="tree-item-label"]')).every((element) => element.getBoundingClientRect().right <= host.getBoundingClientRect().right))

    await act(async () => { root.render(<Harness key="mobile" mobile />) })
    await act(async () => { row("alpha").click() })
    await respond("alpha")
    check("mobile expands the skill without navigating away", row("alpha").getAttribute("aria-expanded") === "true" && preview() === "none")
    await act(async () => { row("alpha/SKILL.md").click() })
    check("mobile file selection opens the preview", preview() === "alpha:SKILL.md:ready")
    results.textContent = `PASS (${passed.length})\n${passed.join("\n")}`
  } catch (error) {
    results.textContent = `FAIL after ${passed.length} checks\n${error instanceof Error ? error.stack : String(error)}`
  } finally {
    await act(async () => { root.unmount() })
    window.fetch = originalFetch
  }
}

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true
  try { await runChecks() } finally { button.disabled = false }
})
