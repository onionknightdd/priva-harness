export const FILE_TREE_OVERFLOW_THRESHOLD_PX = 8
export const FILE_TREE_OVERFLOW_BUFFER_PX = 12

export function fileTreeMaxNameOverflow(
  rows: readonly { nameWidth: number; nameSlotWidth: number }[]
) {
  let overflow = 0

  for (const row of rows) {
    overflow = Math.max(overflow, row.nameWidth - row.nameSlotWidth)
  }

  return Math.max(0, Math.ceil(overflow))
}

export function fileTreeTargetPanelWidth({
  currentWidth,
  overflow,
  maxWidth,
}: {
  currentWidth: number
  overflow: number
  maxWidth: number
}) {
  if (overflow < FILE_TREE_OVERFLOW_THRESHOLD_PX) {
    return currentWidth
  }

  return Math.min(
    maxWidth,
    currentWidth + overflow + FILE_TREE_OVERFLOW_BUFFER_PX
  )
}

export function createFileTreeNameMeasurer(ownerDocument: Document) {
  const widths = new Map<string, number>()
  let host: HTMLElement | null = null

  // Probes live in one persistent host with `contain: strict`, so inserting
  // and removing them never dirties layout outside the host. The panel size
  // read that follows a measurement then costs no second full-page layout.
  function getHost() {
    if (!host) {
      host = ownerDocument.createElement("div")
      host.ariaHidden = "true"
      host.style.cssText =
        "position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;contain:strict;visibility:hidden;pointer-events:none"
      ownerDocument.body.appendChild(host)
    }

    return host
  }

  function measure(slots: Iterable<HTMLElement>) {
    // Read the live rows before inserting probes. Interleaving a text write
    // with offsetWidth for every row repeatedly lays out the session page.
    const rows = Array.from(slots, (slot) => {
      const font = ownerDocument.defaultView!.getComputedStyle(
        slot.firstElementChild ?? slot
      ).font
      const name = slot.dataset.fileTreeNameText ?? slot.textContent ?? ""

      return {
        key: JSON.stringify([font, name]),
        font,
        name,
        nameSlotWidth: slot.clientWidth,
      }
    })
    const probes = new Map<string, HTMLSpanElement>()
    const fragment = ownerDocument.createDocumentFragment()

    for (const row of rows) {
      if (widths.has(row.key) || probes.has(row.key)) {
        continue
      }

      const probe = ownerDocument.createElement("span")
      probe.ariaHidden = "true"
      probe.style.cssText =
        "position:absolute;left:-9999px;top:0;white-space:nowrap;visibility:hidden;pointer-events:none"
      probe.style.font = row.font
      probe.textContent = row.name
      probes.set(row.key, probe)
      fragment.appendChild(probe)
    }

    if (probes.size > 0) {
      getHost().appendChild(fragment)
      try {
        // Keep the browser's original text metrics, with one write phase and
        // one read phase for all uncached names, including duplicate names.
        for (const [key, probe] of probes) {
          widths.set(key, probe.offsetWidth)
        }
      } finally {
        for (const probe of probes.values()) {
          probe.remove()
        }
      }
    }

    return fileTreeMaxNameOverflow(
      rows.map((row) => ({
        nameWidth: widths.get(row.key)!,
        nameSlotWidth: row.nameSlotWidth,
      }))
    )
  }

  function dispose() {
    widths.clear()
    host?.remove()
    host = null
  }

  return { measure, clearCache: () => widths.clear(), dispose }
}
