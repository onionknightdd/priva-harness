import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WhiteboardService, type WhiteboardEvent } from '../../../../src/harness/whiteboard/whiteboard-service.js'

const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), 'board-')); roots.push(cwd)
  const service = new WhiteboardService()
  const file = await service.resolveSessionPath('test.board.json', cwd, 'agent', true)
  return { cwd, file, service }
}
const shape = { type: 'shape', kind: 'rounded', x: 10, y: 20, w: 120, h: 60, text: 'Original' }
const set = (id: string, element: unknown = shape) => ({ op: 'set', id, element })

describe('WhiteboardService', () => {
  it('persists a complete atomic board and serializes concurrent field updates', async () => {
    const { service, file } = await fixture()
    await service.write(file, { ops: [set('a'), set('b')] }, 'agent', 'agent')
    await Promise.all([
      service.write(file, { ops: [{ op: 'update', id: 'a', patch: { text: 'Edited' } }] }, 'user', 'viewer'),
      service.write(file, { ops: [{ op: 'update', id: 'a', patch: { x: 55 } }] }, 'agent', 'agent'),
    ])
    const board = await new WhiteboardService().read(file)
    expect(board.revision).toBe(3)
    expect(board.elements['a']).toMatchObject({ text: 'Edited', x: 55 })
    expect(board.order).toEqual(['a', 'b'])
  })

  it('rejects the whole batch when a later operation is invalid', async () => {
    const { service, file } = await fixture()
    await service.write(file, { ops: [set('a')] }, 'agent', 'agent')
    const before = await readFile(file, 'utf8')
    await expect(service.write(file, { ops: [{ op: 'update', id: 'a', patch: { text: 'No' } }, { op: 'update', id: 'missing', patch: { text: 'Bad' } }] }, 'agent', 'agent')).rejects.toThrow('missing')
    await expect(service.write(file, { ops: [{ op: 'update', id: 'a', patch: { w: -1 } }] }, 'agent', 'agent')).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('accepts all eight types, forward references and the twelve shapes', async () => {
    const { service, file } = await fixture()
    const kinds = ['rect', 'rounded', 'pill', 'ellipse', 'diamond', 'hexagon', 'parallelogram', 'database', 'queue', 'document', 'cloud', 'person']
    const box = { x: 0, y: 0, w: 100, h: 80 }
    const ops = [set('arrow', { type: 'arrow', from: 'rect', to: { x: 100, y: 100 } }), ...kinds.map((kind) => set(kind, { ...shape, kind })),
      set('group', { type: 'container', ...box }), set('text', { type: 'text', ...box, parentId: 'group', text: 'Hi' }),
      set('table', { type: 'table', ...box, columns: ['A'], rows: [['one']] }),
      set('html', { type: 'html', ...box, html: '<button>vote</button>', state: { votes: 0 } }),
      set('image', { type: 'image', ...box, src: 'data:image/svg+xml;base64,PHN2Zy8+' }),
      set('stroke', { type: 'stroke', ...box, points: [[0, 0], [20, 20]] })]
    expect((await service.write(file, { ops }, 'agent', 'agent')).order).toHaveLength(19)
  })

  it('rejects invalid graph relationships and malformed table rows', async () => {
    const { service, file } = await fixture()
    await expect(service.write(file, { ops: [set('bad', { type: 'arrow', from: 'missing', to: { x: 1, y: 1 } })] }, 'agent', 'agent')).rejects.toThrow('missing')
    await expect(service.write(file, { ops: [set('group', { type: 'container', x: 0, y: 0, w: 100, h: 100, parentId: 'group' })] }, 'agent', 'agent')).rejects.toThrow('cycle')
    await expect(service.write(file, { ops: [set('bad', { type: 'table', x: 0, y: 0, w: 100, h: 100, columns: ['A'], rows: [['a', 'b']] })] }, 'agent', 'agent')).rejects.toThrow('rows')
    await expect(service.write(file, { ops: [set('__proto__')] }, 'agent', 'agent')).rejects.toThrow()
  })

  it('detaches children at their world position and removes dangling arrows', async () => {
    const { service, file } = await fixture()
    await service.write(file, { ops: [set('group', { type: 'container', x: 100, y: 200, w: 400, h: 400 }), set('child', { ...shape, parentId: 'group' }), set('arrow', { type: 'arrow', from: 'group', to: 'child' })] }, 'agent', 'agent')
    const events: WhiteboardEvent[] = []
    const unsubscribe = service.subscribe(file, (event) => events.push(event))
    const board = await service.write(file, { ops: [{ op: 'delete', id: 'group' }] }, 'user', 'viewer')
    unsubscribe()
    expect(board.order).toEqual(['child'])
    expect(board.elements['child']).toMatchObject({ x: 110, y: 220 })
    expect(board.elements['child']).not.toHaveProperty('parentId')
    expect(events[0]).toMatchObject({ type: 'change', source: 'user', ops: [{ op: 'delete', id: 'group' }, { op: 'delete', id: 'arrow' }, { op: 'set', id: 'child' }] })
  })

  it.each([['a', 'b'], ['1', '2']])('includes final order when a batch recreates an identical element (%s, %s)', async (a, b) => {
    const { service, file } = await fixture()
    await service.write(file, { ops: [set(a), set(b)] }, 'agent', 'agent')
    const events: WhiteboardEvent[] = []
    service.subscribe(file, (event) => events.push(event))
    const board = await service.write(file, { ops: [{ op: 'delete', id: a }, set(a)] }, 'agent', 'agent')
    expect(board.order).toEqual([b, a])
    expect(events[0]).toMatchObject({ type: 'change', order: [b, a] })
  })

  it('accepts its canonical output with an aliased workspace root', async () => {
    const { service, cwd, file } = await fixture()
    await service.write(file, { ops: [set('a')] }, 'agent', 'agent')
    expect(await service.resolvePath(file, cwd)).toBe(file)
  })

  it('rejects traversal, symlink escapes, and non-board files', async () => {
    const { service, cwd, file } = await fixture()
    await expect(service.resolvePath('../escape.board.json', cwd, true)).rejects.toThrow('workspace')
    await expect(service.resolvePath('other.json', cwd, true)).rejects.toThrow('.board.json')
    const outside = await mkdtemp(path.join(tmpdir(), 'board-outside-')); roots.push(outside)
    await symlink(outside, path.join(cwd, 'escape'))
    await expect(service.resolvePath('escape/test.board.json', cwd, true)).rejects.toThrow('workspace')
    await writeFile(path.join(outside, 'board.board.json'), '{}')
    await symlink(path.join(outside, 'board.board.json'), file)
    await expect(service.resolvePath(file, cwd)).rejects.toThrow('symbolic link')
  })

  it('rejects symlinked session roots and links into another session before creating files', async () => {
    const { service, cwd } = await fixture()
    const other = path.join(cwd, '.whiteboard', 'other')
    await mkdir(other)
    await symlink(other, path.join(cwd, '.whiteboard', 'alias'))
    await expect(service.resolveSessionPath('board.board.json', cwd, 'alias', true)).rejects.toThrow('symbolic links')
    await symlink(other, path.join(cwd, '.whiteboard', 'agent', 'linked'))
    await expect(service.resolveSessionPath('linked/nested/board.board.json', cwd, 'agent', true)).rejects.toThrow('symbolic links')
    await expect(readFile(path.join(other, 'nested', 'board.board.json'), 'utf8')).rejects.toThrow()
    await expect(service.resolveSessionPath('board.board.json', cwd, '../other', true)).rejects.toThrow('session id')
  })

  it('exposes context and expiring claims without persisting viewer state', async () => {
    const { service, file } = await fixture()
    vi.useFakeTimers()
    const claim = { id: 'claim', label: 'Drawing', x: 0, y: 0, w: 300, h: 200 }
    await service.write(file, { ops: [set('a')], claim }, 'agent', 'agent')
    service.updateContext(file, 'viewer', { selection: ['a'], viewport: { x: 0, y: 0, zoom: 1 }, issues: ['Text overflows'] })
    expect(service.presence(file)).toMatchObject({ contexts: [{ id: 'viewer', selection: ['a'] }], claims: [claim] })
    expect(await readFile(file, 'utf8')).not.toContain('viewport')
    vi.advanceTimersByTime(60_001)
    expect(service.presence(file).claims).toEqual([])
    service.updateContext(file, 'viewer', null)
    expect(service.presence(file).contexts).toEqual([])
  })

  it('reports corrupt files without overwriting them', async () => {
    const { service, file } = await fixture()
    await writeFile(file, '{broken')
    await expect(service.write(file, { ops: [set('a')] }, 'agent', 'agent')).rejects.toThrow('Invalid whiteboard')
    expect(await readFile(file, 'utf8')).toBe('{broken')
  })
})
