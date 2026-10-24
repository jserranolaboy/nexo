import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { emptySnapshot, newTemplate } from './domain'
import { emptyDrive } from './drive'
import { t as tr } from './i18n'

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
      documentElement: { classList: { add() {}, remove() {} }, dataset: {}, style: {} },
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

import { InlineText, Sheet } from './kit'
import { ComponentsSheet, GroupsSheet } from './Manage'
import { EventView } from './EventView'
import { DocumentStudio } from './Studio'
import { WorkspaceProvider } from './workspace'
import { EventForm } from './forms'
import { App } from './App'

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
  s.components = [{ id: 'component', organizationID: 'org', name: 'Synthetic component' }]
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
  window.innerWidth = 1200
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

function eventForm(
  s = fixture(),
  mode: 'edit' | 'duplicate' = 'edit',
  mutate = vi.fn().mockResolvedValue(s),
) {
  const close = vi.fn(),
    saved = vi.fn(),
    hooks = new test.Hooks()
  test.context = { mutate, busy: false }
  const form = component(
    EventForm({ s, orgID: 'org', draft: { mode, event: s.events[0] }, close, saved }),
    'EventFormBody',
  )
  const render = () => hooks.render(() => invoke(form))
  return { render, mutate, close, saved }
}

describe('Inline event classification creation', () => {
  it.each(['component', 'category'])(
    'preserves the name and previous selection after failed %s creation, then retries',
    async (kind) => {
      const s = fixture()
      s.categories = [{ id: 'category', componentID: 'component', name: 'Synthetic category' }]
      s.events[0].categoryID = 'category'
      const mutate = vi
        .fn()
        .mockRejectedValueOnce(new Error('Synthetic creation failed'))
        .mockImplementationOnce(async (action) => {
          if (kind === 'component')
            s.components.push({ id: action.id, organizationID: 'org', name: action.name })
          else
            s.categories.push({ id: action.id, componentID: action.componentID, name: action.name })
          return s
        })
      const form = eventForm(s, 'edit', mutate),
        chipHooks = new test.Hooks()
      const chip = () =>
        find(
          form.render(),
          (element) =>
            typeof element.type === 'function' &&
            element.type.name === 'NewChip' &&
            element.props.label === tr(kind === 'component' ? 'Otro' : 'Categoría'),
        )
      const renderChip = () => chipHooks.render(() => invoke(chip()))
      renderChip().props.onClick()
      find(renderChip(), (element) => element.type === 'input').props.onChange({
        target: { value: 'Retry name' },
      })
      const enter = () =>
        find(renderChip(), (element) => element.type === 'input').props.onKeyDown({
          key: 'Enter',
          preventDefault: vi.fn(),
        })
      enter()
      await flush()
      expect(find(renderChip(), (element) => element.type === 'input').props.value).toBe(
        'Retry name',
      )
      let tree = form.render()
      for (const name of ['Synthetic component', 'Synthetic category'])
        expect(
          find(tree, (element) => element.type === 'button' && element.props.children === name)
            .props['aria-pressed'],
        ).toBe(true)
      expect(component(tree, 'Footer').props.error).toBe('Synthetic creation failed')
      enter()
      await flush()
      tree = form.render()
      expect(mutate).toHaveBeenCalledTimes(2)
      expect(mutate.mock.calls[1][0]).toMatchObject({
        kind: kind === 'component' ? 'addComponent' : 'addCategory',
        name: 'Retry name',
      })
      expect(
        find(
          tree,
          (element) => element.type === 'button' && element.props.children === 'Retry name',
        ).props['aria-pressed'],
      ).toBe(true)
      expect(renderChip().type).toBe('button')
    },
  )

  it('does not create twice when Enter is followed by blur during an outstanding request', async () => {
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_resolve, fail) => {
      reject = fail
    })
    const form = eventForm(fixture(), 'edit', vi.fn().mockReturnValue(pending)),
      chipHooks = new test.Hooks()
    const renderChip = () => chipHooks.render(() => invoke(component(form.render(), 'NewChip')))
    renderChip().props.onClick()
    find(renderChip(), (element) => element.type === 'input').props.onChange({
      target: { value: 'Keep me' },
    })
    const input = find(renderChip(), (element) => element.type === 'input')
    input.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() })
    input.props.onBlur()
    expect(form.mutate).toHaveBeenCalledOnce()
    expect(find(renderChip(), (element) => element.type === 'input').props.readOnly).toBe(true)
    reject(new Error('Synthetic failure'))
    await flush()
    expect(find(renderChip(), (element) => element.type === 'input').props).toMatchObject({
      value: 'Keep me',
      readOnly: false,
    })
  })
})

describe('Atomic event duplication submission', () => {
  it('sends one event-and-roster action and retries a rejected transaction without a second roster action', async () => {
    const s = fixture()
    s.members.push(
      { id: 'inactive', organizationID: 'org', name: 'Inactive', isActive: false },
      { id: 'excluded', organizationID: 'org', name: 'Excluded', isActive: true },
    )
    s.attendance.push(
      { ...s.attendance[0], id: 'inactive-row', memberID: 'inactive' },
      { ...s.attendance[0], id: 'excluded-row', memberID: 'excluded', isVoided: true },
    )
    const mutate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Synthetic roster rejected'))
      .mockResolvedValue(s)
    const form = eventForm(s, 'duplicate', mutate)
    await form.render().props.onSubmit({ preventDefault: vi.fn() })
    expect(mutate).toHaveBeenCalledOnce()
    expect(form.close).not.toHaveBeenCalled()
    expect(form.saved).not.toHaveBeenCalled()
    expect(mutate.mock.calls[0][0]).toMatchObject({
      kind: 'addEvent',
      memberIDs: ['member'],
      entity: { title: s.events[0].title },
    })
    await form.render().props.onSubmit({ preventDefault: vi.fn() })
    expect(mutate.mock.calls.map(([action]) => action.kind)).toEqual(['addEvent', 'addEvent'])
    expect(form.saved).toHaveBeenCalledWith(mutate.mock.calls[1][0].entity.id)
    expect(form.close).toHaveBeenCalledOnce()
  })
  it('omits memberIDs when copying the list is turned off', async () => {
    const form = eventForm(fixture(), 'duplicate')
    find(
      form.render(),
      (element) =>
        typeof element.type === 'function' &&
        element.type.name === 'Toggle' &&
        element.props.label === tr('Copiar la lista'),
    ).props.onChange(false)
    await form.render().props.onSubmit({ preventDefault: vi.fn() })
    expect(form.mutate).toHaveBeenCalledOnce()
    expect(form.mutate.mock.calls[0][0]).not.toHaveProperty('memberIDs')
  })
  it('guards a duplicate submit before React has rerendered the busy state', async () => {
    let resolve!: () => void
    const pending = new Promise<void>((done) => {
      resolve = done
    })
    const form = eventForm(fixture(), 'duplicate', vi.fn().mockReturnValue(pending)),
      tree = form.render()
    const first = tree.props.onSubmit({ preventDefault: vi.fn() })
    const second = tree.props.onSubmit({ preventDefault: vi.fn() })
    expect(form.mutate).toHaveBeenCalledOnce()
    resolve()
    await Promise.all([first, second])
    expect(form.close).toHaveBeenCalledOnce()
  })
})

describe.each([
  ['phone', 600],
  ['tablet', 900],
  ['desktop', 1200],
] as const)('Filtered event selection on %s', (layout, width) => {
  function app() {
    window.innerWidth = width
    const s = fixture(),
      hooks = new test.Hooks()
    s.components.push(
      { id: 'other', organizationID: 'org', name: 'Other' },
      { id: 'empty', organizationID: 'org', name: 'Empty' },
    )
    s.events.push({
      ...s.events[0],
      id: 'other-event',
      componentID: 'other',
      startsAt: '2026-10-22T12:00:00Z',
    })
    test.context = {
      snapshot: s,
      initialOrganizationID: 'org',
      drive: emptyDrive,
      driveBusy: false,
      demo: true,
      loading: false,
      fault: '',
      busy: false,
      notify: vi.fn(),
      toast: null,
    }
    const render = () => hooks.render(() => App())
    component(render(), 'Agenda').props.select('event')
    return { render, s }
  }
  it('clears unrelated detail, chooses only matching wide-screen events and clears empty filters', () => {
    const a = app()
    component(a.render(), 'Agenda').props.setComponentFilter('other')
    let tree = a.render()
    if (layout === 'phone') expect(() => component(tree, 'EventView')).toThrow()
    else expect(component(tree, 'EventView').props.event.id).toBe('other-event')
    component(tree, 'Agenda').props.setComponentFilter('empty')
    tree = a.render()
    expect(component(tree, 'Agenda').props.selectedID).toBeNull()
    expect(() => component(tree, 'EventView')).toThrow()
    component(tree, 'Agenda').props.setComponentFilter('')
    tree = a.render()
    if (layout === 'phone') expect(() => component(tree, 'EventView')).toThrow()
    else expect(component(tree, 'Agenda').props.selectedID).not.toBeNull()
  })
  it('retains a valid selection and explicit event navigation clears the filter', () => {
    const a = app()
    component(a.render(), 'Agenda').props.setComponentFilter('component')
    let tree = a.render()
    expect(component(tree, 'EventView').props.event.id).toBe('event')
    component(tree, 'Agenda').props.setComponentFilter('other')
    tree = a.render()
    component(tree, 'SearchSheet').props.openEvent('event')
    tree = a.render()
    expect(component(tree, 'Agenda').props.componentFilter).toBe('')
    expect(component(tree, 'EventView').props.event.id).toBe('event')
  })
  it('removes detail if synchronization reclassifies the selected event out of its filter', () => {
    const a = app()
    component(a.render(), 'Agenda').props.setComponentFilter('component')
    a.render()
    a.s.events = a.s.events.map((event) => ({ ...event, componentID: 'other' }))
    const tree = a.render()
    expect(component(tree, 'Agenda').props.selectedID).toBeNull()
    expect(() => component(tree, 'EventView')).toThrow()
  })
})

it('keeps PDF page changes, row-height edits and table-position edits renderable', async () => {
  window.nexoDevice = 'iPhone'
  const s = fixture(),
    template = {
      ...newTemplate('org'),
      backgroundPDFData: 'synthetic-pdf',
      tableTopOffset: 600,
      rowHeight: 18,
    },
    hooks = new test.Hooks(),
    notify = vi.fn()
  s.templates = [template]
  test.context = { mutate: vi.fn(), busy: false, notify, demo: true }
  test.bridge.mockResolvedValue({
    image: 'synthetic-image',
    pages: [
      { width: 320, height: 350 },
      { width: 250, height: 350 },
    ],
  })
  const render = () =>
    component(
      hooks.render(() => DocumentStudio({ s, orgID: 'org', initial: template, back: vi.fn() })),
      'MobileStudio',
    ).props
  render()
  await flush()
  let studio = render()
  studio.changePage(0)
  studio = render()
  expect(studio.draft.tableTopOffset).toBe(219)
  studio.patch({ rowHeight: 80 })
  studio = render()
  expect(studio.draft.tableTopOffset).toBe(173)
  studio.patch({ tableTopOffset: 600 })
  studio = render()
  expect(studio.draft.tableTopOffset).toBe(173)
  studio.changePage(1)
  studio = render()
  expect(studio.draft.listPageIndex).toBe(0)
  expect(studio.draft.tableTopOffset).toBe(173)
  expect(notify).toHaveBeenCalledWith(
    tr('El PDF no tiene una página donde pueda colocarse la lista.'),
    true,
  )
})


describe('Inline name editing', () => {
  function editor(onSave = vi.fn().mockResolvedValue(undefined)) {
    const hooks = new test.Hooks()
    const render = () => hooks.render(() => InlineText({ value: 'Original', label: 'Name', onSave }))
    find(render(), (element) => element.type === 'button').props.onClick()
    find(render(), (element) => element.type === 'input').props.onChange({ target: { value: 'Renamed' } })
    const input = () => find(render(), (element) => element.type === 'input')
    const key = (name: string) => ({ key: name, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    return { render, input, key, onSave }
  }

  it('submits only once when Enter is followed by blur, and retries a rejected name', async () => {
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_resolve, fail) => { reject = fail })
    const save = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined)
    const r = editor(save), input = r.input()
    input.props.onKeyDown(r.key('Enter'))
    input.props.onBlur()
    expect(save).toHaveBeenCalledOnce()
    expect(r.input().props.readOnly).toBe(true)
    reject(new Error('Synthetic rename failed'))
    await flush()
    expect(r.input().props).toMatchObject({ value: 'Renamed', readOnly: false })
    r.input().props.onKeyDown(r.key('Enter'))
    await flush()
    expect(save.mock.calls).toEqual([['Renamed'], ['Renamed']])
    expect(find(r.render(), (element) => element.type === 'button')).toBeDefined()
  })

  it('Escape cancels without committing through a trailing blur callback', async () => {
    const r = editor(), input = r.input()
    input.props.onKeyDown(r.key('Escape'))
    input.props.onBlur()
    await flush()
    expect(r.onSave).not.toHaveBeenCalled()
    expect(find(r.render(), (element) => element.type === 'button').props.children).toBe('Original')
  })

  it('does not dismiss a pending rename as if Escape had canceled it', async () => {
    let resolve!: () => void
    const r = editor(vi.fn().mockReturnValue(new Promise<void>((done) => { resolve = done })))
    const input = r.input()
    input.props.onKeyDown(r.key('Enter'))
    input.props.onKeyDown(r.key('Escape'))
    expect(r.input().props).toMatchObject({ value: 'Renamed', readOnly: true })
    resolve()
    await flush()
    expect(r.onSave).toHaveBeenCalledOnce()
    expect(find(r.render(), (element) => element.type === 'button')).toBeDefined()
  })
})

describe('Managed classification creation', () => {
  it.each(['component', 'category', 'group'])(
    'guards repeated %s submissions and keeps a rejected name for retry',
    async (kind) => {
      let reject!: (error: Error) => void
      const pending = new Promise<void>((_resolve, fail) => { reject = fail })
      const mutate = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(fixture())
      test.context = { mutate }
      const s = fixture(), hooks = new test.Hooks()
      const sheet = kind === 'group'
        ? GroupsSheet({ s, orgID: 'org', open: true, close: vi.fn() })
        : ComponentsSheet({ s, orgID: 'org', open: true, close: vi.fn() })
      const label = tr(kind === 'group' ? 'Nuevo grupo' : kind === 'component' ? 'Nuevo componente' : 'Categoría')
      const add = find(sheet, (element) => typeof element.type === 'function' && element.type.name === 'AddLine' && element.props.label === label)
      const render = () => hooks.render(() => invoke(add))
      render().props.onClick()
      find(render(), (element) => element.type === 'input').props.onChange({ target: { value: 'Keep this name' } })
      const form = render()
      form.props.onSubmit({ preventDefault: vi.fn() })
      form.props.onSubmit({ preventDefault: vi.fn() })
      expect(mutate).toHaveBeenCalledOnce()
      expect(find(render(), (element) => element.type === 'input').props.readOnly).toBe(true)
      expect(find(render(), (element) => element.type === 'button').props.disabled).toBe(true)
      reject(new Error('Synthetic creation failed'))
      await flush()
      expect(find(render(), (element) => element.type === 'input').props).toMatchObject({ value: 'Keep this name', readOnly: false })
      render().props.onSubmit({ preventDefault: vi.fn() })
      await flush()
      expect(mutate).toHaveBeenCalledTimes(2)
      expect(mutate.mock.calls[1][0]).toMatchObject({ name: 'Keep this name' })
      expect(find(render(), (element) => element.type === 'input').props.value).toBe('')
    },
  )
})
