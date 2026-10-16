"use client";
// beui.dev/components/motion/text-animation

import { ActionSwapText } from "./action-swap";

export interface TextCascadeProps {
  /** Current text. Changing it cascades the letters to the new value. */
  text: string;
  /** Animate newly added text; initial page content stays still by default. */
  animateOnMount?: boolean;
  className?: string;
  /** Applied to each letter so a shimmer can paint the glyphs themselves. */
  glyphClassName?: string;
}

/**
 * Letter-by-letter slot roll for standalone text — the old letters drop away
 * as the new ones land, left to right. Same motion as the action-swap
 * cascade variant, with a text-first API.
 */
export function TextCascade({
  text,
  animateOnMount = false,
  className,
  glyphClassName,
}: TextCascadeProps) {
  return (
    <ActionSwapText
      value={text}
      animation="cascade"
      animateOnMount={animateOnMount}
      className={className}
      glyphClassName={glyphClassName}
    >
      {text}
    </ActionSwapText>
  );
}
