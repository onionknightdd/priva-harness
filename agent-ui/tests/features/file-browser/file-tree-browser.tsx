import { act } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/i18n"
import "../../../src/index.css"
import { FileBrowserTree } from "../../../src/features/file-browser/components/file-browser-tree"
import {
  emptyFileBrowserModel,
  type FileBrowserItem,
  type FileBrowserModel,
} from "../../../src/features/file-browser/file-browser-data"
import { createFileTreeNameMeasurer } from "../../../src/features/file-browser/file-tree-content-width"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).has("dark"))

function item(path: string, type: FileBrowserItem["type"]): FileBrowserItem {
  return {
    path,
    name: path.split("/").at(-1)!,
    parentPath: path.slice(0, path.lastIndexOf("/")) || null,
    type,
    size: type === "file" ? 100 : null,
    modifiedAt: null,
    permissions: null,
  }
}

const entries = [
  item("/workspace", "folder"),
  item("/workspace/src", "folder"),
  item("/workspace/src/alpha.ts", "file"),
  item("/workspace/src/beta.ts", "file"),
  item("/workspace/docs", "folder"),
]
const initialModel: FileBrowserModel = {
  items: {
    ...emptyFileBrowserModel.items,
    ...Object.fromEntries(entries.map((entry) => [entry.path, entry])),
  },
  childrenByPath: {
    "/workspace": ["/workspace/src", "/workspace/docs"],
    "/workspace/src": ["/workspace/src/alpha.ts", "/workspace/src/beta.ts"],
    "/workspace/docs": [],
  },
}
const noAction = () => undefined
const selectItem = async () => undefined
const noLoading = new Set<string>()

async function runChecks() {
  const results = document.querySelector<HTMLPreElement>("#results")!
  const host = document.querySelector<HTMLDivElement>("#tree")!
  const root = createRoot(host)
  const passed: string[] = []
  const check = (name: string, condition: boolean) => {
    if (!condition) throw new Error(name)
    passed.push(name)
  }
  const row = (path: string) => {
    const element = host.querySelector<HTMLButtonElement>(
      `[data-file-tree-item-id="${path}"]`
    )
    if (!element) throw new Error(`Missing row: ${path}`)
    return element
  }
  const pressKey = (element: HTMLElement, key: string) => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
    element.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }))
  }
  const render = async (
    model = initialModel,
    query = "",
    loadingDirectories = noLoading,
    selectedItemPath: string | null = null
  ) => {
    await act(async () => {
      root.render(
        <FileBrowserTree
          compact
          model={model}
          query={query}
          loadingDirectories={loadingDirectories}
          rootPath="/workspace"
          selectedItemPath={selectedItemPath}
          onActionFeedback={noAction}
          onDeleteRequest={noAction}
          onDownload={noAction}
          onItemSelect={selectItem}
          onUpload={noAction}
        />
      )
    })
  }
  const settle = async () => {
    // Flush React between frames so Base UI can enter and finish the native
    // CSS transition, rather than batching its ending phase until after a wait.
    for (let frame = 0; frame < 10; frame += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
    }
  }

  try {
    results.textContent = "Running…"
    await render()
    await settle()
    const src = row("/workspace/src")
    const docs = row("/workspace/docs")
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches
    const missing = (path: string) => !host.querySelector(`[data-file-tree-item-id="${path}"]`)
    await act(async () => { src.click() })
    check("rows revealed by an expansion fade in", row("/workspace/src/alpha.ts").dataset.entering === "true" && (reducedMotion || getComputedStyle(row("/workspace/src/alpha.ts")).animationName === "file-tree-row-enter") && docs.dataset.entering !== "true")
    await settle()
    let alpha = row("/workspace/src/alpha.ts")
    check("the entering state ends with the animation", alpha.dataset.entering !== "true")
    const label = alpha.querySelector<HTMLElement>('[data-slot="tree-item-label"]')!
    check("shared file trees use 26px rows with 3px vertical padding", label.getBoundingClientRect().height === 26 && getComputedStyle(label).paddingTop === "3px" && getComputedStyle(label).paddingBottom === "3px")
    check("shared file trees use 1px gaps and matching nested sticky offsets", Math.abs(row("/workspace/src/beta.ts").getBoundingClientRect().top - alpha.getBoundingClientRect().bottom - 1) < 0.1 && getComputedStyle(src).position === "absolute" && getComputedStyle(src).top === "27px" && getComputedStyle(docs).top === "108px")
    check("the list is as tall as its rows", src.parentElement!.getBoundingClientRect().height === 5 * 27 - 1)
    check("rows are a flat list with their level, position and set size", src.parentElement === alpha.parentElement && src.getAttribute("aria-expanded") === "true" && alpha.getAttribute("aria-level") === "3" && alpha.getAttribute("aria-posinset") === "1" && alpha.getAttribute("aria-setsize") === "2")
    check("each row draws one indent guide per ancestor level", alpha.querySelectorAll('[data-slot="file-tree-indent-line"]').length === 2 && src.querySelectorAll('[data-slot="file-tree-indent-line"]').length === 1 && row("/workspace").querySelectorAll('[data-slot="file-tree-indent-line"]').length === 0)

    await act(async () => { src.click() })
    await settle()
    check("collapsed descendants leave the list", missing("/workspace/src/alpha.ts") && docs.getBoundingClientRect().top - src.getBoundingClientRect().bottom === 1)
    check("sibling rows retain their DOM identity", row("/workspace/docs") === docs && row("/workspace/src") === src)
    await act(async () => { src.click() })
    await settle()
    alpha = row("/workspace/src/alpha.ts")
    check("reopening shows the children again", alpha.getBoundingClientRect().top - src.getBoundingClientRect().bottom === 1)

    await act(async () => { alpha.click() })
    check("selection moves to the clicked file", alpha.getAttribute("aria-selected") === "true" && src.getAttribute("aria-selected") === "false")
    await act(async () => {
      pressKey(alpha, "ArrowDown")
    })
    check("keyboard focus updates the next memoized row", row("/workspace/src/beta.ts").dataset.focus === "true" && alpha.dataset.focus === "false")
    // Headless Tree moves DOM focus on a short poll. Let each move land, as it
    // does between real key presses, before the row it targets can go away.
    await settle()
    await act(async () => {
      pressKey(row("/workspace/src/beta.ts"), "ArrowLeft")
    })
    check("keyboard left moves focus to the parent folder", src.dataset.focus === "true")
    await settle()
    check("DOM focus follows the focused row", document.activeElement === src)
    await act(async () => {
      pressKey(src, "ArrowLeft")
    })
    await settle()
    check("keyboard collapse updates aria-expanded", src.getAttribute("aria-expanded") === "false" && missing("/workspace/src/alpha.ts"))
    await act(async () => {
      pressKey(src, "ArrowRight")
    })
    await settle()
    alpha = row("/workspace/src/alpha.ts")
    check("keyboard expand reveals the children", src.getAttribute("aria-expanded") === "true")

    const extra = item("/workspace/src/gamma.ts", "file")
    const updatedModel = {
      items: { ...initialModel.items, [extra.path]: extra },
      childrenByPath: {
        ...initialModel.childrenByPath,
        "/workspace/src": [extra.path, ...initialModel.childrenByPath["/workspace/src"]],
      },
    }
    await render(updatedModel)
    check("directory updates refresh sibling positions", alpha.getAttribute("aria-posinset") === "2" && alpha.getAttribute("aria-setsize") === "3")
    await render(updatedModel, "alpha")
    await settle()
    check("search highlights refresh on memoized rows", alpha.dataset.searchMatch === "true" && row(extra.path).dataset.searchMatch === "false")
    await render(updatedModel, "", new Set(["/workspace/src"]))
    check("loading state reaches the memoized folder", src.getAttribute("aria-busy") === "true")
    await render(updatedModel)
    check("completed loading removes the busy state", !src.hasAttribute("aria-busy"))

    const empty = item("/workspace/src/empty", "folder")
    const closedFolders = Array.from({ length: 12 }, (_, index) => item(`/workspace/src/closed-${index}`, "folder"))
    const followingFolders = Array.from({ length: 20 }, (_, index) => item(`/workspace/following-${index}`, "folder"))
    const scrollEntries = [empty, ...closedFolders, ...followingFolders]
    const scrollingModel = {
      items: { ...initialModel.items, ...Object.fromEntries(scrollEntries.map((entry) => [entry.path, entry])) },
      childrenByPath: {
        ...initialModel.childrenByPath,
        ...Object.fromEntries(scrollEntries.map((entry) => [entry.path, []])),
        "/workspace": ["/workspace/src", "/workspace/docs", ...followingFolders.map((entry) => entry.path)],
        "/workspace/src": [empty.path, ...closedFolders.map((entry) => entry.path), "/workspace/src/alpha.ts", "/workspace/src/beta.ts"],
      },
    }
    await render(scrollingModel)
    await act(async () => { row(empty.path).click() })
    await settle()
    await render(scrollingModel, "", noLoading, "/workspace/src/alpha.ts")
    await settle()
    await act(async () => { host.scrollTop = 115 })
    await settle()
    const background = (element: HTMLElement) => getComputedStyle(element.querySelector('[data-slot="tree-item-label"]')!).backgroundColor
    const transparent = (element: HTMLElement) => ["transparent", "rgba(0, 0, 0, 0)"].includes(background(element))
    alpha = row("/workspace/src/alpha.ts")
    const hostTop = host.getBoundingClientRect().top
    check("expanded ancestors are pinned in their slots with the sticky background", row("/workspace").dataset.stuck === "true" && src.dataset.stuck === "true" && !transparent(src) && row("/workspace").getBoundingClientRect().top === hostTop && src.getBoundingClientRect().top === hostTop + 26 && getComputedStyle(src).position === "sticky")
    check("a pinned row is the same element as before it was pinned", row("/workspace/src") === src)
    check("collapsed rows passing underneath sticky ancestors never acquire the sticky highlight", closedFolders.every((entry) => row(entry.path).dataset.stuck !== "true" && row(entry.path).getAttribute("aria-selected") === "false" && transparent(row(entry.path))))
    check("an expanded empty folder cannot acquire the sticky highlight", row(empty.path).getAttribute("aria-expanded") === "true" && row(empty.path).dataset.stuck !== "true" && transparent(row(empty.path)))
    check("scrolling keeps the real selected file highlighted", alpha.getAttribute("aria-selected") === "true" && !transparent(alpha))
    const sectionBottom = row("/workspace/src/beta.ts").getBoundingClientRect().bottom - hostTop + host.scrollTop
    await act(async () => { host.scrollTop = sectionBottom - 42 })
    await settle()
    check("an expanded ancestor loses the sticky highlight when its subtree pushes it underneath its parent", src.getBoundingClientRect().top < host.getBoundingClientRect().top + 26 && src.dataset.stuck === "false" && transparent(src) && row("/workspace").dataset.stuck === "true")
    await act(async () => { host.scrollTop = 0 })
    await settle()
    check("returning to the top clears sticky highlights without clearing selection", row("/workspace").dataset.stuck === "false" && src.dataset.stuck === "false" && alpha.getAttribute("aria-selected") === "true" && !transparent(alpha) && getComputedStyle(src).position === "absolute")

    // Windowing: a directory far larger than the viewport.
    const manyFiles = Array.from({ length: 600 }, (_, index) => item(`/workspace/docs/file-${String(index).padStart(3, "0")}.txt`, "file"))
    const largeModel = {
      items: { ...scrollingModel.items, ...Object.fromEntries(manyFiles.map((entry) => [entry.path, entry])) },
      childrenByPath: { ...scrollingModel.childrenByPath, "/workspace/docs": manyFiles.map((entry) => entry.path) },
    }
    // The earlier search expanded every folder, `docs` included.
    await render(largeModel, "", noLoading, "/workspace/src/alpha.ts")
    await settle()
    const mounted = () => host.querySelectorAll("[data-file-tree-item-id]").length
    const totalRows = 17 + 1 + 600 + 20
    check("only the rows around the viewport are mounted", mounted() < 80 && docs.parentElement!.getBoundingClientRect().height === totalRows * 27 - 1)
    await act(async () => { host.scrollTop = host.scrollHeight })
    await settle()
    check("scrolling to the end mounts the last rows and releases the first", !missing("/workspace/following-19") && missing("/workspace/src/alpha.ts") && mounted() < 80)
    check("past the end of a folder only its still-open ancestors stay pinned", row("/workspace").dataset.stuck === "true" && missing("/workspace/docs"))
    await act(async () => { host.scrollTop = 300 * 27 })
    await settle()
    check("the open folder is pinned while its children scroll", row("/workspace/docs").dataset.stuck === "true" && row("/workspace/docs").getBoundingClientRect().top === hostTop + 26 && row("/workspace").getBoundingClientRect().top === hostTop)
    const middle = [...host.querySelectorAll<HTMLButtonElement>('[data-file-tree-item-id^="/workspace/docs/file-"]')].find((element) => element.getBoundingClientRect().top > hostTop + 120)!
    await act(async () => { middle.click() })
    middle.focus()
    const middleId = middle.dataset.fileTreeItemId!
    await act(async () => { host.scrollTop = 0 })
    await settle()
    check("the focused row stays mounted outside the window", row(middleId) === middle && document.activeElement === middle && mounted() < 80)
    await act(async () => { pressKey(middle, "ArrowDown") })
    await settle()
    const next = host.querySelector<HTMLElement>('[data-focus="true"]')!
    check("keyboard navigation from an offscreen row scrolls its target into view", next !== middle && next.getBoundingClientRect().top >= hostTop + 52 && next.getBoundingClientRect().bottom <= hostTop + host.clientHeight && document.activeElement === next)
    await act(async () => { host.scrollTop = 0 })
    await settle()

    await document.fonts.ready
    const measurer = createFileTreeNameMeasurer(document)
    const slot = document.createElement("span")
    slot.style.cssText = "position:absolute;left:-9999px;display:block;visibility:hidden"
    const child = document.createElement("span")
    slot.append(child)
    document.body.append(slot)
    try {
      for (const font of ['14px Inter', '600 13px Inter', '14px "JetBrains Mono"']) {
        for (const name of ['README.md', '文件夹展开与折叠', 'office ffi file.tsx', '📁 emoji 🧑‍💻.txt', '  white   space  ', '']) {
          slot.dataset.fileTreeNameText = name
          child.style.font = font
          child.textContent = name
          const probe = document.createElement("span")
          probe.style.cssText = "position:absolute;left:-9999px;top:0;white-space:nowrap;visibility:hidden;pointer-events:none"
          probe.style.font = getComputedStyle(child).font
          probe.textContent = name
          document.body.append(probe)
          const expectedWidth = probe.offsetWidth
          probe.remove()
          for (const available of [32, 97]) {
            slot.style.width = `${available}px`
            check(
              `exact text width: ${font}, ${JSON.stringify(name)}, ${available}px slot`,
              measurer.measure([slot]) === Math.max(0, expectedWidth - slot.clientWidth)
            )
          }
        }
      }
    } finally {
      slot.remove()
    }
    results.textContent = `PASS: ${passed.length} checks\n${passed.join("\n")}`
  } catch (error) {
    results.textContent = `FAIL after ${passed.length} checks: ${String(error)}\n${passed.join("\n")}`
    console.error(error)
  } finally {
    await act(async () => { root.unmount() })
  }
}

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true
  try {
    await runChecks()
  } finally {
    button.disabled = false
  }
})
