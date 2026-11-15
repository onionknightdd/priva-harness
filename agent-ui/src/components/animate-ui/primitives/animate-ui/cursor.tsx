"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { motion, useTransform, type HTMLMotionProps, type MotionValue } from "motion/react"
import { Slot, type WithAsChild } from "@animate-ui/react/primitives/slot"
import { ReducedMotionConfig, transition, useTempoTransition } from "@animate-ui/react/utils/motion"

// Adapted from https://animate-ui.com/docs/primitives/animate-ui/cursor.
// Controlled canvas coordinates replace pointer tracking and native-cursor hiding.
/*
 * MIT + Commons Clause License Condition
 * Copyright (c) 2025 Elliot Sutton
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, and distribute the Software as part of
 * an application, website, or product, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * You may use this Software, including for any commercial purpose, so long as
 * you do not sell or redistribute the components themselves in their original
 * form—whether alone or in a bundle.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

const ENTER_TRANSITION = { opacity: transition.panelIn }

type CursorPosition = { x: MotionValue<number>; y: MotionValue<number> }
export type CursorProviderProps = CursorPosition & { children: ReactNode }
const CursorContext = createContext<CursorPosition | null>(null)

function useCursorPosition() {
  const context = useContext(CursorContext)
  if (!context) throw new Error("Cursor and CursorFollow require a CursorProvider")
  return context
}

export function CursorProvider({ x, y, children }: CursorProviderProps) {
  const position = useMemo(() => ({ x, y }), [x, y])
  return <CursorContext.Provider value={position}><ReducedMotionConfig>{children}</ReducedMotionConfig></CursorContext.Provider>
}

export type CursorProps = WithAsChild<HTMLMotionProps<"div"> & { children: ReactNode }>

export function Cursor({ asChild = false, style, transition: transitionProp, ...props }: CursorProps) {
  const { x, y } = useCursorPosition()
  const enterTransition = useTempoTransition(ENTER_TRANSITION)
  const Component = asChild ? Slot : motion.div
  return <Component data-slot="cursor" data-active="true"
    style={{ pointerEvents: "none", position: "absolute", top: 0, left: 0, zIndex: 9999, x, y, ...style }}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    transition={transitionProp ?? enterTransition} {...props} />
}

export type CursorFollowProps = WithAsChild<HTMLMotionProps<"div"> & {
  children: ReactNode
  offsetX?: number
  offsetY?: number
}>

export function CursorFollow({ asChild = false, offsetX = 16, offsetY = 24, style, transition: transitionProp, ...props }: CursorFollowProps) {
  const { x, y } = useCursorPosition()
  const enterTransition = useTempoTransition(ENTER_TRANSITION)
  // Drawing owns the timing: local offsets must not add a second easing clock.
  const targetX = useTransform(x, value => value + offsetX)
  const targetY = useTransform(y, value => value + offsetY)
  const Component = asChild ? Slot : motion.div
  return <Component data-slot="cursor-follow" data-active="true"
    style={{ pointerEvents: "none", position: "absolute", top: 0, left: 0, zIndex: 9998, x: targetX, y: targetY, ...style }}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    transition={transitionProp ?? enterTransition} {...props} />
}
