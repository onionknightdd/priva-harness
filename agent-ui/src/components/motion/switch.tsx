"use client";
// beui.dev/components/motion/switch

import { animate, motion, MotionConfig, useReducedMotion } from "motion/react";
import {
  type ComponentProps,
  type FocusEventHandler,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

// Heavy, deliberate thumb — high mass keeps the travel weighty without wobble.
const THUMB_SPRING = { type: "spring", stiffness: 800, damping: 80, mass: 4 } as const;

// BeUI's 48 × 28 track and 20px thumb, scaled so the track matches the neighbor.
// sm: 20px icon buttons and text-sm lines, with a 14px thumb.
const SWITCH_SIZE = {
  default: {
    track: "h-7 w-12 px-1",
    thumb: "size-5",
    pressOn: "ml-1",
    pressOff: "mr-1",
  },
  sm: {
    track: "h-5 w-[34px] px-[3px]",
    thumb: "size-3.5",
    pressOn: "ml-[3px]",
    pressOff: "mr-[3px]",
  },
} as const;

type SwitchSize = keyof typeof SWITCH_SIZE;

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
  className?: string;
  size?: SwitchSize;
  // External labels and schema fields address the control by a stable id.
  id?: string;
  "aria-invalid"?: ComponentProps<"button">["aria-invalid"];
  "aria-describedby"?: string;
  onBlur?: FocusEventHandler<HTMLButtonElement>;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  ariaLabel,
  className,
  size = "default",
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  onBlur,
  onFocus,
}: SwitchProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const thumbRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [isPressed, setIsPressed] = useState(false);
  const [isPointer, setIsPointer] = useState(false);

  // Disabled shake feedback when pressed.
  useEffect(() => {
    if (!thumbRef.current || reduce) return;
    if (disabled && isPressed) {
      animate(
        thumbRef.current,
        { x: [0, -2, 2, -1, 0] },
        { delay: 0.2, duration: 0.6 },
      );
    }
  }, [disabled, isPressed, reduce]);

  const squish = !disabled && isPointer && isPressed && !reduce;
  const metrics = SWITCH_SIZE[size];

  return (
    <MotionConfig transition={reduce ? { duration: 0 } : THUMB_SPRING}>
      <span className={cn("inline-flex items-center gap-3", className)}>
        <motion.button
          id={controlId}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          onBlur={onBlur}
          onFocus={onFocus}
          onClick={() => !disabled && onCheckedChange(!checked)}
          onPointerDown={(e) => {
            setIsPressed(true);
            setIsPointer(e.type.startsWith("pointer"));
          }}
          onPointerUp={() => setIsPressed(false)}
          onPointerLeave={() => setIsPressed(false)}
          initial={false}
          data-state={checked ? "checked" : "unchecked"}
          className={cn(
            "group peer inline-flex shrink-0 cursor-pointer items-center rounded-full outline-none transition-colors duration-200",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-60",
            metrics.track,
            // BeUI's primary is #0285f7. The app primary token is neutral, so the track keeps the component color.
            checked ? "justify-end bg-[#0285f7]" : "justify-start bg-muted-foreground/60",
          )}
        >
          <motion.div
            ref={thumbRef}
            layout
            animate={{ scale: squish ? 0.9 : 1 }}
            className={cn(
              "pointer-events-none block rounded-full bg-background shadow-md",
              metrics.thumb,
            )}
          >
            {/* Stretch toward the destination while active. */}
            <div
              className={cn(
                metrics.thumb,
                squish && (checked ? metrics.pressOn : metrics.pressOff),
              )}
            />
          </motion.div>
        </motion.button>
        {label ? (
          <label htmlFor={controlId} className="cursor-pointer text-sm text-foreground">
            {label}
          </label>
        ) : null}
      </span>
    </MotionConfig>
  );
}
