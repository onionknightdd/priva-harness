import { useLayoutEffect, useState, type RefObject } from "react"

type Dimensions = { width: number; height: number }

const initialDimensions: Dimensions = { width: 320, height: 200 }
const viewportMargin = 400

export function useChartDimensions(ref: RefObject<HTMLDivElement | null>) {
  const [snapshot, setSnapshot] = useState({ dimensions: initialDimensions, nearViewport: true })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const viewport = element.closest('[data-slot="message-scroller-viewport"]')
    const bounds = element.getBoundingClientRect()
    const viewportBounds = viewport?.getBoundingClientRect()
    let nearViewport = bounds.bottom >= (viewportBounds?.top ?? 0) - viewportMargin &&
      bounds.top <= (viewportBounds?.bottom ?? window.innerHeight) + viewportMargin
    let latest = initialDimensions

    const publish = () => setSnapshot((previous) => {
      const dimensions = nearViewport ? latest : previous.dimensions
      if (previous.nearViewport === nearViewport &&
        previous.dimensions.width === dimensions.width && previous.dimensions.height === dimensions.height) {
        return previous
      }
      return { dimensions, nearViewport }
    })
    const remember = (width: number, height: number) => {
      // Keep the mounted chart through temporarily hidden/zero-sized ancestors.
      // Match Recharts' rounding so visible charts keep the same coordinates.
      const roundedWidth = Math.round(width)
      const roundedHeight = Math.round(height)
      if (roundedWidth > 0 && roundedHeight > 0) latest = { width: roundedWidth, height: roundedHeight }
    }
    remember(bounds.width, bounds.height)
    // Initialize offscreen charts once at their real size, then freeze their
    // geometry. Changing visibility must never remount a chart or its animation.
    setSnapshot({ dimensions: latest, nearViewport })

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return
      remember(entry.contentRect.width, entry.contentRect.height)
      if (nearViewport) publish()
    })
    const intersections = new IntersectionObserver(([entry]) => {
      if (!entry) return
      nearViewport = entry.isIntersecting
      if (nearViewport) {
        // Scroll and resize notifications can arrive in either order.
        const current = element.getBoundingClientRect()
        remember(current.width, current.height)
      }
      publish()
    }, { root: viewport, rootMargin: `${viewportMargin}px 0px` })
    const onFocus = () => {
      nearViewport = true
      const current = element.getBoundingClientRect()
      remember(current.width, current.height)
      publish()
    }
    resizeObserver.observe(element)
    intersections.observe(element)
    element.addEventListener("focusin", onFocus)
    return () => {
      resizeObserver.disconnect()
      intersections.disconnect()
      element.removeEventListener("focusin", onFocus)
    }
  }, [ref])

  return snapshot
}
