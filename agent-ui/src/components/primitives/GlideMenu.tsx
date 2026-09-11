"use client";

import { useReducedMotion } from "motion/react";
import { EASE_OUT_CSS } from "@/lib/ease";
import { useRef, useState, type ReactNode } from "react";

type GlideMenuProps = {
  children: ReactNode;
  className?: string;
  highlightClassName?: string;
  rowSelector?: string;
};

/** A single hover layer that glides between interactive menu rows. */
export default function GlideMenu({
  children,
  className = "",
  highlightClassName = "inset-x-0 rounded-[8px] bg-hover",
  rowSelector = "[data-menu-row]",
}: GlideMenuProps) {
  const reduce = Boolean(useReducedMotion());
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [visible, setVisible] = useState(false);

  const moveTo = (target: EventTarget | null) => {
    const container = ref.current;
    if (!(target instanceof Element) || !container) return;
    const row = target.closest(rowSelector);
    if (!(row instanceof HTMLElement) || !container.contains(row)) return;
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    setBox({ top: rowRect.top - containerRect.top, height: rowRect.height });
    setVisible(true);
  };

  return (
    <div
      ref={ref}
      onMouseOver={(event) => { if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) { setKeyboard(false); moveTo(event.target); } }}
      onMouseLeave={() => setVisible(false)}
      onFocusCapture={(event) => { setKeyboard(true); moveTo(event.target); }}
      onBlurCapture={(event) => {
        if (!ref.current?.contains(event.relatedTarget as Node | null)) setVisible(false);
      }}
      className={`group/glide-menu relative ${className}`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute ${highlightClassName}`}
        style={{
          top: 0,
          transform: `translateY(${box?.top ?? 0}px)`,
          height: box?.height ?? 0,
          opacity: box && visible ? 1 : 0,
          transition:
            reduce || keyboard ? undefined : `transform 150ms ${EASE_OUT_CSS}, opacity 150ms ease`,
        }}
      />
      {children}
    </div>
  );
}
