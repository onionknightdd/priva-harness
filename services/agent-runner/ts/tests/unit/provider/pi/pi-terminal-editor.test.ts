import { initTheme, type ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import { expect, it, vi } from 'vitest'
import { PiInteractions } from '../../../../src/provider/pi/pi-interactions.js'
import type { InteractionRequest } from '../../../../src/core/resource/interaction.js'

type CustomFactory = Parameters<ExtensionUIContext['custom']>[0]
type EditorComponent = Awaited<ReturnType<CustomFactory>>

function fixture() {
  initTheme('dark', false)
  const bridge = new PiInteractions()
  let request: InteractionRequest | undefined
  let component: EditorComponent | undefined
  const done = vi.fn()
  const base = { custom: <T>(factory: Parameters<ExtensionUIContext['custom']>[0]) => new Promise<T>((resolve, reject) => {
    const result = factory({ requestRender: vi.fn(), terminal: { rows: 40, columns: 100 } } as unknown as Parameters<CustomFactory>[0],
      {} as Parameters<CustomFactory>[1], { matches: () => false } as unknown as Parameters<CustomFactory>[2], (value) => { done(value); resolve(value as T) })
    Promise.resolve(result).then((value) => { component = value }).catch(reject)
  }) } as ExtensionUIContext
  bridge.subscribe((event) => { if (event.type === 'permission.requested') request = event.request })
  return { bridge, ui: bridge.ui(base, true), done, request: () => { if (!request) throw new Error('Missing interaction'); return request }, component: () => { if (!component) throw new Error('Missing editor'); return component } }
}

it('renders editable native multiline prefill and returns all lines on Enter', async () => {
  const { ui, component, done } = fixture()
  const answer = ui.editor('Instructions', 'first line\nsecond line')
  await expect.poll(component).toBeDefined()
  expect(component().render(100).join('\n')).toContain('first line')
  expect(component().render(100).join('\n')).toContain('second line')
  component().handleInput?.('\r')
  expect(await answer).toBe('first line\nsecond line')
  expect(done).toHaveBeenCalledTimes(1)
})

it('closes the native editor when Chat answers first without losing whitespace', async () => {
  const { bridge, ui, component, done, request } = fixture()
  const answer = ui.editor('Instructions', 'first line\nsecond line')
  await expect.poll(component).toBeDefined()
  bridge.respond({ requestId: request().requestId, decision: 'allow', answers: { q0: { selected: [], text: '  edited\nnext\n' } } })
  expect(await answer).toBe('  edited\nnext\n')
  expect(done).toHaveBeenCalledWith(undefined)
  component().handleInput?.('\r')
  expect(done).toHaveBeenCalledTimes(1)
})
