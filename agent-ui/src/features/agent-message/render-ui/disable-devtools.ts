// @openuidev/react-lang mounts an Inspect widget in development as soon as
// the module loads. Set its guard first so the product chat does not gain
// that widget. The flag is a Symbol on globalThis, checked once per page.
const flags = globalThis as Record<symbol, unknown>
flags[Symbol.for("openui.devtools.autoMount")] = true
