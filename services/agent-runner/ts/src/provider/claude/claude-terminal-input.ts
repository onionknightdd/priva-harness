import { copyFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'

import { TerminalError, type TerminalInput } from '../../core/contract/terminal-service.js'
import { claudeComposer } from './claude-terminal-composer.js'

const IMAGE_PASTE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

export async function submitClaudeTerminalInput(input: TerminalInput, text: string, signal: AbortSignal, imagePaths: readonly string[] = []): Promise<void> {
  const screen = await waitFor(input, signal, (screen) => claudeComposer(screen) !== undefined,
    'Claude input is not ready. Open Terminal to resolve its startup dialog or menu.', 30000)
  signal.throwIfAborted()
  // Ctrl+A/K only clears the current logical line. Native stash clears the
  // entire draft (including pasted blocks) without interrupting active work.
  if (claudeComposer(screen)?.text.trim()) {
    await input.sendKeys(['C-s'])
    await waitFor(input, signal, (next) => claudeComposer(next)?.text.trim() === '',
      'Claude did not stash its input draft. Open Terminal before sending again.', 5000)
  }
  signal.throwIfAborted()
  let draftBeforeText = ''
  for (const imagePath of imagePaths) {
    const safePath = await safeImagePastePath(imagePath)
    await input.paste(safePath)
    // The REPL replaces a pasted image path with [Image #N]. Wait until that
    // chip is visible so the following text paste does not ride along as a path.
    const attached = await waitFor(input, signal, (screen) => {
      const draft = claudeComposer(screen)?.text ?? ''
      return /\[Image #\d+\]/u.test(draft) && !draft.includes(safePath)
    }, 'Claude did not attach the pasted image. Open Terminal to inspect its input.', 10000)
    draftBeforeText = claudeComposer(attached)?.text ?? ''
  }
  if (text.trim()) {
    const firstLine = text.trim().split('\n')[0] ?? text
    await input.paste(text)
    // Claude coalesces fast input bursts: Enter before paste commit becomes a
    // newline in the draft. A long or multiline paste is shown as [Pasted text #N]
    // instead of the original characters, so either form means the paste landed.
    await waitFor(input, signal, (screen) => {
      const draft = claudeComposer(screen)?.text ?? ''
      if (!draft.trim() || draft === draftBeforeText) return false
      return draft.includes(firstLine) || /\[Pasted text #\d+/u.test(draft)
    }, 'Claude did not display the pasted message. Open Terminal to inspect its input.', 10000)
  } else if (imagePaths.length === 0) {
    await input.paste(text)
    await waitFor(input, signal, (screen) => Boolean(claudeComposer(screen)?.text.trim()),
      'Claude did not display the pasted message. Open Terminal to inspect its input.', 10000)
  }
  await setTimeout(100, undefined, { signal })
  signal.throwIfAborted()
  await input.sendKeys(['Enter'])
}

export async function completeClaudeLocalCommand(input: TerminalInput, text: string, signal: AbortSignal): Promise<boolean> {
  if (/^\/compact(?:\s|$)/u.test(text.trim())) {
    await waitFor(input, signal, (screen) => {
      if (claudeComposer(screen)?.text.trim() !== '') return false
      const plain = stripVTControlCharacters(screen)
      const output = plain.slice(plain.lastIndexOf('❯ /compact'))
      const error = /Not enough messages to compact[^\n]*|(?:Error|Failed|Unable)[^\n]*(?:compact|compress)[^\n]*/iu.exec(output)?.[0]
      if (error) throw new TerminalError('io-failure', error)
      // Successful compaction is acknowledged by PostCompact, which cancels
      // this wait. The screen is used only for native failures without a hook.
      return false
    }, 'Claude did not finish /compact. Open Terminal to inspect its response.', 300000)
  }
  if (!/^\/context(?:\s|$)/u.test(text.trim())) return false
  await waitFor(input, signal, (screen) => claudeComposer(screen)?.text.trim() === '' && /context usage|context window|tokens.*\//iu.test(stripVTControlCharacters(screen)),
    'Claude did not finish /context. Open Terminal to inspect its response.', 30000)
  return true
}

/** Claude treats one pasted absolute image path as an image chip. Spaces break that match. */
export async function safeImagePastePath(imagePath: string): Promise<string> {
  const extension = extname(imagePath).toLowerCase()
  if (imagePath.startsWith('/') && IMAGE_PASTE_EXTENSIONS.has(extension) && !/[\s"'\\]/u.test(imagePath)) return imagePath
  const suffix = IMAGE_PASTE_EXTENSIONS.has(extension) ? extension : '.png'
  const directory = join(tmpdir(), 'priva-image-paste')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const safe = join(directory, `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}${suffix}`)
  await copyFile(imagePath, safe)
  return safe
}

async function waitFor(input: TerminalInput, signal: AbortSignal, ready: (screen: string) => boolean,
  message: string, timeout: number): Promise<string> {
  const deadline = Date.now() + timeout
  do {
    signal.throwIfAborted()
    if (!await input.isAlive()) throw new TerminalError('not-found', 'Claude terminal exited before the message was submitted')
    const screen = await input.capture()
    if (ready(screen)) return screen
    await setTimeout(100, undefined, { signal })
  } while (Date.now() < deadline)
  throw new TerminalError('io-failure', message)
}
