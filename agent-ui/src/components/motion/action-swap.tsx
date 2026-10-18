"use client";

import { AnimatePresence, motion, useReducedMotion, useReducedMotionConfig, type HTMLMotionProps, type Variants } from "motion/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { CascadeText } from "./cascade-text";

export type ActionSwapItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  ariaLabel?: string;
};

export type ActionSwapButtonVariant = "primary" | "secondary" | "outline" | "ghost";
export type ActionSwapButtonSize = "sm" | "md" | "lg" | "icon";
export type ActionSwapAnimation = "blur" | "roll" | "cascade";

/** Animations with a single-element variant set (cascade animates per letter). */
type CoreAnimation = "blur" | "roll";

export interface ActionSwapButtonProps extends Omit<
  HTMLMotionProps<"button">,
  "children" | "onChange"
> {
  items: ActionSwapItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string, item: ActionSwapItem) => void;
  variant?: ActionSwapButtonVariant;
  size?: ActionSwapButtonSize;
  animation?: ActionSwapAnimation;
  iconOnly?: boolean;
  cycle?: boolean;
}

export interface ActionSwapTextProps {
  value: string;
  children: ReactNode;
  animation?: ActionSwapAnimation;
  animateOnMount?: boolean;
  className?: string;
  /** Applied to each cascade glyph, and to the whole label when cascade falls back. */
  glyphClassName?: string;
}

export interface ActionSwapIconProps {
  value: string;
  children: ReactNode;
  animation?: ActionSwapAnimation;
  className?: string;
}

const BLUR_TRANSITION = { duration: 0.2, ease: "easeInOut" } as const;
const ROLL_TRANSITION = SPRING_SWAP;
const ROLL_EXIT_TRANSITION = { duration: 0.14, ease: EASE_OUT } as const;
const SWAP_BLUR = "blur(8px)";
const ROLL_BLUR = "blur(3px)";

const TEXT_VARIANTS: Record<CoreAnimation, Variants> = {
  blur: {
    initial: { opacity: 0, scale: 0.94, filter: SWAP_BLUR },
    animate: {
      opacity: 1,
      scale: 1,
      filter: "blur(0px)",
      transition: BLUR_TRANSITION,
    },
    exit: {
      opacity: 0,
      scale: 0.94,
      filter: SWAP_BLUR,
      transition: BLUR_TRANSITION,
    },
  },
  roll: {
    initial: { opacity: 0, y: "90%", filter: ROLL_BLUR },
    animate: {
      opacity: 1,
      y: "0%",
      filter: "blur(0px)",
      transition: ROLL_TRANSITION,
    },
    exit: {
      opacity: 0,
      y: "-90%",
      filter: ROLL_BLUR,
      transition: ROLL_EXIT_TRANSITION,
    },
  },
};

const ICON_VARIANTS: Record<CoreAnimation, Variants> = {
  blur: {
    initial: { opacity: 0, scale: 0.25, filter: SWAP_BLUR },
    animate: {
      opacity: 1,
      scale: 1,
      filter: "blur(0px)",
      transition: BLUR_TRANSITION,
    },
    exit: {
      opacity: 0,
      scale: 0.25,
      filter: SWAP_BLUR,
      transition: BLUR_TRANSITION,
    },
  },
  roll: {
    initial: { opacity: 0, y: 12, filter: ROLL_BLUR },
    animate: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: ROLL_TRANSITION,
    },
    exit: {
      opacity: 0,
      y: -12,
      filter: ROLL_BLUR,
      transition: ROLL_EXIT_TRANSITION,
    },
  },
};

const VARIANT_CLASS: Record<ActionSwapButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border border-border bg-card text-foreground hover:border-border",
  outline: "border border-border bg-transparent text-foreground hover:bg-primary/5",
  ghost: "text-muted-foreground hover:bg-primary/5 hover:text-foreground",
};

const SIZE_CLASS: Record<ActionSwapButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-full px-3 text-xs",
  md: "h-10 gap-2 rounded-full px-4 text-sm",
  lg: "h-12 gap-2.5 rounded-full px-5 text-base",
  icon: "h-10 w-10 rounded-full",
};

export function ActionSwapText({
  value,
  children,
  animation = "blur",
  animateOnMount = false,
  className,
  glyphClassName,
}: ActionSwapTextProps) {
  const reduce = useReducedMotionConfig();

  // Cascade needs a plain string to split into letters; non-string content
  // falls back to the closest single-element animation.
  const label = typeof children === "string" ? children : null;
  const coreAnimation: CoreAnimation =
    animation === "cascade" ? "roll" : animation;

  if (animation === "cascade" && label !== null) {
    return <CascadeText value={value} text={label} animateOnMount={animateOnMount} reduce={Boolean(reduce)} className={className} glyphClassName={glyphClassName} />;
  }

  return (
    <span
      className={cn(
        "relative inline-block max-w-full whitespace-nowrap align-baseline",
        className,
      )}
      style={{
        clipPath: "inset(0 -999px)",
        WebkitClipPath: "inset(0 -999px)",
      }}
    >
      <span
        aria-hidden
        className="invisible whitespace-nowrap"
      >
        {children}
      </span>
      {reduce ? (
        <span className={cn("absolute inset-0 inline-block max-w-full truncate", glyphClassName)}>
          {children}
        </span>
      ) : (
        <AnimatePresence initial={animateOnMount}>
          <motion.span
            key={`${animation}-${value}`}
            variants={TEXT_VARIANTS[coreAnimation]}
            initial="initial"
            animate="animate"
            exit="exit"
            // Truncation lives on the layer that holds the text — the layer
            // moves as a whole, so clipping it never eats the roll.
            className={cn(
              "absolute inset-0 inline-block max-w-full truncate will-change-[opacity,filter,transform]",
              glyphClassName,
            )}
          >
            {children}
          </motion.span>
        </AnimatePresence>
      )}
    </span>
  );
}

export function ActionSwapIcon({
  value,
  children,
  animation = "blur",
  className,
}: ActionSwapIconProps) {
  const reduce = useReducedMotion();
  // Icons are single elements — cascade maps to its closest motion, roll.
  const coreAnimation: CoreAnimation =
    animation === "cascade" ? "roll" : animation;

  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={`${animation}-${value}`}
          aria-hidden
          variants={ICON_VARIANTS[coreAnimation]}
          initial={reduce ? false : "initial"}
          animate={reduce ? { opacity: 1, filter: "blur(0px)", scale: 1, y: 0 } : "animate"}
          exit={reduce ? undefined : "exit"}
          className="col-start-1 row-start-1 inline-flex items-center justify-center will-change-[opacity,filter,transform]"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function ActionSwapButton({
  items,
  value,
  defaultValue,
  onValueChange,
  variant = "secondary",
  size = "md",
  animation = "blur",
  iconOnly = size === "icon",
  cycle = true,
  className,
  disabled,
  onClick,
  ...rest
}: ActionSwapButtonProps) {
  const reduce = useReducedMotion();
  const [internalValue, setInternalValue] = useState(defaultValue ?? items[0]?.id);
  const currentValue = value ?? internalValue;
  const activeIndex = Math.max(0, items.findIndex((item) => item.id === currentValue));
  const activeItem = items[activeIndex] ?? items[0];
  const hasIcon = items.some((item) => item.icon);
  const nextItem = cycle && items.length > 0 ? items[(activeIndex + 1) % items.length] : undefined;

  if (!activeItem) return null;

  const accessibleLabel = activeItem.ariaLabel ?? (iconOnly && typeof activeItem.label === "string" ? activeItem.label : undefined);

  return (
    <motion.button
      type="button"
      disabled={disabled}
      whileTap={reduce || disabled ? undefined : { scale: 0.97 }}
      transition={SPRING_PRESS}
      className={cn(
        "inline-flex items-center justify-center overflow-hidden font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      aria-label={accessibleLabel}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled || !cycle || !nextItem) return;
        if (value === undefined) setInternalValue(nextItem.id);
        onValueChange?.(nextItem.id, nextItem);
      }}
      {...rest}
    >
      {hasIcon ? (
        <ActionSwapIcon value={activeItem.id} animation={animation} className="h-4 w-4">
          {activeItem.icon ?? null}
        </ActionSwapIcon>
      ) : null}
      {!iconOnly ? (
        <ActionSwapText value={activeItem.id} animation={animation}>
          {activeItem.label}
        </ActionSwapText>
      ) : null}
    </motion.button>
  );
}
