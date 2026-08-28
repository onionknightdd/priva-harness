import * as React from "react"
import gsap from "gsap"
import { animate } from "motion/react"
import { usePanelRef } from "react-resizable-panels"

import { SPRING_LAYOUT } from "@/lib/ease"

import { fileTreeTargetPanelWidth } from "./file-tree-content-width"

const TREE_DEFAULT_SIZE = 30
const TREE_MIN_SIZE = 18
const TREE_MAX_SIZE = 65

function clampTreeSize(size: number) {
  return Math.min(TREE_MAX_SIZE, Math.max(TREE_MIN_SIZE, size))
}

export function useTreePanelVisibility() {
  const treePanelRef = usePanelRef()
  const treePaneContentRef = React.useRef<HTMLDivElement>(null)
  const panelAnimationRef = React.useRef<gsap.core.Timeline | null>(null)
  const previousTreeSizeRef = React.useRef(TREE_DEFAULT_SIZE)
  const userOverrideRef = React.useRef(false)
  const fitAnimationRef = React.useRef<{ stop: () => void } | null>(null)
  const [treeVisible, setTreeVisible] = React.useState(true)
  const [panelTransitioning, setPanelTransitioning] = React.useState(false)

  React.useEffect(
    () => () => {
      panelAnimationRef.current?.kill()
      fitAnimationRef.current?.stop()
    },
    []
  )

  const setDesktopTreeVisibility = React.useCallback((visible: boolean) => {
    const panel = treePanelRef.current
    const treeContent = treePaneContentRef.current

    if (!panel || !treeContent) {
      setTreeVisible(visible)
      return
    }

    panelAnimationRef.current?.kill()
    fitAnimationRef.current?.stop()
    fitAnimationRef.current = null

    const currentSize = panel.getSize().asPercentage
    if (!visible && currentSize > 0) {
      previousTreeSizeRef.current = clampTreeSize(currentSize)
    }

    const targetSize = visible ? previousTreeSizeRef.current : 0
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    setPanelTransitioning(true)
    setTreeVisible(visible)

    window.requestAnimationFrame(() => {
      if (reducedMotion) {
        panel.resize(`${targetSize}%`)
        gsap.set(treeContent, {
          clearProps: "transform",
          opacity: visible ? 1 : 0,
        })
        setPanelTransitioning(false)
        return
      }

      if (visible) {
        panel.resize("0%")
        gsap.set(treeContent, { opacity: 0, x: -8 })
      }

      const sizeState = { value: visible ? 0 : currentSize }
      const timeline = gsap.timeline({
        defaults: { duration: 0.3, ease: "power2.inOut" },
        onComplete: () => {
          setPanelTransitioning(false)
          gsap.set(treeContent, { clearProps: "transform,opacity" })
          panelAnimationRef.current = null
        },
      })

      timeline.to(
        sizeState,
        {
          value: targetSize,
          onUpdate: () => panel.resize(`${sizeState.value}%`),
        },
        0
      )
      timeline.to(
        treeContent,
        {
          opacity: visible ? 1 : 0,
          x: visible ? 0 : -8,
          duration: 0.2,
        },
        0
      )

      panelAnimationRef.current = timeline
    })
  }, [treePanelRef])

  const rememberTreeSize = React.useCallback((sizePercentage: number) => {
    if (
      treeVisible &&
      !panelTransitioning &&
      sizePercentage >= TREE_MIN_SIZE
    ) {
      previousTreeSizeRef.current = clampTreeSize(sizePercentage)
    }
  }, [panelTransitioning, treeVisible])

  const markUserResizedTree = React.useCallback(() => {
    userOverrideRef.current = true
    fitAnimationRef.current?.stop()
    fitAnimationRef.current = null
  }, [])

  const fitTreeToNameOverflow = React.useCallback((overflowPx: number) => {
    if (
      !treeVisible ||
      panelTransitioning ||
      userOverrideRef.current
    ) {
      return
    }

    const panel = treePanelRef.current
    if (!panel) {
      return
    }

    const current = panel.getSize()
    if (current.inPixels <= 0 || current.asPercentage <= 0) {
      return
    }

    const groupWidth = current.inPixels / (current.asPercentage / 100)
    const target = fileTreeTargetPanelWidth({
      currentWidth: current.inPixels,
      overflow: overflowPx,
      maxWidth: groupWidth * (TREE_MAX_SIZE / 100),
    })

    if (target - current.inPixels < 8) {
      return
    }

    fitAnimationRef.current?.stop()

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    if (reducedMotion) {
      panel.resize(target)
      previousTreeSizeRef.current = clampTreeSize(
        panel.getSize().asPercentage
      )
      fitAnimationRef.current = null
      return
    }

    const playback = animate(current.inPixels, target, {
      ...SPRING_LAYOUT,
      onUpdate: (value) => {
        panel.resize(Math.round(value))
      },
      onComplete: () => {
        previousTreeSizeRef.current = clampTreeSize(
          panel.getSize().asPercentage
        )
        fitAnimationRef.current = null
      },
    })

    fitAnimationRef.current = playback
  }, [panelTransitioning, treePanelRef, treeVisible])

  const onTreeStructureChange = React.useCallback(() => {
    userOverrideRef.current = false
  }, [])

  return {
    fitTreeToNameOverflow,
    markUserResizedTree,
    onTreeStructureChange,
    panelTransitioning,
    rememberTreeSize,
    setDesktopTreeVisibility,
    setTreeVisible,
    treePaneContentRef,
    treePanelRef,
    treeVisible,
    TREE_DEFAULT_SIZE,
    TREE_MAX_SIZE,
    TREE_MIN_SIZE,
  }
}
