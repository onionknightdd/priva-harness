import * as React from "react"
import { animate } from "motion/react"
import { usePanelRef } from "react-resizable-panels"

import { EASE_IN_OUT, SPRING_LAYOUT } from "@/lib/ease"

import { fileTreeTargetPanelWidth } from "./file-tree-content-width"

const TREE_DEFAULT_SIZE = 30
const TREE_MIN_SIZE = 18
const TREE_MAX_SIZE = 100

function clampTreeSize(size: number) {
  return Math.min(TREE_MAX_SIZE, Math.max(TREE_MIN_SIZE, size))
}

export function useTreePanelVisibility() {
  const treePanelRef = usePanelRef()
  const treePaneContentRef = React.useRef<HTMLDivElement>(null)
  const previewPaneContentRef = React.useRef<HTMLDivElement>(null)
  const panelAnimationRef = React.useRef<{ stop: () => void } | null>(null)
  const panelFrameRef = React.useRef(0)
  const transitioningRef = React.useRef(false)
  const previousTreeSizeRef = React.useRef(TREE_DEFAULT_SIZE)
  const userOverrideRef = React.useRef(false)
  const fitAnimationRef = React.useRef<{ stop: () => void } | null>(null)
  const [treeVisible, setTreeVisible] = React.useState(true)
  const [previewVisible, setPreviewVisible] = React.useState(true)
  const [panelTransitioning, setPanelTransitioning] = React.useState(false)

  React.useEffect(
    () => () => {
      window.cancelAnimationFrame(panelFrameRef.current)
      panelAnimationRef.current?.stop()
      fitAnimationRef.current?.stop()
    },
    []
  )

  const stopPanelAnimations = React.useCallback(() => {
    window.cancelAnimationFrame(panelFrameRef.current)
    panelAnimationRef.current?.stop()
    panelAnimationRef.current = null
    fitAnimationRef.current?.stop()
    fitAnimationRef.current = null
  }, [])

  const setDesktopPanelVisibility = React.useCallback((nextTreeVisible: boolean, nextPreviewVisible: boolean) => {
    const panel = treePanelRef.current
    const treeContent = treePaneContentRef.current
    const previewContent = previewPaneContentRef.current
    const currentSize = panel?.getSize().asPercentage ?? TREE_DEFAULT_SIZE

    if (!transitioningRef.current && treeVisible && previewVisible && currentSize > 0 && currentSize < 100) {
      previousTreeSizeRef.current = clampTreeSize(currentSize)
    }

    stopPanelAnimations()
    setTreeVisible(nextTreeVisible)
    setPreviewVisible(nextPreviewVisible)
    if (!panel || !treeContent || !previewContent) {
      transitioningRef.current = false
      setPanelTransitioning(false)
      return
    }

    const freezeTree = treeVisible !== nextTreeVisible || Boolean(treeContent.style.width)
    const freezePreview = previewVisible !== nextPreviewVisible || Boolean(previewContent.style.width)
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || document.activeElement?.matches(":focus-visible") === true
    transitioningRef.current = true
    setPanelTransitioning(true)

    const finish = () => {
      for (const content of [treeContent, previewContent]) {
        content.style.removeProperty("width")
        content.style.removeProperty("flex")
      }
      transitioningRef.current = false
      setPanelTransitioning(false)
      panelAnimationRef.current = null
    }

    // Relax the panel constraints before moving the shared divider.
    panelFrameRef.current = window.requestAnimationFrame(() => {
      const activePanel = treePanelRef.current
      if (!activePanel || !treeContent.isConnected || !previewContent.isConnected) {
        finish()
        return
      }
      const treeWidth = treeContent.parentElement!.getBoundingClientRect().width
      const previewWidth = previewContent.parentElement!.getBoundingClientRect().width
      const groupWidth = treeWidth + previewWidth
      const previewMinimumWidth = Number.parseFloat(previewContent.style.minWidth) || 0
      const targetSize = !nextTreeVisible ? 0 : !nextPreviewVisible ? 100 : Math.min(
        previousTreeSizeRef.current,
        Math.max(0, 100 * (1 - previewMinimumWidth / Math.max(1, groupWidth)))
      )

      if (instant) {
        activePanel.resize(`${targetSize}%`)
        finish()
        return
      }

      // Keep the collapsing pane at its reading width and reveal it by clipping.
      // The opposite pane and divider follow the same live panel resize.
      const freezeWidth = (content: HTMLElement, currentWidth: number, targetWidth: number) => {
        const width = Math.max(Number.parseFloat(content.style.width) || 0, currentWidth, targetWidth)
        content.style.width = `${width}px`
        content.style.flex = "0 0 auto"
      }
      if (freezeTree) freezeWidth(treeContent, treeWidth, groupWidth * targetSize / 100)
      if (freezePreview) freezeWidth(previewContent, previewWidth, groupWidth * (1 - targetSize / 100))

      panelAnimationRef.current = animate(activePanel.getSize().asPercentage, targetSize, {
        duration: 0.24,
        ease: EASE_IN_OUT,
        onUpdate: (size) => {
          const activePanel = treePanelRef.current
          if (!activePanel || !treeContent.isConnected || !previewContent.isConnected) {
            panelAnimationRef.current?.stop()
            finish()
            return
          }
          activePanel.resize(`${size}%`)
        },
        onComplete: finish,
      })
    })
  }, [previewVisible, stopPanelAnimations, treePanelRef, treeVisible])

  const setDesktopPreviewVisibility = React.useCallback((visible: boolean) => {
    if (visible !== previewVisible) setDesktopPanelVisibility(true, visible)
  }, [previewVisible, setDesktopPanelVisibility])

  const setDesktopTreeVisibility = React.useCallback((visible: boolean) => {
    if (visible !== treeVisible) setDesktopPanelVisibility(visible, !visible || previewVisible)
  }, [previewVisible, setDesktopPanelVisibility, treeVisible])

  const rememberTreeSize = React.useCallback((sizePercentage: number) => {
    if (
      treeVisible &&
      previewVisible &&
      !transitioningRef.current &&
      sizePercentage >= TREE_MIN_SIZE &&
      sizePercentage < 100
    ) {
      previousTreeSizeRef.current = clampTreeSize(sizePercentage)
    }
  }, [previewVisible, treeVisible])

  const markUserResizedTree = React.useCallback(() => {
    userOverrideRef.current = true
    fitAnimationRef.current?.stop()
    fitAnimationRef.current = null
  }, [])

  const fitTreeToNameOverflow = React.useCallback((overflowPx: number) => {
    if (
      !treeVisible ||
      !previewVisible ||
      panelTransitioning ||
      transitioningRef.current ||
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
  }, [panelTransitioning, previewVisible, treePanelRef, treeVisible])

  const onTreeStructureChange = React.useCallback(() => {
    userOverrideRef.current = false
  }, [])

  return {
    fitTreeToNameOverflow,
    markUserResizedTree,
    onTreeStructureChange,
    panelTransitioning,
    previewPaneContentRef,
    previewVisible,
    rememberTreeSize,
    setDesktopPreviewVisibility,
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
