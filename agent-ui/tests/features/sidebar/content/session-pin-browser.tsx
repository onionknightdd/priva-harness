import * as React from "react"
import { createInstance } from "i18next"
import { MotionConfig, motion } from "motion/react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { I18nextProvider, initReactI18next } from "react-i18next"

import { SidebarContent, SidebarProvider } from "../../../../src/components/ui/sidebar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../../../../src/components/ui/dropdown-menu"
import { TooltipProvider } from "../../../../src/components/ui/tooltip"
import { ChatSessionProvider, SessionMenuItems, useSessionList } from "../../../../src/features/chat-session"
import { AgentPreferencesProvider } from "../../../../src/features/settings/agent-preferences-context"
import { NavProjects } from "../../../../src/features/sidebar/content/nav-projects"
import { HarnessProvider } from "../../../../src/features/sidebar/header/harness-context"
import { en } from "../../../../src/i18n/locales/en"
import { zhCN } from "../../../../src/i18n/locales/zh-CN"
import { installSessionPinFixtures } from "./session-pin-fixtures"
import "../../../../src/index.css"

const query = new URLSearchParams(location.search)
const reducedMotion = query.has("reduced-motion")
const mobile = query.has("mobile")
document.documentElement.classList.toggle("dark", query.has("dark"))
if (reducedMotion) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (media) => media.includes("prefers-reduced-motion")
    ? Object.assign(new EventTarget(), { matches: true, media, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList
    : matchMedia(media)
}

const host = document.querySelector<HTMLDivElement>("#fixtures")!
const results = document.querySelector<HTMLPreElement>("#results")!
const runButton = document.querySelector<HTMLButtonElement>("#run")!
const focusButton = document.querySelector<HTMLButtonElement>("#focus-pin")!
const nextFrame = () => new Promise<number>(requestAnimationFrame)
const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))
const MotionSidebarContent = motion.create(SidebarContent)

export function HeaderMenuFixture() {
  const { groups } = useSessionList()
  const session = groups.flatMap((group) => group.sessions).find((item) => item.sessionId === "recent-1")
  if (!session) return null
  return <DropdownMenu>
    <DropdownMenuTrigger data-header-menu-fixture>Header actions fixture</DropdownMenuTrigger>
    <DropdownMenuContent><SessionMenuItems session={session} /></DropdownMenuContent>
  </DropdownMenu>
}

export function Fixtures({ i18n, onSelectSession }: {
  i18n: ReturnType<typeof createInstance>
  onSelectSession: React.ComponentProps<typeof NavProjects>["onSelectSession"]
}) {
  return <I18nextProvider i18n={i18n}>
    <MotionConfig reducedMotion={reducedMotion ? "always" : "user"}>
      <AgentPreferencesProvider><HarnessProvider><ChatSessionProvider><TooltipProvider>
        <SidebarProvider className="bg-sidebar text-sidebar-foreground" keyboardShortcut={false} stateCookieName={false} widthCookieName={false} style={{ minHeight: 0, width: "100%" }}>
          <MotionSidebarContent layoutScroll style={{ maxHeight: 360 }}>
            <NavProjects onSelectSession={onSelectSession} onCreateSession={() => undefined} />
          </MotionSidebarContent>
        </SidebarProvider>
        <HeaderMenuFixture />
      </TooltipProvider></ChatSessionProvider></HarnessProvider></AgentPreferencesProvider>
    </MotionConfig>
  </I18nextProvider>
}

// Use a real 390px viewport without resizing another application tab.
if (mobile && !query.has("frame")) {
  const frame = document.createElement("iframe")
  const childUrl = new URL(location.href)
  childUrl.searchParams.set("frame", "1")
  frame.src = childUrl.href
  frame.id = "mobile-frame"
  frame.title = "390px session pin fixture"
  frame.style.width = `${Number(query.get("mobile")) || 390}px`
  host.replaceWith(frame)
  focusButton.hidden = true
  document.querySelector("#keyboard-hint")!.remove()
  results.textContent = "Ready: checks run in the narrow iframe"
  runButton.addEventListener("click", () => frame.contentDocument?.querySelector<HTMLButtonElement>("#run")?.click())
  window.addEventListener("message", (event) => {
    if (event.source === frame.contentWindow && event.data?.type === "session-pin-results") results.textContent = String(event.data.text)
  })
} else {
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({
    lng: query.has("zh") ? "zh-CN" : "en",
    resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
    interpolation: { escapeValue: false },
  })
  const fixture = installSessionPinFixtures()
  const root = createRoot(host)
  const selected: string[] = []
  let epoch = 0
  let motionDiagnostics: { elapsed: number; top: number; scrollTop: number; scrollY: number; transform: string }[] = []
  const t = i18n.t.bind(i18n)

  function render() {
    flushSync(() => root.render(<Fixtures key={epoch} i18n={i18n}
      onSelectSession={(session) => { selected.push(session.sessionId); updateSelectionCount() }} />))
  }
  function row(id: string) { return host.querySelector<HTMLLIElement>(`[data-session-id="${id}"]`) }
  function section(kind: "pinned" | "unpinned") {
    return host.querySelector<HTMLLIElement>(`[data-session-section="${kind}"]`)
  }
  function sectionTitle(kind: "pinned" | "unpinned") {
    return section(kind)?.querySelector<HTMLElement>("[data-session-section-title]")
  }
  function titleButton(id: string) { return row(id)!.querySelector<HTMLButtonElement>('[data-sidebar="menu-sub-button"]')! }
  function pinButton(id: string) {
    return [...row(id)!.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      [t("sidebar.projects.pin"), t("sidebar.projects.unpin")].includes(button.getAttribute("aria-label") ?? ""))!
  }
  function visibleIds() {
    return [...host.querySelectorAll<HTMLElement>('[data-session-id]:not([data-exiting="true"])')]
      .map((element) => element.dataset.sessionId).filter((id) => id !== "other-project")
  }
  function updateSelectionCount() {
    document.querySelector("#keyboard-hint")!.setAttribute("data-selected-sessions", String(selected.length))
    document.querySelector("#keyboard-hint")!.textContent = `Keyboard check: focus a pin, then press Space and Enter. Selected sessions: ${selected.length}.`
  }
  async function until(condition: () => unknown, message: string, timeout = 5000) {
    const started = performance.now()
    while (!condition()) {
      if (performance.now() - started > timeout) throw new Error(`Timed out: ${message}`)
      await wait()
    }
  }
  async function reset(pinnedIds?: readonly string[]) {
    fixture.reset(pinnedIds)
    selected.length = 0
    epoch += 1
    render()
    updateSelectionCount()
    await until(() => row("recent-3") && row("other-project"), "initial isolated sessions")
    await wait(600)
  }
  async function arm(id: string) {
    titleButton(id).focus({ preventScroll: true })
    await nextFrame()
    await nextFrame()
  }
  async function motionSamples(id: string, mutate: () => void) {
    const samples: number[] = []
    motionDiagnostics = []
    const started = performance.now()
    mutate()
    do {
      await nextFrame()
      const item = row(id)
      if (item) {
        const top = item.getBoundingClientRect().top
        samples.push(top)
        motionDiagnostics.push({ elapsed: Math.round(performance.now() - started), top,
          scrollTop: host.querySelector<HTMLElement>('[data-sidebar="content"]')!.scrollTop,
          scrollY: window.scrollY, transform: getComputedStyle(item).transform })
      }
    } while (performance.now() - started < 1000)
    return samples
  }

  async function runChecks() {
    const passed: string[] = []
    const check = (name: string, condition: unknown, details?: unknown) => {
      if (!condition) throw new Error(`${name}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`)
      passed.push(name)
    }
    results.textContent = "Running…"
    try {
      await reset()
      check("the normal list keeps five sessions plus its independent project", visibleIds().length === 5 && Boolean(row("other-project")))
      const pinnedTitle = sectionTitle("pinned")!
      const unpinnedTitle = sectionTitle("unpinned")!
      check("a project with pins shows the two localized section titles", pinnedTitle?.textContent === (query.has("zh") ? "置顶" : "Pinned") && unpinnedTitle?.textContent === (query.has("zh") ? "未置顶" : "Unpinned"))
      check("section titles use h4, 12px type, and the shared tertiary text token", [pinnedTitle, unpinnedTitle].every((title) => title.tagName === "H4" && getComputedStyle(title).fontSize === "12px" && title.classList.contains("text-xs") && title.classList.contains("text-muted-foreground/60")))
      check("section titles and sessions share one flat semantic list", row("old-pinned")!.parentElement?.tagName === "UL" && section("pinned")?.parentElement === row("old-pinned")!.parentElement && section("unpinned")?.parentElement === row("old-pinned")!.parentElement && [...row("old-pinned")!.parentElement!.children].every((child) => child.tagName === "LI"))
      check("the pinned title is followed by its first row with an 8px gap", section("pinned")?.nextElementSibling === row("old-pinned") && Math.abs(row("old-pinned")!.getBoundingClientRect().top - pinnedTitle.getBoundingClientRect().bottom - 8) < 1)
      check("the unpinned title is followed by its first row with an 8px gap", section("unpinned")?.nextElementSibling === row("recent-1") && Math.abs(row("recent-1")!.getBoundingClientRect().top - unpinnedTitle.getBoundingClientRect().bottom - 8) < 1)
      check("the two sections are separated by 8px", section("unpinned")?.previousElementSibling === row("old-pinned") && Math.abs(unpinnedTitle.getBoundingClientRect().top - row("old-pinned")!.getBoundingClientRect().bottom - 8) < 1)
      check("the project without pins has no section titles", !row("other-project")!.parentElement!.querySelector("[data-session-section]"))
      await arm("recent-3")
      const actionLabels = [...row("recent-3")!.querySelectorAll<HTMLButtonElement>("button[aria-label]")].map((button) => button.getAttribute("aria-label"))
      check("session actions are Tag, Pin, More", actionLabels.join() === [t("sidebar.projects.tag"), t("sidebar.projects.pin"), t("common.more")].join())
      const pinBounds = pinButton("recent-3").getBoundingClientRect()
      check("pin reuses the compact 20px action size", pinBounds.width === 20 && pinBounds.height === 20)
      check("pin exposes its current unpressed state", pinButton("recent-3").getAttribute("aria-pressed") === "false")

      const before = row("recent-3")!.getBoundingClientRect().top
      const originalRow = row("recent-3")!
      const otherProject = row("other-project")!
      const oldPinnedTop = row("old-pinned")!.getBoundingClientRect().top
      const pinnedFirstRowTop = pinnedTitle.getBoundingClientRect().bottom + 8
      const samples = await motionSamples("recent-3", () => flushSync(() => pinButton("recent-3").click()))
      const after = row("recent-3")!.getBoundingClientRect().top
      check("pin moves the session first without selecting it", visibleIds()[0] === "recent-3" && selected.length === 0)
      check("pin preserves both session and unrelated project nodes", row("recent-3") === originalRow && row("other-project") === otherProject)
      check("pin persists once through the real session callback", fixture.requests.filter((request) => request.path.endsWith("/recent-3/pin") && request.pinned).length === 1)
      check("pin exposes the pressed state and unpin action", pinButton("recent-3").getAttribute("aria-pressed") === "true" && pinButton("recent-3").getAttribute("aria-label") === t("sidebar.projects.unpin"))
      check("pin moves to the first row beneath its own pinned title", after < before - 20 && Math.abs(after - pinnedFirstRowTop) < 1)
      check(reducedMotion ? "reduced motion reaches the final row position immediately" : "pin glides through intermediate row positions", reducedMotion
        ? samples.every((top) => Math.abs(top - after) < 1)
        : samples.some((top) => top > after + 2 && top < before - 2),
      { before, after, oldPinnedTop, pinnedFirstRowTop, mediaMatches: matchMedia("(prefers-reduced-motion: reduce)").matches,
        viewport: { width: innerWidth, height: innerHeight }, samples: motionDiagnostics.slice(0, 12), lastSample: motionDiagnostics.at(-1) })

      pinButton("recent-3").focus()
      const focusedPin = pinButton("recent-3")
      const returnSamples = await motionSamples("recent-3", () => flushSync(() => focusedPin.click()))
      const returned = row("recent-3")!.getBoundingClientRect().top
      check("unpin restores recency order without selecting", visibleIds().join() === "old-pinned,recent-1,recent-2,recent-3,recent-4" && selected.length === 0)
      check("unpin restores the original position below the unpinned title", Math.abs(returned - before) < 1)
      check("a focused pin remains focused when its row changes position", document.activeElement === focusedPin)
      check(reducedMotion ? "reduced motion restores order immediately" : "unpin glides back through intermediate positions", reducedMotion
        ? returnSamples.every((top) => Math.abs(top - returned) < 1)
        : returnSamples.some((top) => top > after + 2 && top < returned - 2),
      { after, returned, samples: motionDiagnostics.slice(0, 12), lastSample: motionDiagnostics.at(-1) })

      flushSync(() => pinButton("recent-3").click())
      await wait(35)
      flushSync(() => pinButton("recent-3").click())
      await wait(1100)
      check("a rapid pin and unpin reversal settles in recency order", visibleIds().join() === "old-pinned,recent-1,recent-2,recent-3,recent-4")
      check("rapid reversal preserves one original session node without selection", row("recent-3") === originalRow && host.querySelectorAll('[data-session-id="recent-3"]').length === 1 && selected.length === 0)

      await arm("old-pinned")
      pinButton("old-pinned").focus({ preventScroll: true })
      const exitTop = row("old-pinned")!.getBoundingClientRect().top
      flushSync(() => pinButton("old-pinned").click())
      await nextFrame()
      check(reducedMotion ? "reduced motion removes a row outside the five-session range immediately" : "a row leaving the five-session range stays mounted during exit", reducedMotion
        ? !row("old-pinned")
        : row("old-pinned")?.dataset.exiting === "true")
      if (!reducedMotion) {
        const exiting = row("old-pinned")!
        check("the exiting row is inert and hidden from assistive technology", exiting.inert && exiting.getAttribute("aria-hidden") === "true")
        const exitSamples: { opacity: number; top: number }[] = []
        const started = performance.now()
        while (row("old-pinned") && performance.now() - started < 400) {
          const item = row("old-pinned")!
          exitSamples.push({ opacity: Number(getComputedStyle(item).opacity), top: item.getBoundingClientRect().top })
          await nextFrame()
        }
        check("the departing row fades through intermediate opacity", exitSamples.some((sample) => sample.opacity > 0 && sample.opacity < 0.8))
        check("the departing row moves downward before releasing its DOM", exitSamples.some((sample) => sample.top > exitTop + 4))
      }
      await until(() => !row("old-pinned"), "exiting session releases its DOM")
      await until(() => !host.querySelector("[data-session-section]"), "the final pin removes both section titles")
      check("exit completes with exactly five visible sessions", visibleIds().join() === "recent-1,recent-2,recent-3,recent-4,recent-5")
      check("cancelling the final pin removes both titles while retaining its project", !section("pinned") && !section("unpinned") && Boolean(row("recent-1")))
      check("completed exit leaves no stale session or exiting nodes", !row("old-pinned") && !host.querySelector('[data-exiting="true"]'))
      check("a departing focused pin transfers focus to its same-project replacement", document.activeElement === pinButton("recent-1") && document.activeElement !== document.body)
      check("exit does not select the departing session", selected.length === 0)

      await arm("recent-2")
      const title = titleButton("recent-2").querySelector("span:last-child")!
      const tag = row("recent-2")!.querySelector<HTMLButtonElement>(`button[aria-label="${t("sidebar.projects.tag")}"]`)!
      check("long session titles reserve room for all three actions", title.getBoundingClientRect().right <= tag.getBoundingClientRect().left + 1)
      check("narrow sidebar has no horizontal overflow", host.scrollWidth <= host.clientWidth && document.documentElement.scrollWidth <= document.documentElement.clientWidth)

      const more = row("recent-2")!.querySelector<HTMLButtonElement>(`button[aria-label="${t("common.more")}"]`)!
      more.click()
      await until(() => document.querySelector('[role="menuitem"]'), "session action menu opens")
      const menuItems = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((element) => element.textContent?.trim())
      check("sidebar more menu retains archive and delete while pin is outside", menuItems.join() === [t("sidebar.projects.archive"), t("sidebar.projects.delete")].join())
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await until(() => !document.querySelector('[role="menuitem"]'), "Escape closes the action menu")
      check("menu Escape restores focus to More", document.activeElement === more)

      host.querySelector<HTMLButtonElement>("[data-header-menu-fixture]")!.click()
      await until(() => document.querySelector('[role="menuitem"]'), "shared header fixture menu opens")
      const headerPin = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent?.trim() === t("sidebar.projects.pin"))
      check("the shared menu retains Pin by default for the chat header", Boolean(headerPin))
      headerPin!.click()
      await until(() => pinButton("recent-1").getAttribute("aria-pressed") === "true", "shared header Pin updates the sidebar")
      check("the retained header Pin uses the existing persistence callback", fixture.requests.some((request) => request.path.endsWith("/recent-1/pin") && request.pinned))

      await reset([])
      check("a project with no pins has neither section title", !section("pinned") && !section("unpinned") && visibleIds().join() === "recent-1,recent-2,recent-3,recent-4,recent-5")
      await arm("recent-3")
      const firstPinnedRow = row("recent-3")!
      const firstPinnedControl = pinButton("recent-3")
      firstPinnedControl.focus({ preventScroll: true })
      const firstPinStart = firstPinnedRow.getBoundingClientRect().top
      const firstPinSamples = await motionSamples("recent-3", () => flushSync(() => firstPinnedControl.click()))
      const firstPinEnd = row("recent-3")!.getBoundingClientRect().top
      check("the first pin inserts both section titles and moves beneath Pinned", Boolean(section("pinned") && section("unpinned")) && visibleIds()[0] === "recent-3" && Math.abs(firstPinEnd - sectionTitle("pinned")!.getBoundingClientRect().bottom - 8) < 1)
      check("inserting section titles preserves the original row, pin control, and focus", row("recent-3") === firstPinnedRow && pinButton("recent-3") === firstPinnedControl && document.activeElement === firstPinnedControl && selected.length === 0)
      check(reducedMotion ? "the first pin inserts titles and reaches its final position immediately" : "the first pin glides while inserting the section titles", reducedMotion
        ? firstPinSamples.every((top) => Math.abs(top - firstPinEnd) < 1)
        : firstPinSamples.some((top) => top > firstPinEnd + 2 && top < firstPinStart - 2),
      { firstPinStart, firstPinEnd, samples: motionDiagnostics.slice(0, 12), lastSample: motionDiagnostics.at(-1) })

      const lastUnpinSamples = await motionSamples("recent-3", () => flushSync(() => firstPinnedControl.click()))
      const lastUnpinEnd = row("recent-3")!.getBoundingClientRect().top
      check("unpinning the last visible pin removes both titles and restores its position", !section("pinned") && !section("unpinned") && visibleIds().join() === "recent-1,recent-2,recent-3,recent-4,recent-5" && Math.abs(lastUnpinEnd - firstPinStart) < 1)
      check("removing section titles preserves the original row, pin control, and focus", row("recent-3") === firstPinnedRow && pinButton("recent-3") === firstPinnedControl && document.activeElement === firstPinnedControl && selected.length === 0)
      check(reducedMotion ? "the last visible unpin removes titles and reaches its final position immediately" : "the last visible unpin glides while removing the section titles", reducedMotion
        ? lastUnpinSamples.every((top) => Math.abs(top - lastUnpinEnd) < 1)
        : lastUnpinSamples.some((top) => top > firstPinEnd + 2 && top < lastUnpinEnd - 2),
      { firstPinEnd, lastUnpinEnd, samples: motionDiagnostics.slice(0, 12), lastSample: motionDiagnostics.at(-1) })

      await reset(["recent-1", "recent-2", "recent-3", "recent-4", "recent-5"])
      check("five pinned sessions still share the original five-row limit", visibleIds().join() === "recent-1,recent-2,recent-3,recent-4,recent-5" && visibleIds().every((id) => pinButton(id!).getAttribute("aria-pressed") === "true"))
      check("the unpinned title remains when every visible session is pinned", Boolean(sectionTitle("pinned") && sectionTitle("unpinned")) && section("unpinned")?.previousElementSibling === row("recent-5") && !section("unpinned")?.nextElementSibling?.hasAttribute("data-session-id"))
      check("the empty visible unpinned section keeps its 8px separation", Math.abs(sectionTitle("unpinned")!.getBoundingClientRect().top - row("recent-5")!.getBoundingClientRect().bottom - 8) < 1)
      const moreSessions = [...row("recent-1")!.parentElement!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === t("sidebar.projects.moreSessions"))!
      check("section titles do not hide the existing More action", Boolean(moreSessions))
      moreSessions.click()
      await until(() => row("recent-6") && row("old-pinned"), "More expands the remaining sessions")
      await wait(600)
      check("More expands the combined pinned and unpinned list to seven sessions", visibleIds().length === 7 && row("recent-6")!.previousElementSibling === section("unpinned"))
      check("the newly revealed unpinned row retains an 8px title gap", Math.abs(row("recent-6")!.getBoundingClientRect().top - sectionTitle("unpinned")!.getBoundingClientRect().bottom - 8) < 1)

      await reset()
      const scroller = host.querySelector<HTMLElement>('[data-sidebar="content"]')!
      scroller.style.maxHeight = "220px"
      scroller.scrollTop = 64
      await nextFrame()
      await nextFrame()
      await arm("recent-3")
      const scrollTop = scroller.scrollTop
      const scrolledStart = row("recent-3")!.getBoundingClientRect().top
      const scrolledTarget = sectionTitle("pinned")!.getBoundingClientRect().bottom + 8
      check("scroll regression runs inside an actually scrolled sidebar", scrollTop > 0 && scroller.scrollHeight > scroller.clientHeight)
      const scrollSamples = await motionSamples("recent-3", () => flushSync(() => pinButton("recent-3").click()))
      const scrolledEnd = row("recent-3")!.getBoundingClientRect().top
      check("pin retains the sidebar scroll offset", Math.abs(scroller.scrollTop - scrollTop) < 1)
      check("a scrolled pin settles at the existing pinned position", Math.abs(scrolledEnd - scrolledTarget) < 1)
      check(reducedMotion ? "reduced motion has no scrolled-row projection offset" : "scroll-aware layout preserves the starting visual position", reducedMotion
        ? scrollSamples.every((top) => Math.abs(top - scrolledEnd) < 1)
        : Math.abs(scrollSamples[0] - scrolledStart) < 12 && scrollSamples.some((top) => top > scrolledEnd + 2 && top < scrolledStart - 2))
      check("all API calls were isolated fixture requests", fixture.unexpected.length === 0)

      results.textContent = `PASS (${passed.length}, ${reducedMotion ? "reduced motion" : "normal motion"}${query.has("dark") ? ", dark" : ""}${mobile ? ", 390px" : ""})\n${passed.join("\n")}`
    } catch (error) {
      results.textContent = `FAIL after ${passed.length} checks\n${error instanceof Error ? error.stack : String(error)}`
    } finally {
      parent.postMessage({ type: "session-pin-results", text: results.textContent }, location.origin)
      await reset()
    }
  }

  render()
  updateSelectionCount()
  focusButton.addEventListener("click", async () => { await arm("recent-3"); pinButton("recent-3").focus() })
  runButton.addEventListener("click", async () => {
    runButton.disabled = true
    try { await runChecks() } finally { runButton.disabled = false }
  })
  window.addEventListener("pagehide", () => fixture.restore(), { once: true })
  if (query.has("auto")) {
    await until(() => row("recent-3"), "automatic initial load")
    runButton.click()
  }
}
