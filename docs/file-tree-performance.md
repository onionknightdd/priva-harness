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

```text
Tree state -> lightweight nodes -> changed row snapshots -> render changed rows
Folder toggle -> existing 200 ms panel animation -> hide/reveal retained rows
Panel animation completion -> update clipping on that panel
```

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
independently of hover; their opaque `card` backing covers indentation and
rounded corners. This does not change the actual selection. The working-directory
picker places its vertical padding inside the scroll area, so sticky rows reach
the top edge without leaving a transparent strip above them.

## Verification

From the repository root:

```sh
node --test agent-ui/tests/features/file-browser/file-tree-content-width.test.ts
```

The tests assert batched read/write ordering, duplicate-name caching, distinct
fonts, current slot widths after resizing, empty names, font invalidation and
measurement-node cleanup. From `agent-ui/`, run `npm run lint` and
`npm run build` for static analysis and production compilation.

For real browser regression checks, start `npm run dev` in `agent-ui/`, open
`/tests/features/file-browser/file-tree-browser.html`, and click **Run file tree
checks**. The standalone page needs no backend or session data. It exercises
row retention, hidden state, the original transition and clipping, selection,
arrow-key navigation, sibling insertion, search and loading indicators. It also
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
