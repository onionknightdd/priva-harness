import * as React from "react"
import { createRoot } from "react-dom/client"
import "../../../src/i18n"
import "../../../src/index.css"
import type { ResourceSource, SkillDetail } from "../../../src/features/resources/resource-api"

const host = document.querySelector<HTMLDivElement>("#page")!
const results = document.querySelector<HTMLPreElement>("#results")!
const root = createRoot(host)
const live = new URLSearchParams(location.search).has("live")
const source: ResourceSource = { id: "global", harness: "claude", scope: "global", origin: "directory", label: "Global", path: "/fixture/skills", cwd: null, writable: true, canAdd: true }
const fixtureSkills: SkillDetail[] = Array.from({ length: 8 }, (_, index) => {
  const name = `fixture-skill-${index + 1}`
  const content = `# ${name}\n\n` + Array.from({ length: 14 }, (_, section) => `## Example ${section + 1}\n\nRead the **configuration**, inspect the result, and continue with the next step.\n\n- Preserve source grouping.\n- Load only the selected resource.\n\n\`\`\`typescript\n${Array.from({ length: 12 }, (_, line) => `const value${line} = { name: "${name}", enabled: true, step: ${section} };`).join("\n")}\n\`\`\`\n\n`).join("")
  return { id: name, name, description: "Performance fixture", sourceId: source.id, source, path: `/fixture/skills/${name}`, filePath: `/fixture/skills/${name}/SKILL.md`, enabled: true, canToggle: true, canDelete: true, toggleDescription: "", content, files: [{ path: "SKILL.md", size: content.length }] }
})

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true
  const measurements: { stage: string; contentMs: number; renderMs: number; maxRenderMs: number; commits: number; maxFrameMs: number; requests: { path: string; ms: number }[] }[] = []
  let current = { stage: "open page", contentMs: 0, renderMs: 0, maxRenderMs: 0, commits: 0, maxFrameMs: 0, requests: [] as { path: string; ms: number }[] }
  let lastFrame = performance.now()
  let frame = 0
  const tick = (now: number) => {
    current.maxFrameMs = Math.max(current.maxFrameMs, now - lastFrame)
    lastFrame = now
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  const originalFetch = window.fetch
  window.fetch = async (input, init) => {
    const path = input instanceof Request ? input.url : String(input)
    const started = performance.now()
    const url = new URL(path, location.href)
    let response: Response
    if (!live && url.pathname === "/api/sandbox/resource/skills") {
      response = Response.json({ groups: [{ source, items: fixtureSkills.map(({ content: _content, files: _files, source: _source, ...skill }) => skill) }], projects: [], diagnostics: [] })
    } else if (!live && url.pathname.startsWith("/api/sandbox/resource/skills/")) {
      const skill = fixtureSkills.find((entry) => entry.id === url.pathname.split("/").at(-1))
      response = skill ? Response.json(skill) : Response.json({ detail: "Unknown fixture" }, { status: 404 })
    } else response = await originalFetch(input, init)
    if (path.includes("/resource/")) current.requests.push({ path, ms: Math.round(performance.now() - started) })
    return response
  }
  const waitFor = async (ready: () => boolean) => {
    const start = performance.now()
    while (!ready()) {
      if (performance.now() - start > 15000) throw new Error("Timed out waiting for resource UI")
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  const stage = async (name: string, action: () => void | Promise<void>, ready: () => boolean) => {
    current = { stage: name, contentMs: 0, renderMs: 0, maxRenderMs: 0, commits: 0, maxFrameMs: 0, requests: [] }
    lastFrame = performance.now()
    const started = performance.now()
    await action()
    await waitFor(ready)
    current.contentMs = Math.round(performance.now() - started)
    await new Promise((resolve) => setTimeout(resolve, 350))
    measurements.push(current)
  }
  const roots = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="treeitem"][aria-level="1"]'))
  const rowName = (row: HTMLElement) => row.querySelector<HTMLElement>("[data-file-tree-name-text]")!.dataset.fileTreeNameText!
  const article = () => Array.from(host.querySelectorAll("article")).find((element) => element.getClientRects().length > 0)
  const previewReady = (name: string) => Boolean(host.querySelector(`h2[title="${name}"]`)?.getClientRects().length && article())
  const checks: string[] = []
  const check = (name: string, passed: boolean) => {
    if (!passed) throw new Error(name)
    checks.push(name)
  }
  try {
    results.textContent = "Running…"
    root.render(null)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await stage("open page", async () => {
      const { ResourceBrowser } = await import("../../../src/features/resources/resource-page")
      root.render(<React.Profiler id="resources" onRender={(_id, _phase, duration) => {
        current.renderMs += duration
        current.maxRenderMs = Math.max(current.maxRenderMs, duration)
        current.commits += 1
      }}><ResourceBrowser kind="skills" harness="claude" /></React.Profiler>)
    }, () => roots().length >= 2)
    const [first, second] = roots()
    await stage("first skill", () => first.click(), () => previewReady(rowName(first)))
    const firstArticle = article()
    await stage("second skill", () => second.click(), () => previewReady(rowName(second)))
    await stage("cached first skill", () => first.click(), () => previewReady(rowName(first)))
    check("switching back preserves the parsed preview DOM", article() === firstArticle)
    check("switching back issues no resource requests", measurements.at(-1)!.requests.length === 0)
    if (!live) {
      const [, , third, fourth] = roots()
      await stage("third skill", () => third.click(), () => previewReady(rowName(third)))
      await stage("fourth skill", () => fourth.click(), () => previewReady(rowName(fourth)))
      check("preview retention is bounded to three documents", host.querySelectorAll("article").length === 3)
      check("only the selected document is visible", Array.from(host.querySelectorAll("article")).filter((element) => element.getClientRects().length > 0).length === 1)
    }
    cancelAnimationFrame(frame)
    const timingResults = measurements.map((value) => ({ ...value, renderMs: Math.round(value.renderMs), maxRenderMs: Math.round(value.maxRenderMs), maxFrameMs: Math.round(value.maxFrameMs) }))
    if (!live) {
      const blocks = article()!.querySelectorAll<HTMLElement>('[data-slot="code-block-viewport"]')
      const hasTokens = (element: HTMLElement) => Boolean(element.querySelector('[style*="--shiki-light"]'))
      await waitFor(() => hasTokens(blocks[0]))
      check("offscreen code blocks defer syntax highlighting", !hasTokens(blocks[blocks.length - 1]))
      const pane = article()!.closest<HTMLElement>('[data-slot="tabs-content"]')!
      pane.scrollTop = pane.scrollHeight
      await waitFor(() => hasTokens(blocks[blocks.length - 1]))
      check("scrolling reveals syntax colors without replacing code content", blocks[blocks.length - 1].textContent!.includes("const value11"))
      const { highlightAgentCode } = await import("../../../src/components/agents/agent-shiki")
      const [python, unknown, diff] = await Promise.all([
        highlightAgentCode('print("ready")', "python"),
        highlightAgentCode("plain content", "fixture-unknown-language"),
        highlightAgentCode("const value = 1 // [!code ++]", "typescript", { notationDiff: true }),
      ])
      check("on-demand languages retain light and dark syntax tokens", python?.language === "python" && JSON.stringify(python.lines).includes("--shiki-light") && JSON.stringify(python.lines).includes("--shiki-dark"))
      check("unknown languages still display plain text", unknown?.language === "text" && unknown.lines.length === 1)
      check("on-demand highlighting preserves notation diff", diff?.lines[0]?.isAdd === true)
    }
    results.textContent = `PASS (${checks.length})\n${checks.join("\n")}\n` + JSON.stringify(timingResults, null, 2)
  } catch (error) {
    results.textContent = `${error instanceof Error ? error.stack : String(error)}\n${JSON.stringify(measurements)}`
  } finally {
    cancelAnimationFrame(frame)
    window.fetch = originalFetch
    button.disabled = false
  }
})
