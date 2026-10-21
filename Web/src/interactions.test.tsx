import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { emptySnapshot, newTemplate } from './domain'
import { emptyDrive } from './drive'

// Exercise component callbacks and effect lifetimes without a browser or another renderer dependency.
const test = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }
  let active: Hooks
  const renderers: Hooks[] = []
  class Hooks {
    slots: Slot[] = []
    cursor = 0
    changed = false
    pending: (() => void)[] = []
    constructor() {
      renderers.push(this)
    }
    slot() {
      return (this.slots[this.cursor++] ??= {})
    }
    render<T>(component: () => T): T {
      let result: T
      do {
        this.changed = false
        this.cursor = 0
        active = this
        result = component()
        for (const effect of this.pending.splice(0)) effect()
      } while (this.changed)
      return result!
    }
    dispose() {
      this.slots.forEach((slot) => slot.cleanup?.())
    }
  }
  const different = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]))
  const state = (initial: unknown) => {
    const owner = active,
      slot = owner.slot()
    if (!('value' in slot)) slot.value = typeof initial === 'function' ? initial() : initial
    return [
      slot.value,
      (value: unknown) => {
        const next = typeof value === 'function' ? value(slot.value) : value
        if (!Object.is(next, slot.value)) {
          slot.value = next
          owner.changed = true
        }
      },
    ]
  }
  const ref = (initial: unknown) => {
    const slot = active.slot()
    return (slot.value ??= { current: initial })
  }
  const memo = (fn: () => unknown, deps?: readonly unknown[]) => {
    const slot = active.slot()
    if (different(slot.deps, deps)) {
      slot.value = fn()
      slot.deps = deps
    }
    return slot.value
  }
  const effect = (fn: () => void | (() => void), deps?: readonly unknown[]) => {
    const owner = active,
      slot = owner.slot()
    if (different(slot.deps, deps)) {
      slot.deps = deps
      owner.pending.push(() => {
        slot.cleanup?.()
        slot.cleanup = fn() || undefined
      })
    }
  }
  const effectEvent = (fn: (...args: unknown[]) => unknown) => {
    const slot = active.slot()
    slot.value = fn
    return (...args: unknown[]) => (slot.value as typeof fn)(...args)
  }
  const bridge = vi.fn()
  const surface = Object.assign(new EventTarget(), {
    innerWidth: 1200,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    webkit: { messageHandlers: { valentina: { postMessage: bridge } } },
  })
  vi.stubGlobal('window', surface)
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), {
      documentElement: { classList: { add() {}, remove() {} } },
      activeElement: null,
      hidden: false,
      querySelector: () => null,
      body: {},
    }),
  )
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('Element', class {})
  return {
    Hooks,
    state,
    ref,
    memo,
    effect,
    effectEvent,
    bridge,
    context: {} as unknown,
    dispose: () => renderers.splice(0).forEach((renderer) => renderer.dispose()),
  }
})

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: test.state,
  useRef: test.ref,
  useMemo: test.memo,
  useCallback: (fn: () => unknown, deps: readonly unknown[]) => test.memo(() => fn, deps),
  useEffect: test.effect,
  useLayoutEffect: test.effect,
  useEffectEvent: test.effectEvent,
  useId: () => test.memo(() => 'synthetic-id', []),
  useContext: () => test.context,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}))
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }))
vi.mock('motion/react', () => ({
  AnimatePresence: 'presence',
  motion: new Proxy({}, { get: (_target, name) => String(name) }),
  useMotionValue: () => ({ set() {} }),
  useReducedMotion: () => false,
  useTransform: () => 0,
  animate: vi.fn(),
}))

import { Sheet } from './kit'
import { EventView } from './EventView'
import { DocumentStudio } from './Studio'
import { WorkspaceProvider } from './workspace'

type Element = ReactElement<Record<string, any>>
function find(tree: unknown, match: (element: Element) => boolean): Element {
  const queue = [tree]
  while (queue.length) {
    const item = queue.shift()
    if (Array.isArray(item)) queue.push(...item)
    else if (item && typeof item === 'object' && 'props' in item) {
      const element = item as Element
      if (match(element)) return element
      queue.push(element.props.children)
    }
  }
  throw new Error('Synthetic component element not found')
}
const component = (tree: unknown, name: string) =>
  find(tree, (element) => typeof element.type === 'function' && element.type.name === name)
const invoke = (element: Element) => (element.type as (props: any) => Element)(element.props)
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
const fixture = () => {
  const s = emptySnapshot()
  s.organizations = [
    { id: 'org', name: 'Synthetic', accentHex: '#262629', timeZoneIdentifier: 'UTC' },
  ]
  s.events = [
    {
      id: 'event',
      organizationID: 'org',
      title: 'Synthetic event',
      startsAt: '2026-10-21T12:00:00Z',
      componentID: 'component',
      countsAttendance: true,
      isCancelled: false,
    },
  ]
  s.members = [{ id: 'member', organizationID: 'org', name: 'Ana', isActive: true }]
  s.attendance = [
    {
      id: 'row',
      eventID: 'event',
      memberID: 'member',
      status: 'present',
      isVoided: false,
      note: '',
    },
  ]
  return s
}

beforeEach(() => {
  vi.useFakeTimers()
  test.bridge.mockReset()
  delete window.nexoDevice
})
afterEach(() => {
  test.dispose()
  vi.clearAllTimers()
  vi.useRealTimers()
})

function record(mutate = vi.fn().mockResolvedValue(fixture())) {
  const s = fixture(),
    close = vi.fn(),
    openMember = vi.fn()
  test.context = { mutate, notify: vi.fn() }
  const eventHooks = new test.Hooks(),
    rollHooks = new test.Hooks(),
    recordHooks = new test.Hooks()
  const eventTree = eventHooks.render(() =>
    EventView({ s, event: s.events[0], edit: vi.fn(), document: vi.fn(), openMember }),
  )
  const roll = component(eventTree, 'Roll')
  const rollTree = rollHooks.render(() => invoke(roll))
  component(rollTree, 'RollRow').props.open()
  const original = component(
    rollHooks.render(() => invoke(roll)),
    'RecordSheet',
  )
  const recordElement = { ...original, props: { ...original.props, close } }
  const render = () => recordHooks.render(() => invoke(recordElement))
  let tree = render()
  find(tree, (element) => element.type === 'textarea').props.onChange({
    target: { value: 'Avisó' },
  })
  tree = render()
  return { tree, render, mutate, close, openMember }
}

describe('Attendance note dismissal', () => {
  it('Escape saves the latest note even though the sheet stayed open', async () => {
    const r = record(),
      sheetHooks = new test.Hooks()
    const props = r.tree.props as Parameters<typeof Sheet>[0]
    sheetHooks.render(() => Sheet({ ...props, onClose: vi.fn() }))
    sheetHooks.render(() => Sheet(props))
    const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })
    window.dispatchEvent(escape)
    await flush()
    expect(r.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'Avisó', expectedNote: '', noteOnly: true }),
      expect.any(String),
    )
    expect(r.close).toHaveBeenCalledOnce()
  })
  it.each(['history', 'exclude'])('saves a dirty note before %s', async (route) => {
    const r = record()
    find(
      r.tree,
      (element) =>
        element.props.className ===
        (route === 'history' ? 'nx-group-row link' : 'nx-group-row link danger'),
    ).props.onClick()
    expect(r.close).not.toHaveBeenCalled()
    await flush()
    expect(r.mutate.mock.calls[0][0]).toMatchObject({ kind: 'attendance', note: 'Avisó' })
    if (route === 'history') expect(r.openMember).toHaveBeenCalledWith('member')
    else expect(r.mutate.mock.calls[1][0]).toMatchObject({ kind: 'inclusion', included: false })
    expect(r.close).toHaveBeenCalledOnce()
  })
  it.each(['history', 'exclude'])(
    'keeps the note and record open when save before %s fails',
    async (route) => {
      const r = record(vi.fn().mockRejectedValue(new Error('Synthetic note conflict')))
      find(
        r.tree,
        (element) =>
          element.props.className ===
          (route === 'history' ? 'nx-group-row link' : 'nx-group-row link danger'),
      ).props.onClick()
      await flush()
      const tree = r.render()
      expect(r.close).not.toHaveBeenCalled()
      expect(r.openMember).not.toHaveBeenCalled()
      expect(r.mutate).toHaveBeenCalledOnce()
      expect(find(tree, (element) => element.type === 'textarea').props.value).toBe('Avisó')
      expect(find(tree, (element) => element.props.role === 'alert').props.children).toBe(
        'Synthetic note conflict',
      )
    },
  )
  it('does not queue duplicate note saves while dismissal is pending', async () => {
    let resolve!: () => void
    const pending = new Promise<void>((done) => {
      resolve = done
    })
    const r = record(vi.fn().mockReturnValue(pending))
    r.tree.props.onClose()
    r.tree.props.onClose()
    expect(r.mutate).toHaveBeenCalledOnce()
    resolve()
    await flush()
    expect(r.close).toHaveBeenCalledOnce()
  })
  it('can retry exclusion after the note saved but exclusion failed', async () => {
    const mutate = vi
      .fn()
      .mockResolvedValue(fixture())
      .mockResolvedValueOnce(fixture())
      .mockRejectedValueOnce(new Error('Synthetic exclusion failed'))
    const r = record(mutate)
    const exclude = (tree: unknown) =>
      find(tree, (element) => element.props.className === 'nx-group-row link danger')
    exclude(r.tree).props.onClick()
    await flush()
    expect(r.close).not.toHaveBeenCalled()
    exclude(r.render()).props.onClick()
    await flush()
    expect(mutate.mock.calls.map(([action]) => action.kind)).toEqual([
      'attendance',
      'inclusion',
      'inclusion',
    ])
    expect(r.close).toHaveBeenCalledOnce()
  })
})

describe('Committed workspace edits', () => {
  it('resolves a committed edit when Drive status fails and uses its revision for the next edit', async () => {
    const s = fixture(),
      hooks = new test.Hooks()
    test.bridge.mockImplementation(
      async (request: { command: string; expectedRevision?: number }) => {
        if (request.command === 'load') return { snapshot: s, drive: emptyDrive }
        if (request.command === 'mutate') return { ...s, revision: request.expectedRevision! + 1 }
        throw new Error('Synthetic status unavailable')
      },
    )
    const render = () => hooks.render(() => WorkspaceProvider({ children: null }))
    render()
    await flush()
    let workspace = render().props.value
    await expect(workspace.mutate({ kind: 'synthetic' }, 'Guardado')).resolves.toMatchObject({
      revision: 1,
    })
    workspace = render().props.value
    expect(workspace.snapshot.revision).toBe(1)
    expect(workspace.drive.error).toBe('Synthetic status unavailable')
    expect(workspace.toast).toMatchObject({ message: 'Guardado', error: false })
    await expect(workspace.mutate({ kind: 'synthetic' })).resolves.toMatchObject({ revision: 2 })
    expect(
      test.bridge.mock.calls
        .filter(([request]) => request.command === 'mutate')
        .map(([request]) => request.expectedRevision),
    ).toEqual([0, 1])
  })
  it('still rejects a failed native mutation and preserves the previous snapshot', async () => {
    const s = fixture(),
      hooks = new test.Hooks()
    test.bridge.mockImplementation(async ({ command }) => {
      if (command === 'load') return { snapshot: s, drive: emptyDrive }
      throw new Error('Synthetic mutation rejected')
    })
    const render = () => hooks.render(() => WorkspaceProvider({ children: null }))
    render()
    await flush()
    await expect(render().props.value.mutate({ kind: 'synthetic' })).rejects.toThrow(
      'Synthetic mutation rejected',
    )
    expect(render().props.value.snapshot).toEqual(s)
    expect(test.bridge.mock.calls.map(([request]) => request.command)).toEqual(['load', 'mutate'])
  })
})

it('saving a copy preserves pending edits and keeps later undo and save on the copy', async () => {
  window.nexoDevice = 'iPhone'
  const s = fixture(),
    original = newTemplate('org'),
    hooks = new test.Hooks()
  s.templates = [original]
  let resolve!: () => void
  const pending = new Promise<void>((done) => {
    resolve = done
  })
  const mutate = vi
    .fn()
    .mockImplementationOnce(() => pending)
    .mockResolvedValue(s)
  test.context = { mutate, busy: false, notify: vi.fn(), demo: true }
  const render = () =>
    component(
      hooks.render(() => DocumentStudio({ s, orgID: 'org', initial: original, back: vi.fn() })),
      'MobileStudio',
    ).props
  let studio = render()
  const saving = studio.saveCopy()
  studio.patch({ headerTitle: 'Typed while saving' })
  resolve()
  await saving
  studio = render()
  const copy = mutate.mock.calls[0][0].entity
  expect(studio.draft).toMatchObject({ id: copy.id, headerTitle: 'Typed while saving' })
  expect(studio.draft.id).not.toBe(original.id)
  expect(studio.canUndo).toBe(false)
  expect(studio.dirty).toBe(true)
  studio.patch({ rowHeight: 45 })
  studio = render()
  studio.undo()
  studio = render()
  expect(studio.draft).toMatchObject({
    id: copy.id,
    headerTitle: 'Typed while saving',
    rowHeight: original.rowHeight,
  })
  await studio.save()
  expect(mutate.mock.calls[1][0]).toMatchObject({
    kind: 'saveTemplate',
    entity: { id: copy.id },
    expectedTemplate: copy,
  })
})
