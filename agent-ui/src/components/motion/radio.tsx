"use client";
// beui.dev/components/motion/radio

import { motion, MotionConfig, useReducedMotion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { SPRING_LAYOUT, SPRING_PRESS } from "@/lib/ease";
import { cn } from "@/lib/utils";

type RadioCtx = {
  value: string;
  setValue: (value: string) => void;
  layoutId: string;
};

const RadioCtx = createContext<RadioCtx | null>(null);

function useRadioGroup() {
  const ctx = useContext(RadioCtx);
  if (!ctx) {
    throw new Error("RadioGroupItem must be used inside <RadioGroup>");
  }
  return ctx;
}

export interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
  orientation?: "vertical" | "horizontal";
  "aria-label"?: string;
}

export function RadioGroup({
  value,
  defaultValue = "",
  onValueChange,
  children,
  className,
  orientation = "vertical",
  "aria-label": ariaLabel,
}: RadioGroupProps) {
  const [internal, setInternal] = useState(defaultValue);
  const layoutId = useId();
  const reduce = useReducedMotion();
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const setValue = useCallback(
    (next: string) => {
      if (!controlled) setInternal(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange],
  );
  const contextValue = useMemo(
    () => ({ value: current, setValue, layoutId }),
    [current, layoutId, setValue],
  );

  return (
    <MotionConfig transition={reduce ? { duration: 0 } : SPRING_LAYOUT}>
      <RadioCtx.Provider value={contextValue}>
        <div
          role="radiogroup"
          aria-label={ariaLabel}
          className={cn(
            "flex gap-3",
            orientation === "vertical" ? "flex-col" : "flex-row flex-wrap",
            className,
          )}
        >
          {children}
        </div>
      </RadioCtx.Provider>
    </MotionConfig>
  );
}

export interface RadioGroupItemProps {
  value: string;
  label?: string;
  /** Supporting text under the label, announced as the description rather than the name. */
  description?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** `sm` matches a 14px text-sm line. */
  size?: "default" | "sm";
}

export function RadioGroupItem({
  value,
  label,
  description,
  disabled,
  className,
  id: idProp,
  size = "default",
}: RadioGroupItemProps) {
  const { value: groupValue, setValue, layoutId } = useRadioGroup();
  const autoId = useId();
  const id = idProp ?? autoId;
  const reduce = useReducedMotion();
  const selected = groupValue === value;
  const descriptionId = description ? `${id}-description` : undefined;
  // The wrapping label would fold the description into the name, so name from the label text alone.
  const labelId = description && label ? `${id}-label` : undefined;

  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex gap-3",
        description ? "items-start" : "items-center",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      <motion.button
        id={id}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => !disabled && setValue(value)}
        whileTap={reduce || disabled ? undefined : { scale: 0.92 }}
        transition={SPRING_PRESS}
        data-state={selected ? "checked" : "unchecked"}
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center rounded-full outline-none transition-colors duration-200",
          size === "sm" ? "size-3.5 border" : "h-5 w-5 border-2",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-60",
          // BeUI's primary is #0285f7. The app primary token is neutral.
          selected
            ? "border-[#0285f7]"
            : "border-muted-foreground/50 hover:border-muted-foreground",
        )}
      >
        {selected ? (
          <motion.span
            layoutId={layoutId}
            className={cn(
              "absolute rounded-full bg-[#0285f7]",
              size === "sm" ? "inset-[3px]" : "inset-1",
            )}
            transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
          />
        ) : null}
      </motion.button>
      {label || description ? (
        <span className={cn("flex min-w-0 flex-col gap-0.5 select-none", disabled && "opacity-60")}>
          {label ? (
            <span
              id={labelId}
              // A 16px line lifts the text onto the 20px control.
              className={cn("text-sm text-foreground", description && "leading-4")}
            >
              {label}
            </span>
          ) : null}
          {description ? (
            <span id={descriptionId} className="text-xs text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}
