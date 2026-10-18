"use client";

import { createGeneratorEasing, generateLinearEasing, spring } from "motion";
import { AnimatePresence, usePresence } from "motion/react";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { EASE_OUT_CSS, SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";

// Sample the existing spring once, rather than once per glyph and property.
const enter = createGeneratorEasing(SPRING_SWAP, 100, spring);
const enterDuration = enter.duration * 1000;
const enterEasing = generateLinearEasing(enter.ease, enterDuration);
const visible = { opacity: 1, transform: "translateY(0%)", filter: "blur(0px)" };
const incoming = { opacity: 0, transform: "translateY(105%)", filter: "blur(3px)" };
const outgoing = { opacity: 0, transform: "translateY(-105%)", filter: "blur(3px)" };
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function CascadeText({
  value, text, animateOnMount, reduce, className, glyphClassName,
}: {
  value: string;
  text: string;
  animateOnMount: boolean;
  reduce: boolean;
  className?: string;
  glyphClassName?: string;
}) {
  const previous = useRef({ mounted: false, reduce });
  useLayoutEffect(() => { previous.current = { mounted: true, reduce }; });

  return (
    <span
      className={cn("relative inline-block max-w-full whitespace-nowrap align-baseline", className)}
      // Match the original separate glyphs without keeping a measuring span
      // for every letter after the animation has finished.
      style={{ clipPath: "inset(0 -999px)", fontKerning: "none", fontVariantLigatures: "none" }}
    >
      <span aria-hidden className="invisible whitespace-pre">{text}</span>
      <span className="sr-only">{text}</span>
      {reduce ? (
        <span aria-hidden className={cn("absolute inset-0 whitespace-pre", glyphClassName)}>{text}</span>
      ) : (
        <AnimatePresence>
          <CascadeLayer
            key={value}
            text={text}
            enter={!previous.current.reduce && (previous.current.mounted || animateOnMount)}
            glyphClassName={glyphClassName}
          />
        </AnimatePresence>
      )}
    </span>
  );
}

const CascadeLayer = memo(function CascadeLayer({ text, enter: enterOnMount, glyphClassName }: {
  text: string;
  enter: boolean;
  glyphClassName?: string;
}) {
  const [present, safeToRemove] = usePresence();
  const [state, setState] = useState({ present, animating: enterOnMount });
  const ref = useRef<HTMLSpanElement>(null);
  const animations = useRef<Animation[]>([]);
  const remove = useRef(safeToRemove);
  if (state.present !== present) setState({ present, animating: true });

  // Presence callbacks can change as other keys enter; they must not restart
  // an exit that is already in progress.
  useLayoutEffect(() => { remove.current = safeToRemove; });
  useLayoutEffect(() => {
    const previous = animations.current;
    const glyphs = state.animating ? Array.from(ref.current!.children) as HTMLElement[] : [];
    // Read interrupted positions together, before cancelling or starting any
    // animation. Returning keys resume from what is actually on screen.
    const starts = glyphs.map((glyph) => {
      if (!previous.length) return present ? incoming : visible;
      const style = getComputedStyle(glyph);
      return { opacity: style.opacity, transform: style.transform, filter: style.filter };
    });
    previous.forEach((animation) => animation.cancel());
    animations.current = glyphs.map((glyph, index) => glyph.animate([
      starts[index]!, present ? visible : outgoing,
    ], {
      duration: present ? enterDuration : 160,
      easing: present ? enterEasing : EASE_OUT_CSS,
      delay: index * (present ? 25 : 12.5),
      fill: "both",
    }));
    const complete = () => {
      if (present) setState({ present: true, animating: false });
      else remove.current?.();
    };
    const last = animations.current.at(-1);
    if (last) last.onfinish = complete;
    else if (!present) remove.current?.();
    return () => { if (last) last.onfinish = null; };
  }, [present, state.animating, text]);

  useLayoutEffect(() => () => {
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
  }, []);

  return (
    <span ref={ref} aria-hidden className={cn("absolute inset-0 whitespace-pre", !state.animating && glyphClassName)}>
      {state.animating ? Array.from(segmenter.segment(text), ({ segment }, index) => (
        <span key={index} className={cn("inline-block whitespace-pre", glyphClassName)}>{segment}</span>
      )) : text}
    </span>
  );
});
