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

let measureNode: HTMLSpanElement | null = null

function getMeasureNode() {
  if (measureNode && measureNode.isConnected) {
    return measureNode
  }

  const node = document.createElement("span")
  node.ariaHidden = "true"
  node.style.cssText =
    "position:absolute;left:-9999px;top:0;white-space:nowrap;visibility:hidden;pointer-events:none"
  document.body.appendChild(node)
  measureNode = node
  return node
}

export function measureFileTreeNameOverflow(
  slots: Iterable<HTMLElement>
) {
  const probe = getMeasureNode()
  const rows: { nameWidth: number; nameSlotWidth: number }[] = []

  for (const slot of slots) {
    const sample = slot.firstElementChild ?? slot
    probe.style.font = getComputedStyle(sample).font
    probe.textContent = slot.dataset.fileTreeNameText ?? slot.textContent ?? ""
    rows.push({
      nameWidth: probe.offsetWidth,
      nameSlotWidth: slot.clientWidth,
    })
  }

  probe.textContent = ""
  return fileTreeMaxNameOverflow(rows)
}
