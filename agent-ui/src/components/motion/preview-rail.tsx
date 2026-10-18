"use client";
// beui.dev/components/motion/preview-rail

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export interface PreviewRailItem {
  id: string;
  label: string;
  ariaLabel?: string;
  description?: ReactNode;
  href?: string;
  target?: "_blank" | "_self" | "_parent" | "_top";
  rel?: string;
}

export interface PreviewRailProps {
  items: PreviewRailItem[];
  label?: string;
  orientation?: "vertical" | "horizontal";
  activeId?: string;
  defaultActiveId?: string;
  onActiveChange?: (id: string) => void;
  onItemSelect?: (item: PreviewRailItem) => void;
  renderPreview?: (item: PreviewRailItem) => ReactNode;
  showPreview?: boolean;
  previewSide?: "before" | "after";
  highlightActive?: boolean;
  itemSize?: number;
  children?: ReactNode;
  className?: string;
  railClassName?: string;
  previewContainerClassName?: string;
  previewClassName?: string;
}

type Preview = { id: string; source: "hover" | "focus" | "tap" };
type Press = { id: string; pointerType: string; previewed: boolean };

function DefaultPreview({ item }: { item: PreviewRailItem }) {
  return (
    <div
      data-slot="preview-rail-card"
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <p
        data-slot="preview-rail-title"
        className="font-medium text-card-foreground"
      >
        {item.label}
      </p>
      {item.description ? (
        <div
          data-slot="preview-rail-description"
          className="mt-1 text-sm leading-6 text-muted-foreground"
        >
          {item.description}
        </div>
      ) : null}
    </div>
  );
}

export function PreviewRail({
  items,
  label = "Section navigation",
  orientation = "vertical",
  activeId,
  defaultActiveId,
  onActiveChange,
  onItemSelect,
  renderPreview,
  showPreview = true,
  previewSide = "after",
  highlightActive = false,
  itemSize = 24,
  children,
  className,
  railClassName,
  previewContainerClassName,
  previewClassName,
}: PreviewRailProps) {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [internalActiveId, setInternalActiveId] = useState(
    defaultActiveId ?? items[0]?.id ?? "",
  );
  // The latest interaction owns the card; leaving it must not restore an
  // older hover, focus, or tap behind the currently displayed preview.
  const [preview, setPreview] = useState<Preview | null>(null);
  const pressRef = useRef<Press | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      pressRef.current = null;
      if (event.key === "Escape") setPreview(null);
    };
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      pressRef.current = null;
      setPreview(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  const requestedActiveId = activeId ?? internalActiveId;
  const selectedId = items.some((item) => item.id === requestedActiveId)
    ? requestedActiveId
    : (items[0]?.id ?? "");
  const displayedId = preview?.id ?? "";
  const highlightedId = displayedId || (highlightActive ? selectedId : "");
  const displayedIndex = items.findIndex((item) => item.id === highlightedId);
  const rowTemplate = items.length
    ? `repeat(${items.length}, ${itemSize}px)`
    : undefined;
  const isHorizontal = orientation === "horizontal";
  const previewItem = items.find((item) => item.id === displayedId);
  const previewOffset = (displayedIndex - (items.length - 1) / 2) * itemSize;
  const previewTransform = isHorizontal
    ? `translateX(${previewOffset}px)`
    : `translateY(${previewOffset}px)`;

  const selectItem = (id: string) => {
    if (activeId === undefined) setInternalActiveId(id);
    onActiveChange?.(id);
  };

  return (
    <div
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          pressRef.current = null;
          setPreview((current) => current?.source === "hover" ? current : null);
        }
      }}
      onPointerCancel={() => { pressRef.current = null; }}
      className={cn(
        "isolate relative flex w-full overflow-visible",
        isHorizontal
          ? "min-h-64 flex-col items-center justify-center"
          : "min-h-80",
        className,
      )}
    >
      <nav
        aria-label={label}
        onPointerLeave={(event) => {
          // Touch leaves on lift. Only a hover owns this boundary, including
          // a mouse that was pressed and dragged through other ticks.
          if (event.pointerType !== "touch") {
            setPreview((current) => current?.source === "hover" ? null : current);
          }
        }}
        style={
          isHorizontal
            ? { gridTemplateColumns: rowTemplate }
            : { gridTemplateRows: rowTemplate }
        }
        className={cn(
          "relative z-10 grid shrink-0",
          isHorizontal
            ? "h-12 w-fit max-w-full self-center justify-center"
            : "w-12 content-center",
          railClassName,
        )}
      >
        {items.map((item, index) => {
          const selected = item.id === selectedId;
          const highlighted = item.id === highlightedId;
          const distance =
            displayedIndex < 0 ? Number.POSITIVE_INFINITY : Math.abs(index - displayedIndex);
          const scale = highlighted
            ? 16 / 27
            : distance === 1
              ? 4 / 9
              : distance === 2
                ? 1 / 3
                : 0.25;

          const itemContent = (
            <>
              <motion.span
                data-slot="preview-rail-tick"
                aria-hidden="true"
                animate={{ transform: isHorizontal ? `scaleY(${scale})` : `scaleX(${scale})` }}
                transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                className={cn(
                  "block bg-current",
                  isHorizontal
                    ? "h-12 w-0.5 origin-bottom"
                    : "h-0.5 w-6 origin-left",
                  highlighted ? "text-foreground" : undefined,
                )}
              />
            </>
          );

          const sharedClassName = cn(
            "relative flex text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            isHorizontal
              ? "h-12 w-6 items-end justify-center"
              : "h-6 w-12 items-center",
          );
          const sharedStyle = isHorizontal
            ? { width: itemSize }
            : { height: itemSize };
          const handlePointerEnter = (event: PointerEvent<HTMLElement>) => {
            if (event.pointerType !== "touch" && event.buttons === 0) {
              setPreview({ id: item.id, source: "hover" });
            }
          };
          const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
            if (event.button !== 0) {
              pressRef.current = null;
              return;
            }
            pressRef.current = {
              id: item.id,
              pointerType: event.pointerType,
              previewed: preview?.source === "tap" && preview.id === item.id,
            };
            if (event.pointerType === "mouse") {
              setPreview({ id: item.id, source: "hover" });
            } else {
              setPreview((current) => current?.source === "focus" ? null : current);
            }
          };
          const handleFocus = (currentTarget: HTMLElement) => {
            if (!pressRef.current && currentTarget.matches(":focus-visible")) {
              setPreview({ id: item.id, source: "focus" });
            }
          };
          const handleSelect = (event: MouseEvent<HTMLElement>) => {
            const press = pressRef.current;
            pressRef.current = null;
            // Keyboard and programmatic clicks have detail 0. They must not
            // inherit an unfinished touch, even on the same tick.
            const tapped = event.detail > 0 && press?.id === item.id && press.pointerType !== "mouse";

            if (tapped) {
              // A link would otherwise show its preview and leave the page in
              // the same tap, so the card is never read: the first tap lights
              // the tick, the second follows the link.
              setPreview({ id: item.id, source: "tap" });
              if (showPreview && item.href && !press.previewed) {
                event.preventDefault();
                return;
              }
            }

            selectItem(item.id);
            onItemSelect?.(item);
          };

          return item.href ? (
            <a
              key={item.id}
              data-slot="preview-rail-item"
              href={item.href}
              target={item.target}
              rel={
                item.rel ??
                (item.target === "_blank" ? "noreferrer noopener" : undefined)
              }
              aria-label={item.ariaLabel ?? item.label}
              aria-current={selected ? "page" : undefined}
              onPointerEnter={handlePointerEnter}
              onPointerDown={handlePointerDown}
              onFocus={(event) => handleFocus(event.currentTarget)}
              onClick={handleSelect}
              style={sharedStyle}
              className={sharedClassName}
            >
              {itemContent}
            </a>
          ) : (
            <button
              key={item.id}
              data-slot="preview-rail-item"
              type="button"
              aria-label={item.ariaLabel ?? item.label}
              aria-current={selected ? "location" : undefined}
              onPointerEnter={handlePointerEnter}
              onPointerDown={handlePointerDown}
              onFocus={(event) => handleFocus(event.currentTarget)}
              onClick={handleSelect}
              style={sharedStyle}
              className={sharedClassName}
            >
              {itemContent}
            </button>
          );
        })}
      </nav>

      {showPreview ? (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute z-50 [contain:layout]",
            isHorizontal
              ? "top-1/2 left-1/2 h-5 w-full max-w-full -translate-x-1/2 -translate-y-1/2"
              : previewSide === "before"
                ? "top-0 bottom-0 right-16 left-4"
                : "top-0 bottom-0 right-4 left-16",
            previewContainerClassName,
          )}
        >
          {/* One card retargets from its current position. Switching ticks must
              not remount the content or restart an enter/exit sequence. */}
          <AnimatePresence>
            {previewItem ? (
              <motion.div
                key="preview"
                data-slot="preview-rail-position"
                initial={{ opacity: 0, transform: previewTransform }}
                animate={{ opacity: 1, transform: previewTransform }}
                exit={{ opacity: 0 }}
                transition={reduce ? { duration: 0 } : {
                  transform: SPRING_LAYOUT,
                  opacity: { duration: 0.12, ease: EASE_OUT },
                }}
                className={isHorizontal
                  ? "absolute left-1/2 h-full"
                  : "absolute top-1/2 w-full"}
              >
                <div
                  className={cn(
                    isHorizontal
                      ? "absolute bottom-12 left-0 w-72 -translate-x-1/2"
                      : cn("w-full max-w-sm -translate-y-1/2", previewSide === "before" && "ml-auto"),
                    previewClassName,
                  )}
                >
                  {renderPreview ? renderPreview(previewItem) : <DefaultPreview item={previewItem} />}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}

      {children ? (
        <div className="min-h-0 min-w-0 flex-1">{children}</div>
      ) : null}
    </div>
  );
}
