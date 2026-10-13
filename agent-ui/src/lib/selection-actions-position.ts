export type SelectionActionsRect = { left: number; top: number; bottom: number; width: number }

export function selectionActionsPosition(rect: SelectionActionsRect,
  menu: { width: number; height: number }, viewport: { width: number; height: number }) {
  const padding = 8
  const left = Math.max(padding, Math.min(rect.left + rect.width / 2 - menu.width / 2, viewport.width - menu.width - padding))
  const below = rect.bottom + padding
  const placeAbove = below + menu.height > viewport.height - padding
  const top = Math.max(padding, Math.min(placeAbove ? rect.top - menu.height - padding : below, viewport.height - menu.height - padding))
  return { left, top, placeAbove }
}
