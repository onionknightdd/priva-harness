import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createInstance } from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"

import { SidebarProvider } from "../../../src/components/ui/sidebar"
import { TooltipProvider } from "../../../src/components/ui/tooltip"
import { AssistantFileReference } from "../../../src/features/agent-message/components/assistant-file-reference"
import { rememberFileExists } from "../../../src/features/files/file-existence"
import { useOptionalWorkspaceFiles, WorkspaceFilesProvider } from "../../../src/features/workspace/workspace-files-context"
import { en } from "../../../src/i18n/locales/en"

function OpenedFile() {
  return <output>{useOptionalWorkspaceFiles()?.pendingFilePath}</output>
}

export async function runFilePathLinkChecks(check: (name: string, condition: boolean) => void) {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const originalFetch = globalThis.fetch
  const pending = new Map<string, (response: Response) => void>()
  const prefix = `/tooltip-fixture/${crypto.randomUUID()}/`
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } })

  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href)
    const path = url.searchParams.get("path") ?? ""
    return url.pathname === "/api/sandbox/files/preview" && path.startsWith(prefix)
      ? new Promise((resolve) => pending.set(path, resolve))
      : originalFetch(input, init)
  }

  const wait = async (ms: number) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) }
  const trigger = () => host.querySelector<HTMLElement>("[data-base-ui-tooltip-trigger]")!
  const hint = () => document.querySelector<HTMLElement>('[data-slot="tooltip-content"][data-open]')
  const hover = async (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const coordinates = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
    await act(async () => {
      const target = element.querySelector("button > span") ?? element
      target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", ...coordinates }))
      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, ...coordinates }))
      element.dispatchEvent(new MouseEvent("mouseenter", coordinates))
      target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, ...coordinates }))
    })
  }
  const leave = async (element: HTMLElement) => {
    const coordinates = { clientX: innerWidth - 2, clientY: innerHeight - 2, relatedTarget: document.body }
    await act(async () => {
      element.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", ...coordinates }))
      element.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, ...coordinates }))
      element.dispatchEvent(new MouseEvent("mouseleave", coordinates))
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, ...coordinates }))
    })
    await wait(450)
  }
  const resolve = async (path: string, exists = true) => {
    const respond = pending.get(path)
    if (!respond) throw new Error(`Missing preview request: ${path}`)
    await act(async () => {
      respond(exists
        ? Response.json({ path, name: "file.ts", mime_type: "text/plain", size: 1, content: "x", is_binary: false, preview_url: null, preview_error: null })
        : Response.json({ detail: "Not found" }, { status: 404 }))
    })
  }

  try {
    for (const scenario of ["resolved-before-hover", "resolved-during-hover", "missing", "cached"] as const) {
      const path = `${prefix}${scenario}.ts`
      if (scenario === "cached") rememberFileExists(path, true)
      await act(async () => root.render(
        <StrictMode><I18nextProvider i18n={i18n}><TooltipProvider key={path}>
          <SidebarProvider className="block min-h-0" stateCookieName={false} widthCookieName={false}>
            <WorkspaceFilesProvider>
              <AssistantFileReference path={path} label={`${scenario}.ts`} />
              <OpenedFile />
            </WorkspaceFilesProvider>
          </SidebarProvider>
        </TooltipProvider></I18nextProvider></StrictMode>
      ))
      const initialTrigger = trigger()
      if (scenario === "resolved-during-hover") {
        await hover(initialTrigger)
        await wait(100)
      }
      if (scenario !== "cached") await resolve(path, scenario !== "missing")
      if (scenario !== "resolved-during-hover") await hover(trigger())
      await wait(1100)
      check(`${scenario}: hover shows the absolute path`, hint()?.textContent === path)
      check(`${scenario}: the hover target survives file resolution`, trigger() === initialTrigger)
      check(`${scenario}: file availability controls the open action`, Boolean(host.querySelector("button")) === (scenario !== "missing"))

      await leave(trigger())
      check(`${scenario}: leaving closes the hint`, !hint())
      if (scenario === "resolved-before-hover") {
        await hover(trigger())
        await wait(1100)
        check("resolved file hints reopen on subsequent hover", hint()?.textContent === path)
        await act(async () => host.querySelector<HTMLButtonElement>("button")!.click())
        check("click still opens the absolute path in Workspace", host.querySelector("output")?.textContent === path)
        await leave(trigger())
      }
    }
  } finally {
    await act(async () => root.unmount())
    host.remove()
    globalThis.fetch = originalFetch
  }
}
