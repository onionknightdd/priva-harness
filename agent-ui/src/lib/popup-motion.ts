// Shared enter/exit motion for Base UI popups. Base UI toggles
// `data-starting-style` / `data-ending-style` around mount/unmount, so plain
// CSS transitions drive the animation. Transitions (unlike the tw-animate
// keyframes they replace) retarget mid-flight, so rapidly toggling a menu
// never restarts from zero. Exits are always faster than entrances.

/** Anchored popups: menus, popovers, selects, combobox lists, hover cards. */
export const popupMotion =
  "transition-[opacity,scale,translate] duration-160 ease-out data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 data-ending-style:duration-100 motion-reduce:transition-none"

/** Popups nudge in from the trigger side and leave the same way. */
export const popupSlide =
  "data-[side=bottom]:data-starting-style:-translate-y-1 data-[side=bottom]:data-ending-style:-translate-y-1 data-[side=top]:data-starting-style:translate-y-1 data-[side=top]:data-ending-style:translate-y-1 data-[side=left]:data-starting-style:translate-x-1 data-[side=left]:data-ending-style:translate-x-1 data-[side=inline-start]:data-starting-style:translate-x-1 data-[side=inline-start]:data-ending-style:translate-x-1 data-[side=right]:data-starting-style:-translate-x-1 data-[side=right]:data-ending-style:-translate-x-1 data-[side=inline-end]:data-starting-style:-translate-x-1 data-[side=inline-end]:data-ending-style:-translate-x-1"

/** Tooltips: quicker than menus, and instant when Base UI says so (`data-instant`
 * is set when a sibling tooltip in the same provider was just open). */
export const tooltipMotion =
  "transition-[opacity,scale,translate] duration-125 ease-out data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-75 data-instant:transition-none motion-reduce:transition-none"

/** Centered modals keep `transform-origin: center`; they are not anchored. */
export const modalMotion =
  "transition-[opacity,scale] duration-200 ease-out data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 data-ending-style:duration-150 motion-reduce:transition-none"

/** Backdrops only fade; animating `backdrop-filter` is expensive. */
export const backdropMotion =
  "transition-opacity duration-200 ease-out data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-150 motion-reduce:transition-none"

/** Edge sheets glide on the iOS drawer curve and leave faster than they arrive. */
export const sheetMotion =
  "transition-[opacity,translate] duration-380 ease-drawer data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-220 motion-reduce:transition-none"
