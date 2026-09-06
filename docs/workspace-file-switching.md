# Workspace file tab switching

The file panel mounts on its first selection and remains mounted while other
workspace modules are selected. Hidden panels use `display: none`, `inert`, and
`aria-hidden` so their controls do not participate in layout or keyboard focus.
Only the file module opts into retention; task polling and other modules still
unmount when inactive. The retained file tree and preview are released when the
workspace tab host unmounts. This trades bounded retained memory for avoiding
repeated directory requests, tree reconstruction, and preview initialization.

```text
First file selection -> lazy module -> directory request -> tree and preview
Other module         -> hide retained file panel
Return to files      -> reveal same tree and preview -> 150 ms opacity feedback
```

Previously the keyed panel under `AnimatePresence mode="wait"` destroyed the
browser on every tab switch. Its mount effect requested the initial directory
again and discarded search, directory, and open-file state. A blur/scale spring
on the entire tab panel also overlapped a second GSAP entrance on the file page.
The panel now uses a short opacity transition without an exit wait or blur;
keyboard and reduced-motion transitions are immediate. Compact file pages skip
the separate GSAP entrance. Lazy loading has a skeleton instead of a blank area.

Manual regression check in the actual app: open Files, navigate to a directory,
enter a search, and open a source preview. Switch to Tasks & Activity or Terminal,
then back. Verify the directory, search, open file, and input element ID remain
unchanged. Check hidden file controls are absent from the accessibility tree,
and explicit Refresh still updates the directory. Run `npm run lint` and
`npm run build` from `agent-ui/`.
