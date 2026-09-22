import { setTimeout } from 'node:timers/promises'

import { TerminalError, type TerminalInput } from '../../core/contract/terminal-service.js'

/** Find the live composer, never a prompt echoed into transcript scrollback. */
export function claudeComposer(screen: string): string | undefined {
  const lines = screen.split('\n')
  for (let index = lines.length - 1; index > 0; index--) {
    const line = lines[index] ?? ''
    if (/^\s*❯/u.test(line) && /^\s*[─━╌-]{3,}\s*$/u.test(lines[index - 1] ?? '')) {
      // Search uses the same box, but Enter would replay the selected old prompt.
      if (lines.slice(index + 1).some((row) => /ctrl\+r|esc to cancel.*search/iu.test(row))) return undefined
      const bottom = lines.findIndex((row, next) => next > index && /^\s*[─━╌-]{3,}\s*$/u.test(row))
      return [line.replace(/^\s*❯\s?/u, ''), ...lines.slice(index + 1, bottom < 0 ? index + 1 : bottom)].join('\n').trimEnd()
    }
  }
  return undefined
}

export async function submitClaudeTerminalInput(input: TerminalInput, text: string, signal: AbortSignal): Promise<void> {
  const screen = await waitFor(input, signal, (screen) => claudeComposer(screen) !== undefined,
    'Claude input is not ready. Open Terminal to resolve its startup dialog or menu.', 30000)
  signal.throwIfAborted()
  // Ctrl+A/K only clears the current logical line. Native stash clears the
  // entire draft (including pasted blocks) without interrupting active work.
  if (claudeComposer(screen)?.trim()) {
    await input.sendKeys(['C-s'])
    await waitFor(input, signal, (next) => claudeComposer(next)?.trim() === '',
      'Claude did not stash its input draft. Open Terminal before sending again.', 5000)
  }
  signal.throwIfAborted()
  await input.paste(text)
  // Claude coalesces fast input bursts: Enter before paste commit becomes a
  // newline in the draft. Observe the draft before submitting, then let the
  // lifecycle hook provide the authoritative acceptance acknowledgement.
  await waitFor(input, signal, (screen) => Boolean(claudeComposer(screen)?.trim()),
    'Claude did not display the pasted message. Open Terminal to inspect its input.', 10000)
  await setTimeout(100, undefined, { signal })
  signal.throwIfAborted()
  await input.sendKeys(['Enter'])
}

export async function completeClaudeLocalCommand(input: TerminalInput, text: string, signal: AbortSignal): Promise<boolean> {
  if (/^\/compact(?:\s|$)/u.test(text.trim())) {
    await waitFor(input, signal, (screen) => {
      if (claudeComposer(screen)?.trim() !== '') return false
      const output = screen.slice(screen.lastIndexOf('❯ /compact'))
      const error = /Not enough messages to compact[^\n]*|(?:Error|Failed|Unable)[^\n]*(?:compact|compress)[^\n]*/iu.exec(output)?.[0]
      if (error) throw new TerminalError('io-failure', error)
      // Successful compaction is acknowledged by PostCompact, which cancels
      // this wait. The screen is used only for native failures without a hook.
      return false
    }, 'Claude did not finish /compact. Open Terminal to inspect its response.', 300000)
  }
  if (!/^\/context(?:\s|$)/u.test(text.trim())) return false
  await waitFor(input, signal, (screen) => claudeComposer(screen)?.trim() === '' && /context usage|context window|tokens.*\//iu.test(screen),
    'Claude did not finish /context. Open Terminal to inspect its response.', 30000)
  return true
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
