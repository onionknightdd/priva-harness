import type { RegexEngine } from "shiki/core"
import { createOnigurumaEngine } from "shiki/engine/oniguruma"

let engine: Promise<RegexEngine> | undefined

/**
 * One Oniguruma (WASM) engine for every Shiki highlighter in the app. WASM
 * compiles each grammar regex once and keeps it; the JavaScript engine handed
 * them to V8, which recompiled the whole TypeScript grammar (~180 ms) whenever
 * a GC after a large mount flushed its regex code.
 */
export function getShikiEngine(): Promise<RegexEngine> {
  engine ??= createOnigurumaEngine(import("shiki/wasm"))
  return engine
}
