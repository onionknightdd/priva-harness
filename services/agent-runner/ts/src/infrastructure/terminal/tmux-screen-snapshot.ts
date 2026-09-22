import { TerminalError } from '../../core/contract/terminal-service.js'
import { decodeOctalEscapes } from './tmux-control-protocol.js'

const PRIVATE_MODES = [
  ['keypad_cursor_flag', 1],
  ['origin_flag', 6],
  ['wrap_flag', 7],
  ['cursor_flag', 25],
  ['mouse_standard_flag', 1000],
  ['mouse_button_flag', 1002],
  ['mouse_all_flag', 1003],
  ['mouse_utf8_flag', 1005],
  ['mouse_sgr_flag', 1006],
  ['bracket_paste_flag', 2004],
] as const

const FIELDS = [
  'pane_width', 'pane_height', 'cursor_x', 'cursor_y',
  'alternate_on', 'alternate_saved_x', 'alternate_saved_y',
  'scroll_region_upper', 'scroll_region_lower', 'keypad_flag', 'insert_flag',
  ...PRIVATE_MODES.map(([field]) => field),
] as const

type ScreenState = Record<typeof FIELDS[number], number>

export const TMUX_SCREEN_FORMAT = FIELDS.map((field) => `#{${field}}`).join(' ')

export interface TmuxScreenSnapshot {
  readonly screen: Uint8Array
  readonly cols: number
  readonly rows: number
}

/** Read only numeric tmux fields; a missing/invalid state cannot be replayed safely. */
function parseState(line: string): ScreenState {
  const values = line.split(' ')
  if (values.length !== FIELDS.length || values.some((value) => !/^\d+$/u.test(value))) {
    throw new TerminalError('io-failure', 'tmux returned an invalid terminal screen state')
  }
  const state = Object.fromEntries(FIELDS.map((field, index) => [field, Number(values[index])])) as ScreenState
  if (state.pane_width < 1 || state.pane_height < 1
    || state.cursor_x > state.pane_width || state.cursor_y >= state.pane_height
    || state.scroll_region_upper > state.scroll_region_lower || state.scroll_region_lower >= state.pane_height) {
    throw new TerminalError('io-failure', 'tmux returned invalid terminal screen dimensions')
  }
  return state
}

const cursor = (x: number, y: number) => `\u001b[${y + 1};${x + 1}H`

/**
 * capture-pane carries cell contents/colours, not terminal modes. Rebuild the
 * saved normal buffer before entering the alternate buffer, then restore the
 * active scrolling/input modes and cursor before continuing the byte stream.
 */
export function buildTmuxScreenSnapshot(replies: readonly (readonly string[])[]): TmuxScreenSnapshot {
  const state = parseState(replies[0]?.[0] ?? '')
  const active = replies[1] ?? []
  const saved = replies[2] ?? []
  const parts = ['\u0018\u001b[?1049l\u001bc']
  if (state.alternate_on) {
    parts.push(saved.join('\r\n'), '\u001b[0m', cursor(state.alternate_saved_x, state.alternate_saved_y), '\u001b[?1049h\u001b[H')
  }
  parts.push(active.join('\r\n'), '\u001b[0m')
  parts.push(`\u001b[${state.scroll_region_upper + 1};${state.scroll_region_lower + 1}r`)
  // Disabling any mouse tracking mode resets xterm's active protocol, so
  // disable inactive modes first and only then enable the pane's modes.
  for (const enabled of [false, true]) {
    for (const [field, mode] of PRIVATE_MODES) {
      if (Boolean(state[field]) === enabled) parts.push(`\u001b[?${mode}${enabled ? 'h' : 'l'}`)
    }
  }
  parts.push(state.keypad_flag ? '\u001b=' : '\u001b>')

  const cursorY = state.cursor_y - (state.origin_flag ? state.scroll_region_upper : 0)
  if (state.cursor_x === state.pane_width && state.wrap_flag) {
    // CUP clamps to the last column and loses a pending autowrap. Repainting
    // the cursor's full-width row recreates that state without moving a cell.
    const row = active[active.length - state.pane_height + state.cursor_y] ?? ''
    parts.push(cursor(0, cursorY), row, '\u001b[0m')
  } else {
    parts.push(cursor(state.cursor_x, cursorY))
  }
  parts.push(`\u001b[4${state.insert_flag ? 'h' : 'l'}`)

  // tmux may be partway through an ANSI sequence. The following live bytes
  // must finish that sequence in the browser as well.
  const pending = decodeOctalEscapes(Buffer.from((replies[3] ?? []).join('\n'), 'utf8'))
  return {
    screen: Buffer.concat([Buffer.from(parts.join(''), 'utf8'), pending]),
    cols: state.pane_width,
    rows: state.pane_height,
  }
}
