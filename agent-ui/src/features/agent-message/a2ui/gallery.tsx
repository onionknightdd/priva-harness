import { useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent } from "react"
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue, type PanInfo } from "motion/react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import { WheelGestures, type WheelEventState } from "wheel-gestures"

import { Button } from "@/components/ui/button"
import { SPRING_LAYOUT } from "@/lib/ease"
import { DashboardImage } from "./image"
import { dashboardImageUrl } from "./image-source"
import "./gallery.css"

export type GalleryImage = { url: string; description: string; title?: string }
type Props = { images: GalleryImage[]; title?: string }
type Pan = { origin: number; index: number; stride: number; axis?: "x" | "y" }
type WheelGesture = { origin: number; index: number; stride: number; offset: number }
type WheelTail = { delta: number; time: number }
const TAIL_GAP_MS = 300
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function DashboardImageGallery({ images, title }: Props) {
  if (images.length < 1 || images.length > 12) throw new Error("ImageGallery requires 1 to 12 images.")
  // Validate the whole list before any image reaches the DOM. A new source list
  // starts on its first image; equivalent arrays retain their local selection.
  const sources = images.map((image) => dashboardImageUrl(image.url))
  return <Gallery key={JSON.stringify(sources)} images={images} title={title} />
}

function Gallery({ images, title }: Props) {
  const { t } = useTranslation()
  const titleId = useId()
  const rootRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const selected = useRef(0)
  const [index, setIndex] = useState(0)
  const position = useMotionValue(0)
  const reduce = useReducedMotion()
  const pan = useRef<Pan | null>(null)
  const wheel = useRef<WheelGesture | null>(null)
  const wheelTail = useRef<WheelTail | null>(null)
  const suppressClick = useRef(false)
  const count = images.length
  const current = images[index]
  const progress = useTransform(position, (value) => `scaleX(${(clamp(value, 0, count - 1) + 1) / count})`)

  useEffect(() => () => position.stop(), [position])
  useEffect(() => { if (reduce) position.jump(selected.current) }, [position, reduce])

  const preserveFocus = (destination: number) => {
    const focusedSlide = document.activeElement?.closest<HTMLElement>(".a2ui-gallery-slide")
    if (focusedSlide && rootRef.current?.contains(focusedSlide) && Number(focusedSlide.dataset.index) !== destination) {
      rootRef.current.focus({ preventScroll: true })
    }
  }

  const select = (next: number, instant = false) => {
    wheel.current = null
    const bounded = clamp(next, 0, count - 1)
    preserveFocus(bounded)
    selected.current = bounded
    setIndex(bounded)
    if (instant || reduce) position.jump(bounded)
    else void animate(position, bounded, SPRING_LAYOUT)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Lightbox is portaled under this React subtree; leave its zoom/pan keys alone.
    if (!(event.target instanceof Element) || event.target.closest('[role="dialog"]')) return
    suppressClick.current = false
    const next = event.key === "ArrowLeft" ? selected.current - 1
      : event.key === "ArrowRight" ? selected.current + 1
        : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : undefined
    if (next === undefined || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    pan.current = null
    select(next, true)
  }

  const move = (info: PanInfo) => {
    const gesture = pan.current
    if (!gesture || count === 1) return
    if (!gesture.axis) {
      if (Math.max(Math.abs(info.offset.x), Math.abs(info.offset.y)) < 8) return
      gesture.axis = Math.abs(info.offset.x) > Math.abs(info.offset.y) ? "x" : "y"
      if (gesture.axis === "x") {
        gesture.origin = position.get()
        // Interrupt an in-flight snap where it is drawn, not at its old target.
        gesture.index = clamp(Math.round(gesture.origin), 0, count - 1)
        preserveFocus(gesture.index)
        selected.current = gesture.index
        setIndex(gesture.index)
        position.stop()
        suppressClick.current = true
      }
    }
    if (gesture.axis !== "x" || reduce) return
    position.set(clamp(gesture.origin - info.offset.x / gesture.stride, Math.max(0, gesture.index - 1), Math.min(count - 1, gesture.index + 1)))
  }

  const finish = (info: PanInfo) => {
    const gesture = pan.current
    pan.current = null
    if (!gesture || gesture.axis !== "x") return
    const distance = -info.offset.x / gesture.stride
    const flick = Math.abs(info.velocity.x) > 400 && Math.abs(info.offset.x) > 8
    const next = flick ? gesture.index - Math.sign(info.velocity.x)
      : Math.abs(distance) >= 0.2 ? gesture.index + Math.sign(distance) : gesture.index
    select(next)
  }

  const wheelLanding = (gesture: WheelGesture) => clamp(gesture.origin + gesture.offset / gesture.stride,
    Math.max(0, gesture.index - 1), Math.min(count - 1, gesture.index + 1))

  const onWheelGesture = useEffectEvent((state: WheelEventState) => {
    const [deltaX, deltaY] = state.axisDelta
    const delta = Math.abs(deltaX)
    const time = state.event.timeStamp
    let gesture = wheel.current
    if (!gesture) {
      if (state.isEnding) return
      const tail = wheelTail.current
      if (tail) {
        // Momentum after a commit keeps decaying, even when the detector splits it
        // into another stream. A sharp rise or a pause starts the next swipe.
        if (time - tail.time < TAIL_GAP_MS && delta <= Math.max(2, tail.delta * 2)) {
          wheelTail.current = { delta, time }
          return
        }
        wheelTail.current = null
      }
      if (state.isMomentum || delta <= Math.abs(deltaY) || pan.current?.axis === "x") return
      const slide = stageRef.current?.querySelector<HTMLElement>(".a2ui-gallery-slide")
      // Continue from the drawn position toward the committed image, so a swipe
      // that resumes over an in-flight snap never reselects the image it left.
      gesture = { origin: position.get(), index: selected.current, stride: Math.max(1, (slide?.offsetWidth ?? 1) * 0.72), offset: 0 }
      preserveFocus(gesture.index)
      position.stop()
      wheel.current = gesture
    }
    gesture.offset = clamp(gesture.offset + deltaX, -gesture.stride, gesture.stride)
    if (!state.isMomentum && !state.isEnding) {
      if (!reduce) position.set(wheelLanding(gesture))
      return
    }
    // Commit as soon as the fingers lift (momentum) or the stream ends.
    const distance = gesture.offset / gesture.stride
    const landing = wheelLanding(gesture)
    wheelTail.current = state.isMomentum ? { delta, time } : null
    select(Math.abs(distance) < 0.2 ? gesture.index : distance > 0 ? Math.ceil(landing) : Math.floor(landing))
  })

  const onWheel = useEffectEvent((event: WheelEvent, gestures: ReturnType<typeof WheelGestures>) => {
    if (count === 1 || event.ctrlKey) return
    if (wheel.current || Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault()
    gestures.feedWheel(event)
  })

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    // Pinch zoom and vertical scrolling stay with the browser; the detector only
    // classifies the stream, so it must not cancel events itself.
    const gestures = WheelGestures({ preventWheelAction: false, reverseSign: false })
    const off = gestures.on("wheel", (state) => onWheelGesture(state))
    const handleWheel = (event: WheelEvent) => onWheel(event, gestures)
    stage.addEventListener("wheel", handleWheel, { passive: false })
    return () => {
      stage.removeEventListener("wheel", handleWheel)
      off()
      wheel.current = null
      wheelTail.current = null
    }
  }, [])

  return <section
    ref={rootRef}
    role="region"
    aria-roledescription="carousel"
    aria-label={title ? undefined : t("agentMessage.gallery.label")}
    aria-labelledby={title ? titleId : undefined}
    tabIndex={count > 1 ? 0 : -1}
    className="a2ui-gallery"
    data-index={index}
    data-count={count}
    onKeyDown={onKeyDown}
  >
    {title ? <h3 id={titleId} className="a2ui-gallery-title">{title}</h3> : null}
    <motion.div
      ref={stageRef}
      className="a2ui-gallery-stage"
      onPointerDownCapture={() => {
        suppressClick.current = false
        if (wheel.current) select(Math.round(position.get()), true)
      }}
      onClickCapture={(event) => {
        if (!suppressClick.current) return
        suppressClick.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
      onPanSessionStart={() => {
        const slide = stageRef.current?.querySelector<HTMLElement>(".a2ui-gallery-slide")
        pan.current = { origin: position.get(), index: selected.current, stride: Math.max(1, (slide?.offsetWidth ?? 1) * 0.72) }
      }}
      onPan={(_event, info) => move(info)}
      onPanEnd={(_event, info) => finish(info)}
      onPointerCancel={() => {
        if (pan.current?.axis === "x") select(selected.current)
        pan.current = null
      }}
    >
      {images.map((image, item) => <GallerySlide
        key={`${item}:${image.url}`}
        image={image}
        index={item}
        active={item === index}
        position={position}
        onSelect={() => select(item)}
      />)}
    </motion.div>
    <div className="a2ui-gallery-footer">
      <div className="a2ui-gallery-caption">
        <p>{current.title || current.description}</p>
        {current.title && current.title !== current.description ? <p>{current.description}</p> : null}
      </div>
      <div className="a2ui-gallery-controls">
        {count > 1 ? <Button type="button" variant="ghost" size="icon-sm" data-direction="previous" aria-label={t("agentMessage.gallery.previous")} disabled={index === 0} onClick={(event) => select(selected.current - 1, event.detail === 0)}><ChevronLeft aria-hidden="true" /></Button> : null}
        <span className="a2ui-gallery-count" aria-hidden="true">{String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}</span>
        {count > 1 ? <Button type="button" variant="ghost" size="icon-sm" data-direction="next" aria-label={t("agentMessage.gallery.next")} disabled={index === count - 1} onClick={(event) => select(selected.current + 1, event.detail === 0)}><ChevronRight aria-hidden="true" /></Button> : null}
      </div>
    </div>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{t("agentMessage.gallery.position", { index: index + 1, total: count })}: {current.title || current.description}</span>
    <div className="a2ui-gallery-progress" aria-hidden="true"><motion.span style={{ transform: progress }} /></div>
  </section>
}

function GallerySlide({ image, index, active, position, onSelect }: {
  image: GalleryImage
  index: number
  active: boolean
  position: MotionValue<number>
  onSelect: () => void
}) {
  const transform = useTransform(position, (value) => {
    const offset = index - value
    const depth = Math.min(Math.abs(offset), 2)
    return `translateX(-50%) translateX(${offset * 72}%) translateZ(${-depth * 110}px) rotateY(${-clamp(offset, -1, 1) * 40}deg)`
  })
  const zIndex = useTransform(position, (value) => 100 - Math.round(Math.abs(index - value) * 10))
  // The stage clips distant slides geometrically. Keeping them opaque avoids
  // an empty frame when an instant jump updates transform before visibility.
  return <motion.div
    className="a2ui-gallery-slide"
    data-index={index}
    data-active={active}
    aria-hidden={!active}
    style={{ transform, zIndex }}
  >
    <DashboardImage {...image} fit="cover" active={active} onSelect={active ? undefined : onSelect} />
  </motion.div>
}
