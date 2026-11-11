# File tree expand and collapse performance

File-name overflow measurement uses the browser's existing font and whitespace
metrics. It reads visible row fonts and available widths first, appends all
uncached measurement spans together, reads their widths together, then removes
them. Widths are cached by font and name for the pane's lifetime and invalidated
when document fonts finish loading or fail. Resizing still reads current slot
widths. The 8 px overflow threshold and 12 px growth buffer are unchanged.

```text
Visible names -> read fonts and slots -> cache lookup
                                          |
                                 uncached names only
                                          v
                              insert all -> read all -> remove all
                                          |
                                          v
                              maximum overflow -> existing panel animation
```

Previously, writing and measuring one hidden span for each row repeatedly
forced layout of the page. Loaded session messages made those layout passes
much more expensive. Batching removes the per-name layout cycle; caching avoids
probe insertion entirely for repeated names.

## Flat virtual list

The shared tree renders a flat list of the rows that are currently visible
(`file-tree-rows.ts`), not nested folder panels. `@tanstack/react-virtual`
computes the window from the scroll surface the host marks with
`data-file-tree-scroll`; the tree mounts the rows within 12 rows of the
viewport, the row that holds keyboard focus, and the pinned ancestors. A tree
of 816 rows used to keep about 20,000 elements in the document and relaid all
of them whenever the pane changed width; it now mounts about 50 rows.

```text
scroll surface [data-file-tree-scroll]
└─ Tree (role=tree)
   └─ list box   height = rows × 27 − 1
      ├─ pinned ancestors   position: sticky, top = level × 26, first in DOM order
      └─ windowed rows      position: absolute, top = index × 27
```

Rows are memoized on their current expansion, focus, selection, search,
loading, item data, sibling position, list index and pinned state. Headless
Tree item instances are mutable, so memoizing only the instance would leave
those states stale. Level, sibling position and subtree extent come from the
flat list, which is rebuilt only when the open folders or the directory model
change; a scroll re-renders the tree component but its rows bail out.

Every mounted row is a child of the same list box and rows are rendered in
ascending index order. A pinned ancestor always has a lower index than the rows
in the window, so pinning or releasing a folder changes its `position` and
never moves or remounts its element: focus, hover and the marquee state
survive. Pinned rows are the only rows in normal flow. Each sits at the top of
the list box and gives its height back with a negative margin, so `sticky`
holds it in its slot on the compositor. Only the push-out phase, when the last
row of a folder's subtree carries it away, is positioned from the scroll offset
with a transform.

```text
scroll offset -> slot d at offset + d × 26
              -> the level-d ancestor of the row under that slot
              -> pinned if it is an open folder with children whose own row
                 has scrolled above the slot
              -> shifted up once its subtree's last row reaches the slot
```

The list's offset inside the scroll surface (`scrollMargin`) is measured, not
assumed: the Skills page stacks several trees and section headers in one
surface. It is re-read on scroll and when the surface or its children resize.

Collapsed descendants and rows outside the window are unmounted. The loaded
directory model is kept, so reopening a folder or scrolling back does not
request it again; rows, their context menus and observers are created again.
Expanding or collapsing keeps the 200 ms ease-out push of the nested panels,
with a gradient along the folding direction. Rows stay at their final places; the list box animates two
registered custom properties with the Web Animations API, `--file-tree-reveal`
(a length from 0 to the height of the block) and
`--file-tree-reveal-progress` (0 to 1), and rows derive their style from them,
so the motion needs no React render per frame.

```text
open:   children   mask: opaque above the edge at seam + reveal, transparent
                   below it, with a vertical gradient up to one row tall
        rows below translate by reveal − distance   (they ride the edge down)
close:  children   kept for 200 ms (inert, aria-hidden), same mask
        rows below translate by reveal              (they ride the edge up)
```

The gradient is a mask along the direction of the motion, not an opacity on
the rows: a row is solid except where it nears the moving edge. Its height is
`26px × (1 − progress)`, so it is widest while the block is closed and becomes
a hard edge once the block is fully open.

`fileTreeToggle` starts the motion only when the row list changes by one
contiguous block, which is what a folder opening, closing or receiving its
listing does; a search or a refresh is applied at once. While a block opens,
the rows it pushes out stay mounted until they have left, and a closing block
keeps the list's height until it is covered so the scroll position is not
clamped under the moving rows. Reduced motion switches without animating. Rows
that scroll into the window do not animate.
Indent guides are drawn by each row, one per ancestor level, and bridge the
1 px gap to the next row.

Keyboard focus can move to a row outside the window. Headless Tree's
`scrollToItem` hook scrolls the list so the target clears the ancestors pinned
above it before the library focuses the element; the focused row stays mounted
while it is scrolled out of view, so arrow keys keep working from there.
Headless Tree moves DOM focus on a 20 ms poll and falls back to the first row
when its target has no element after 500 ms.

First expansion of a directory used to spend one long frame on: rendering the
whole tree twice (click, then data arrival), Base UI Collapsible layout effects,
the address bar's `layout` projection re-measuring the page, and the name
measurement plus `panel.getSize()` forcing further layouts before the first
paint — the width-fit spring then started late and visibly jumped. Now:

- Only the rows in the window render on click and on data arrival.
- The overflow report waits one painted frame (double `requestAnimationFrame`)
  so the new rows are on screen before measuring; `fitTreeToNameOverflow`
  returns before `getSize()` when the overflow is under the threshold.
- Measurement probes live in one persistent `contain: strict` host, so probe
  insertion and removal no longer dirty the page layout that `getSize()` reads.
- The address bar container is a plain `div`: it fills its parent, so its
  `layout` animation never had anything to animate but re-measured the page on
  every breadcrumb change. `FileGoToControl` is memoized so its `layout` /
  `layoutId` elements only re-measure when it actually re-renders.
- While the fit spring runs (`fitAnimating`), `FileBrowserWorkspace` skips the
  per-frame preview toolbar measurement and measures once when it ends.

```text
click -> render window -> fetch -> render window + mount new rows -> paint
      -> next frame: measure visible names (contained probes) -> fit spring
      -> spring frames: panel.resize only; toolbar measure deferred to the end
```

The fit now grows to the names in view (with the existing 64 px margin) and
grows again as more rows scroll into view; before, the same expansion often
jumped straight to the maximum width.

Skills, Workspace and Data and Usage file browsers share 26 px rows with 3 px
vertical padding and 1 px gaps. Sticky offsets and off-screen intrinsic sizes
use the same row height. The `compact` option only changes metadata columns.

Pinned folder labels keep the same `accent` background as selected labels,
including while hovered; their opaque `card` backing covers indentation and
rounded corners. This does not change the actual selection. The working-directory
picker uses the same scroll surface as `FileTreePane`: a `card` background, no
top or side padding, bottom padding, stable scrollbar gutter, inline-size
containment and contained overscroll. The shared tree therefore keeps the same
sticky edges and background in both views, including dark mode.

Only expanded folders with children can acquire the sticky highlight. The row
is pinned while its normal position has passed the sticky boundary and its
subtree still has enough height below that boundary; both are computed from the
scroll offset and the flat list. Collapsed and empty folders scrolling under
an ancestor, and expanded folders pushed out by the end of their subtree, keep
their normal background. Real selection remains independent of this state.

```text
Expanded folder with children
  + start crossed boundary + subtree end below boundary -> sticky background
  + subtree end crossed boundary                       -> normal background
Collapsed / empty folder                               -> normal background
Selected row                                           -> selected background
```

The working-directory picker, Workspace and Data and Usage file browsers keep
the directory API's canonical `WORKSPACE_DIR` as their tree root. Breadcrumbs
and deep-navigation ancestor reads stop there; descendants still load on demand.
The directory API rejects paths outside that root and omits symlinks whose
targets are outside it. Skills retain their independent resource API and roots.

```text
Directory listing root -> WORKSPACE_DIR -> selected path's ancestors
                                      -> expanded folders' immediate children
```

## Verification

From the repository root:

```sh
./services/agent-runner/ts/node_modules/.bin/tsx --tsconfig agent-ui/tsconfig.app.json --test agent-ui/tests/features/file-browser/file-browser-scope.test.ts agent-ui/tests/features/file-browser/file-tree-rows.test.ts
node --test agent-ui/tests/features/file-browser/file-tree-content-width.test.ts
```

The tests assert batched read/write ordering, duplicate-name caching, distinct
fonts, current slot widths after resizing, empty names, font invalidation, the
persistent contained probe host and its disposal, and the flat list: display
order, level, sibling position and subtree extent, which ancestors are pinned at
a scroll offset (closed and empty folders never, a folder pushed out with the
last row of its subtree), and the offset that reveals a row beneath its pinned
ancestors. From
`agent-ui/`, run `npm run lint` and `npm run build` for static analysis and
production compilation.

For real browser regression checks, start `npm run dev` in `agent-ui/`, open
`/tests/features/file-browser/file-tree-browser.html`, and click **Run file tree
checks**. The standalone page needs no backend or session data. It exercises
the flat list geometry, indent guides, collapsed rows
leaving the list, selection, arrow-key navigation, sibling insertion, search
and loading indicators. Sticky checks cover the slot each pinned ancestor rests
in, that pinning keeps the same element, collapsed/empty folders underneath
pinned ancestors, a subtree pushing its header out, and retained selection.
Motion checks cover the 200 ms duration, the rows below riding the moving
edge, the vertical gradient that ends at that edge, and the rows a closing
folder keeps on screen. Windowing checks use a 600-file folder: the mounted row count, the first and
last rows, a pinned folder above its scrolling children, the focused row kept
outside the window, and keyboard navigation scrolling its target into view.
Append `?dark=1` for dark mode. It also
compares cached measurements with the previous DOM algorithm for 36 combinations
of fonts, names and slot widths, including CJK, emoji and whitespace.

In the actual app, load a session containing code and tables, then expand and
collapse both a parent with many children and a small nested folder. Verify
sticky rows while scrolling, context menus, interrupted transitions and file
preview selection. In a browser performance trace, repeated cached toggles
should have no file-name probe reads and no per-name forced layout loop.
Absolute frame durations still depend on tree size, message content, browser
load and whether the development or production build is running.

A local development-build check with 67 tree rows and a loaded session containing
656 message DOM descendants recorded zero measurement-probe reads for cached
parent toggles. The sampled collapse/expand took approximately 65/48 ms of React
render time, with maximum frame intervals of 110/107 ms. This sample still
contains long frames; the per-name forced-layout loop and repeated descendant
mounting have been removed. The browser regression page passed 52 checks, and
the focused Node suite passed 9 tests.

2026-09-12, development build, Workspace at 760 px with a 150 px tree pane,
first expansion of an unloaded directory (click frame / data-arrival frame):
93 new rows 34 ms / 199 ms → under 20 ms / 125 ms; 4 new rows 52 ms / 71 ms →
36 ms / 43 ms. Long tasks dropped from 198 ms to 116 ms for 93 rows and to none
for 4 rows. The remaining data-arrival cost is mounting the new rows themselves
(Base UI Collapsible, context menu and tooltip per row). The browser regression
page passed 60 checks.

2026-11-11, development build, headless Chrome, 816 tree rows, dragging the
Workspace divider about 470 px in 2 s: document elements about 21,900 → about
3,000, mounted tree rows 816 → about 50. With no file open, frames over 50 ms
42 → 0 and main-thread time 3,577 ms → about 1,050 ms; with an XLSX preview
active, 41 → 0 and about 4,070 ms → about 1,000–1,100 ms. The browser
regression page passed 72 checks and the focused Node suite passed 13 tests.
The Skills and Git workspace regression pages pass. The project-directory page
stops at "existing project plus starts a clean draft in that project's cwd",
which also fails without these changes, so its sticky checks further down did
not run.
