import * as React from "react"
import gsap from "gsap"
import { FolderIcon, FolderOpenIcon } from "lucide-react"

const FOLDER_ICON_TRANSITION_DURATION = 0.2

export function FileTreeFolderIcon({ expanded }: { expanded: boolean }) {
  const iconRef = React.useRef<HTMLSpanElement>(null)
  const previousExpandedRef = React.useRef(expanded)

  React.useLayoutEffect(() => {
    const icon = iconRef.current
    const closedIcon = icon?.querySelector<SVGSVGElement>(
      "[data-folder-icon=closed]"
    )
    const openIcon = icon?.querySelector<SVGSVGElement>(
      "[data-folder-icon=open]"
    )

    if (!icon || !closedIcon || !openIcon) {
      return
    }

    const previousExpanded = previousExpandedRef.current
    const incomingIcon = expanded ? openIcon : closedIcon
    const outgoingIcon = expanded ? closedIcon : openIcon
    const iconTargets = [closedIcon, openIcon]
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    previousExpandedRef.current = expanded
    gsap.killTweensOf(iconTargets)

    if (previousExpanded === expanded || reducedMotion) {
      gsap.set(incomingIcon, { opacity: 1, scale: 1, y: 0 })
      gsap.set(outgoingIcon, { opacity: 0, scale: 1, y: 0 })

      return () => gsap.killTweensOf(iconTargets)
    }

    const context = gsap.context(() => {
      gsap
        .timeline()
        .set(incomingIcon, {
          opacity: 0,
          scale: 0.9,
          transformOrigin: "50% 50%",
          y: expanded ? 1 : -1,
        })
        .set(outgoingIcon, {
          opacity: 1,
          scale: 1,
          transformOrigin: "50% 50%",
          y: 0,
        })
        .to(
          outgoingIcon,
          {
            opacity: 0,
            scale: 0.9,
            duration: FOLDER_ICON_TRANSITION_DURATION * 0.55,
            ease: "power2.in",
            y: expanded ? -1 : 1,
          },
          0
        )
        .to(
          incomingIcon,
          {
            opacity: 1,
            scale: 1,
            duration: FOLDER_ICON_TRANSITION_DURATION * 0.8,
            ease: "power2.out",
            y: 0,
          },
          FOLDER_ICON_TRANSITION_DURATION * 0.2
        )
    }, icon)

    return () => context.revert()
  }, [expanded])

  return (
    <span
      ref={iconRef}
      aria-hidden="true"
      className="relative size-4 shrink-0"
    >
      <FolderIcon
        data-folder-icon="closed"
        className={`absolute inset-0 size-4 text-muted-foreground ${
          expanded ? "opacity-0" : "opacity-100"
        }`}
      />
      <FolderOpenIcon
        data-folder-icon="open"
        className={`absolute inset-0 size-4 text-muted-foreground ${
          expanded ? "opacity-100" : "opacity-0"
        }`}
      />
    </span>
  )
}
