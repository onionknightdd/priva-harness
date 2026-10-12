// noVNC 1.7 publishes its ESM entry at the package root; the upstream types
// still name the previous lib/rfb entry point.
declare module "@novnc/novnc" {
  export { default } from "@novnc/novnc/lib/rfb"
}
