import { stripVTControlCharacters } from 'node:util'

import type { TerminalComposer } from '../../core/contract/terminal-service.js'

const border = /^\s*[─━╌-]{3,}\s*$/u

/** tmux has already rendered the screen. Only SGR's faint attribute separates
 * Claude's ghost suggestion from editable text; colours alone are theme dependent. */
export function claudeComposer(screen: string): TerminalComposer | undefined {
  const lines = styledLines(screen)
  for (let index = lines.length - 1; index > 0; index--) {
    const line = lines[index]
    const prefix = /^\s*❯\s?/u.exec(line?.text ?? '')?.[0]
    if (!line || prefix === undefined || !border.test(lines[index - 1]?.text ?? '')) continue
    // Search shares the prompt box, but Enter would replay an old message.
    if (lines.slice(index + 1).some((row) => /ctrl\+r|esc to cancel.*search/iu.test(row.text))) return undefined
    const bottom = lines.findIndex((row, next) => next > index && border.test(row.text))
    if (bottom < 0) return undefined
    const body = [{ text: line.text.slice(prefix.length), draft: line.draft.slice(prefix.length), hint: line.hint.slice(prefix.length) },
      ...lines.slice(index + 1, bottom)]
    const text = body.map((row) => row.draft.trimEnd()).join('\n').trimEnd()
    const suggestion = text.trim() ? '' : body.map((row) => row.hint.trimEnd()).join('\n').trim()
    return { text, ...(suggestion ? { suggestion } : {}) }
  }
  return undefined
}

function styledLines(screen: string) {
  let line = { text: '', draft: '', hint: '' }
  const lines = [line]
  let faint = false
  for (const [index, part] of screen.split('\u001b[').entries()) {
    const sgr = index > 0 ? /^([\d;:]*)m/u.exec(part) : null
    if (sgr) faint = faintAfterSgr(faint, sgr[1] ?? '')
    const text = stripVTControlCharacters(sgr ? part.slice(sgr[0].length) : `${index > 0 ? '\u001b[' : ''}${part}`)
    for (const [row, value] of text.split('\n').entries()) {
      if (row > 0) { line = { text: '', draft: '', hint: '' }; lines.push(line) }
      line.text += value
      line.draft += faint ? ' '.repeat(value.length) : value
      line.hint += faint ? value : ' '.repeat(value.length)
    }
  }
  return lines
}

function faintAfterSgr(faint: boolean, parameters: string): boolean {
  const codes = parameters.split(';')
  for (let index = 0; index < codes.length; index++) {
    const parameter = codes[index] ?? ''
    const code = Number(parameter.split(':')[0])
    if (code === 0 || code === 22) faint = false
    else if (code === 2) faint = true
    // RGB/indexed colour components can themselves be 0, 2 or 22. They are
    // values, not attributes. Colon notation keeps them in one parameter.
    else if ([38, 48, 58].includes(code) && !parameter.includes(':')) {
      index += codes[index + 1] === '2' ? 4 : codes[index + 1] === '5' ? 2 : 0
    }
  }
  return faint
}
