"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

type IndicatorStyle = { left: number; width: number };

const ZERO_INDICATOR: IndicatorStyle = { left: 0, width: 0 };

const TAB_INDICATOR_TRANSITION = {
  type: "spring",
  stiffness: 500,
  damping: 40,
  mass: 0.8,
} as const;

function getIndicatorStyle(
  list: HTMLElement,
  target: HTMLElement | null | undefined,
): IndicatorStyle {
  if (!target) {
    return ZERO_INDICATOR;
  }

  const listRect = list.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  return {
    left: Math.round(targetRect.left - listRect.left + list.scrollLeft),
    width: Math.round(targetRect.width),
  };
}

function sameIndicatorStyle(a: IndicatorStyle, b: IndicatorStyle) {
  return a.left === b.left && a.width === b.width;
}

type TabsListContextValue = {
  registerTrigger: (value: string, element: HTMLElement | null) => void;
  setHoveredValue: (value: string | null) => void;
};

const TabsListContext = createContext<TabsListContextValue | null>(null);

function Tabs({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("group/tabs flex flex-col gap-2", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list text-muted-foreground relative inline-flex w-fit items-center justify-center",
  {
    variants: {
      variant: {
        default: "bg-muted gap-1 rounded-lg p-1",
        line: "border-border gap-1 border-b bg-transparent pb-2",
        ghost: "gap-1.5 bg-transparent",
        pills: "gap-2 bg-transparent",
        outline: "border-border gap-1 rounded-lg border p-1",
      },
      size: {
        sm: "h-8",
        default: "h-9",
        lg: "h-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const tabsActiveIndicatorVariants = cva(
  "pointer-events-none absolute",
  {
    variants: {
      variant: {
        default:
          "bg-background dark:border-input dark:bg-input/30 inset-y-1 rounded-md shadow-sm dark:border",
        line: "bg-foreground bottom-0 h-0.5",
        ghost: "bg-foreground/8 inset-y-1 rounded-md",
        pills: "bg-primary inset-y-0 rounded-full",
        outline: "border-border bg-background inset-y-1 rounded-md border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function TabsList({
  className,
  variant,
  size,
  children,
  ...props
}: ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const resolvedVariant = variant ?? "default";
  const resolvedSize = size ?? "default";

  const triggerRefs = useRef<Map<string, HTMLElement>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = Boolean(useReducedMotion());
  const [hoveredValue, setHoveredValue] = useState<string | null>(null);
  const [activeStyle, setActiveStyle] = useState<IndicatorStyle>(ZERO_INDICATOR);
  const [hoverStyle, setHoverStyle] = useState<IndicatorStyle>(ZERO_INDICATOR);

  const registerTrigger = useCallback(
    (value: string, element: HTMLElement | null) => {
      if (element) {
        triggerRefs.current.set(value, element);
      } else {
        triggerRefs.current.delete(value);
      }
    },
    [],
  );

  useEffect(() => {
    const listElement = listRef.current;

    if (!hoveredValue || !listElement) {
      return;
    }

    const element = triggerRefs.current.get(hoveredValue);

    if (element) {
      const nextStyle = getIndicatorStyle(listElement, element);
      setHoverStyle((currentStyle) =>
        sameIndicatorStyle(currentStyle, nextStyle) ? currentStyle : nextStyle,
      );
    }
  }, [hoveredValue]);

  useEffect(() => {
    const listElement = listRef.current;
    if (!listElement) return;

    const updateActiveFromDOM = () => {
      const activeElement = listElement.querySelector(
        "[data-active]",
      ) as HTMLElement | null;
      const nextStyle = getIndicatorStyle(listElement, activeElement);
      setActiveStyle((currentStyle) =>
        sameIndicatorStyle(currentStyle, nextStyle) ? currentStyle : nextStyle,
      );
    };

    const resizeObserver = new ResizeObserver(updateActiveFromDOM);
    const observeTargets = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(listElement);
      listElement
        .querySelectorAll("[data-slot='tabs-trigger']")
        .forEach((element) => resizeObserver.observe(element));
    };

    const initialFrame = requestAnimationFrame(() => {
      observeTargets();
      updateActiveFromDOM();
    });

    const mutationObserver = new MutationObserver(() => {
      observeTargets();
      updateActiveFromDOM();
    });
    mutationObserver.observe(listElement, {
      attributes: true,
      attributeFilter: ["data-active"],
      childList: true,
      subtree: true,
    });

    return () => {
      cancelAnimationFrame(initialFrame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  const contextValue = useMemo(
    () => ({ registerTrigger, setHoveredValue }),
    [registerTrigger],
  );

  return (
    <TabsListContext.Provider value={contextValue}>
      <TabsPrimitive.List
        ref={listRef}
        data-slot="tabs-list"
        data-variant={resolvedVariant}
        data-size={resolvedSize}
        className={cn(
          tabsListVariants({ variant: resolvedVariant, size: resolvedSize }),
          className,
        )}
        {...props}
      >
        {resolvedVariant === "ghost" &&
          hoveredValue !== null &&
          hoverStyle.width !== 0 && (
            <motion.div
              data-slot="tabs-hover-indicator"
              className="bg-foreground/8 pointer-events-none absolute inset-y-1 rounded-md"
              initial={false}
              animate={{ left: hoverStyle.left, width: hoverStyle.width }}
              transition={
                shouldReduceMotion ? { duration: 0 } : TAB_INDICATOR_TRANSITION
              }
            />
          )}

        {activeStyle.width !== 0 && (
          <motion.div
            data-slot="tabs-active-indicator"
            className={tabsActiveIndicatorVariants({
              variant: resolvedVariant,
            })}
            initial={false}
            animate={{ left: activeStyle.left, width: activeStyle.width }}
            transition={
              shouldReduceMotion ? { duration: 0 } : TAB_INDICATOR_TRANSITION
            }
          />
        )}

        {children}
      </TabsPrimitive.List>
    </TabsListContext.Provider>
  );
}

function TabsTrigger({
  className,
  value,
  ...props
}: ComponentProps<typeof TabsPrimitive.Tab>) {
  const context = useContext(TabsListContext);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    context?.registerTrigger(value, ref.current);
    return () => context?.registerTrigger(value, null);
  }, [context, value]);

  const handleMouseEnter = useCallback(() => {
    context?.setHoveredValue(value);
  }, [context, value]);

  const handleMouseLeave = useCallback(() => {
    context?.setHoveredValue(null);
  }, [context]);

  return (
    <TabsPrimitive.Tab
      ref={ref}
      value={value}
      data-slot="tabs-trigger"
      data-value={value}
      className={cn(
        "text-foreground/60 hover:text-foreground focus-visible:ring-ring/50 data-active:text-foreground dark:text-muted-foreground dark:hover:text-foreground relative z-10 inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-[color] duration-300 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-active:font-medium [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=default]/tabs-list:rounded-md",
        "group-data-[variant=line]/tabs-list:rounded-md group-data-[variant=line]/tabs-list:bg-transparent",
        "group-data-[variant=ghost]/tabs-list:rounded-md group-data-[variant=ghost]/tabs-list:bg-transparent",
        "group-data-[variant=pills]/tabs-list:data-active:text-primary-foreground dark:group-data-[variant=pills]/tabs-list:data-active:text-primary-foreground group-data-[variant=pills]/tabs-list:rounded-full",
        "group-data-[variant=outline]/tabs-list:rounded-md",
        "group-data-[size=sm]/tabs-list:h-[calc(100%-8px)] group-data-[size=sm]/tabs-list:px-2 group-data-[size=sm]/tabs-list:py-0.5 group-data-[size=sm]/tabs-list:text-xs",
        "group-data-[size=default]/tabs-list:h-[calc(100%-8px)] group-data-[size=default]/tabs-list:px-3 group-data-[size=default]/tabs-list:py-1 group-data-[size=default]/tabs-list:text-sm",
        "group-data-[size=lg]/tabs-list:h-[calc(100%-8px)] group-data-[size=lg]/tabs-list:px-4 group-data-[size=lg]/tabs-list:py-1.5 group-data-[size=lg]/tabs-list:text-sm",
        className,
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  tabsListVariants,
  tabsActiveIndicatorVariants,
};
