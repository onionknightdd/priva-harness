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

Rows are memoized using their current expansion, focus, selection, search,
loading, item data and sibling positions. Headless Tree item instances are
mutable, so memoizing only the instance would leave those states stale.
Sibling positions come from the directory structure because Headless Tree
clears metadata for descendants during a parent's closing animation. Shared
tree context and action callbacks remain stable.

Nodes (the folder `Collapsible` plus its row and children) are memoized too.
Because their state lives on mutable instances, `file-tree-revisions.ts`
diffs the tree inputs on every render — expanded, selected and focused items,
search, the loading set and the model's items / children maps — and bumps a
per-item revision for each changed item and all of its ancestors. A search
change bumps everything. The node receives `revision` as a prop, so React.memo
re-renders exactly the changed branch; the loading set travels through a ref
so replacing it does not invalidate untouched nodes.

```text
Tree state -> revision diff -> bump changed items + ancestors
           -> memoized nodes: changed branch renders, siblings bail out
Folder toggle -> existing 200 ms panel animation -> hide/reveal retained rows
Panel animation completion -> update clipping on that panel
```

First expansion of a directory used to spend one long frame on: rendering the
whole tree twice (click, then data arrival), Base UI Collapsible layout effects,
the address bar's `layout` projection re-measuring the page, and the name
measurement plus `panel.getSize()` forcing further layouts before the first
paint — the width-fit spring then started late and visibly jumped. Now:

- Only the clicked branch renders on click and on data arrival.
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
click -> render clicked branch -> fetch -> render branch + mount new rows -> paint
      -> next frame: measure visible names (contained probes) -> fit spring
      -> spring frames: panel.resize only; toolbar measure deferred to the end
```

The fit now grows to the names in view (with the existing 64 px margin) and
grows again as more rows scroll into view; before, the same expansion often
jumped straight to the maximum width.

Base UI's `keepMounted` retains loaded descendants across toggles; its `hidden`
attribute removes closed panels from layout and accessibility after the exit
animation. This retains DOM for loaded directories until the file tree unmounts,
in exchange for avoiding repeated row, context menu and observer setup. Directory
loading remains demand driven. Panel clipping state lives separately from rows,
so finishing an animation does not render the subtree again. Folder icons,
sticky headers, indentation, hover highlights, marquee and reduced-motion styles
keep their existing markup and motion settings.

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

Only expanded folders with children can acquire the sticky highlight. Two
IntersectionObserver sentinels delimit the interval in which the row is pinned:
its normal position has passed the sticky boundary, while its subtree still has
enough height below that boundary. Collapsed and empty folders scrolling under
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
./services/agent-runner/ts/node_modules/.bin/tsx --tsconfig agent-ui/tsconfig.app.json --test agent-ui/tests/features/file-browser/file-browser-scope.test.ts agent-ui/tests/features/file-browser/file-tree-revisions.test.ts
node --test agent-ui/tests/features/file-browser/file-tree-content-width.test.ts
```

The tests assert batched read/write ordering, duplicate-name caching, distinct
fonts, current slot widths after resizing, empty names, font invalidation, the
persistent contained probe host and its disposal, and that revisions move for
exactly the changed items and their ancestors (expansion, loading, model
children and item data, removed items, focus / selection, search). From
`agent-ui/`, run `npm run lint` and `npm run build` for static analysis and
production compilation.

For real browser regression checks, start `npm run dev` in `agent-ui/`, open
`/tests/features/file-browser/file-tree-browser.html`, and click **Run file tree
checks**. The standalone page needs no backend or session data. It exercises
row retention, hidden state, the original transition and clipping, selection,
arrow-key navigation, sibling insertion, search and loading indicators. Sticky
checks cover collapsed/empty folders underneath pinned ancestors, a subtree
pushing its header out, and retained selection; append `?dark=1` for dark mode. It also
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
