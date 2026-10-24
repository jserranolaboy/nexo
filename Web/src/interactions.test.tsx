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
    nexoLocale: 'en',
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
    present: true,
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
// Geometry tests drive mobile controls, not browser-dependent pinch/scroll behavior.
vi.mock('./usePaperZoom', () => ({
  usePaperZoom: () => ({ scroll: { current: null }, width: 0, zoom: 1, reset: vi.fn() }),
}))
vi.mock('motion/react', () => ({
  AnimatePresence: 'presence',
  motion: new Proxy({}, { get: (_target, name) => String(name) }),
  useMotionValue: () => ({ set: vi.fn() }),
  useReducedMotion: () => false,
  useIsPresent: () => test.present,
  useTransform: () => 0,
  animate: vi.fn(),
}))

import { InlineText, Sheet } from './kit'
import { animate } from 'motion/react'
import { ComponentsSheet, GroupsSheet } from './Manage'
import { EventView } from './EventView'
import { DocumentStudio } from './Studio'
import { WorkspaceProvider } from './workspace'
import { EventForm, SimpleForm } from './forms'
import { App } from './App'
import { DrivePanel } from './DrivePanel'
import { SpaceManager } from './SpaceManager'

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
  test.present = true
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
  const recordElement: Element = { ...original, props: { ...original.props, close } }
  const render = () => recordHooks.render(() => invoke(recordElement))
  let tree = render()
  find(tree, (element) => element.type === 'textarea').props.onChange({
    target: { value: 'Avisó' },
  })
  tree = render()
  return { tree, render, mutate, close, openMember,
    dispose: () => { recordHooks.dispose(); rollHooks.dispose(); eventHooks.dispose() },
    changeContext: (changeEvent = false) => {
      const event = changeEvent ? { ...s.events[0], id: 'next-event' } : s.events[0]
      const row = { ...s.attendance[0], id: 'next-row', eventID: event.id, memberID: 'next-member', note: 'Existing next note' }
      s.members.push({ id: 'next-member', organizationID: 'org', name: 'Bea', isActive: true })
      if (changeEvent) s.events.push(event)
      s.attendance.push(row)
      recordElement.props.event = event
      recordElement.props.row = row
      return render()
    },
  }
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
    hooks = new test.Hooks(),
    outerHooks = new test.Hooks()
  test.context = { mutate, busy: false }
  const form = outerHooks.render(() => component(
    EventForm({ s, orgID: 'org', draft: { mode, event: s.events[0] }, close, saved }),
    'EventFormBody',
  ))
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


describe('PDF preview input coherence', () => {
  function studioFixture() {
    window.nexoDevice = 'iPhone'
    let s = fixture()
    s.attendance[0].memberNameSnapshot = 'Ana'
    const template = newTemplate('org'), hooks = new test.Hooks()
    s.templates = [template]
    test.context = { mutate: vi.fn(), notify: vi.fn(), demo: true, busy: false }
    const render = () => component(hooks.render(() => DocumentStudio({
      s, orgID: 'org', initial: template, eventID: 'event', back: vi.fn(),
    })), 'MobileStudio').props
    const update = (change: (value: typeof s) => typeof s) => { s = change(s) }
    return { render, update }
  }
  const final = { token: 'old-pdf', image: 'old-image', pageCount: 2 }

  it.each(['after-render', 'during-render'])(
    'invalidates a PDF when attendance changes %s without losing template edits',
    async (timing) => {
      const r = studioFixture()
      let complete!: (value: unknown) => void
      test.bridge.mockImplementation(({ command }) => command === 'renderPDF'
        ? new Promise((resolve) => { complete = resolve }) : Promise.resolve({ saved: true }))
      r.render().patch({ headerTitle: 'Unsaved design' })
      const request = r.render().render()
      expect(test.bridge.mock.calls.find(([p]) => p.command === 'renderPDF')![0].entries[0].status).toBe('present')
      if (timing === 'after-render') { complete(final); await request }
      r.update((s) => ({ ...s, revision: s.revision + 1, attendance: [{ ...s.attendance[0], status: 'absent' }] }))
      expect(r.render().entries[0].status).toBe('absent')
      if (timing === 'during-render') { complete(final); await request }
      const studio = r.render()
      expect(studio.final).toBeNull()
      expect(studio.rendering).toBe(false)
      expect(studio.draft.headerTitle).toBe('Unsaved design')
      expect(studio.dirty).toBe(true)
      await studio.exportPDF()
      expect(test.bridge.mock.calls.some(([p]) => p.command === 'exportPDF')).toBe(false)
    },
  )

  it.each(['note', 'name', 'removed', 'event', 'organization'])(
    'invalidates completed output after a relevant %s change', async (change) => {
      const r = studioFixture()
      test.bridge.mockResolvedValue(final)
      await r.render().render()
      expect(r.render().final).toEqual(final)
      r.update((s) => ({ ...s, revision: s.revision + 1,
        attendance: change === 'note' ? [{ ...s.attendance[0], note: 'Updated note' }]
          : change === 'name' ? [{ ...s.attendance[0], memberNameSnapshot: 'Updated name' }]
          : change === 'removed' ? [{ ...s.attendance[0], isVoided: true }] : s.attendance,
        events: change === 'event' ? [{ ...s.events[0], title: 'Updated title' }] : s.events,
        organizations: change === 'organization' ? [{ ...s.organizations[0], name: 'Updated organization' }] : s.organizations,
      }))
      expect(r.render().final).toBeNull()
    },
  )

  it('does not discard an up-to-date PDF after an unrelated snapshot update', async () => {
    const r = studioFixture()
    test.bridge.mockResolvedValue(final)
    await r.render().render()
    const reorderKeys = <T extends object>(record: T) => Object.fromEntries(Object.entries(record).reverse()) as T
    r.update((s) => ({ ...structuredClone(s), revision: s.revision + 1,
      organizations: s.organizations.map(reorderKeys),
      events: s.events.map(reorderKeys),
      attendance: [...s.attendance.map(reorderKeys), { ...s.attendance[0], id: 'unrelated', eventID: 'another-event' }],
    }))
    expect(r.render().final).toEqual(final)
  })

  it('does not let a stale page request restore a PDF invalidated by incoming data', async () => {
    const r = studioFixture()
    let complete!: (value: unknown) => void
    test.bridge.mockImplementation(({ command }) => command === 'renderPDF'
      ? Promise.resolve(final) : new Promise((resolve) => { complete = resolve }))
    await r.render().render()
    const pageRequest = r.render().finalPage(1)
    r.update((s) => ({ ...s, attendance: [{ ...s.attendance[0], status: 'absent' }] }))
    r.render()
    complete({ image: 'stale-page' })
    await pageRequest
    expect(r.render().final).toBeNull()
    expect(r.render().rendering).toBe(false)
  })
})


describe('Template element sizing controls', () => {
  function editor(mobile: boolean) {
    if (mobile) window.nexoDevice = 'iPhone'
    const s = fixture(), template = newTemplate('org')
    template.imageBlocks = [{ id: 'image', imageData: 'synthetic-png', x: 46, y: 46, width: 160, height: 20 }]
    template.textBlocks = [{ id: 'text', text: 'Synthetic heading', x: 46, y: 46, width: 220, fontSize: 14 }]
    s.templates = [template]
    const mutate = vi.fn().mockResolvedValue(s), hooks = new test.Hooks(), mobileHooks = new test.Hooks()
    test.context = { mutate, notify: vi.fn(), demo: true, busy: false }
    const render = () => hooks.render(() => DocumentStudio({ s, orgID: 'org', initial: template, back: vi.fn() }))
    const mobileElement = () => component(render(), 'MobileStudio')
    const renderMobile = () => mobileHooks.render(() => invoke(mobileElement()))
    const save = async () => {
      if (mobile) await mobileElement().props.save()
      else {
        find(render(), (element) => element.type === 'button' && element.props.className === 'button compact').props.onClick()
        await flush()
      }
      return mutate.mock.calls.at(-1)![0].entity
    }
    return { render, renderMobile, save }
  }

  it.each([false, true])('image resizing preserves a savable aspect ratio (mobile=%s)', async (mobile) => {
    const r = editor(mobile)
    if (mobile) {
      component(r.renderMobile(), 'MobilePaper').props.onEdit('image', 'elements')
      find(r.renderMobile(), (element) => typeof element.type === 'function' && element.type.name === 'Range' && element.props.label === tr('Ancho de imagen')).props.onChange(20)
    } else {
      find(r.render(), (element) => String(element.props.className).startsWith('paper-image-block')).props.onClick({ stopPropagation: vi.fn() })
      const label = find(r.render(), (element) => element.type === 'label' && Array.isArray(element.props.children) && element.props.children[0] === tr('Ancho de imagen'))
      find(label, (element) => element.type === 'input').props.onChange({ target: { value: '30' } })
    }
    const image = (await r.save()).imageBlocks[0]
    expect(image.height).toBeGreaterThanOrEqual(20)
    expect(image.width).toBeGreaterThanOrEqual(20)
    expect(image.width / image.height).toBeCloseTo(8)
  })

  it('mobile text width respects the native 60-point minimum', async () => {
    const r = editor(true)
    component(r.renderMobile(), 'MobilePaper').props.onEdit('text', 'elements')
    const width = find(r.renderMobile(), (element) => typeof element.type === 'function' && element.type.name === 'Range' && element.props.label === tr('Ancho'))
    width.props.onChange(20)
    const text = (await r.save()).textBlocks[0]
    expect(text.width).toBeGreaterThanOrEqual(60)
    expect(width.props.min).toBe(60)
  })
})


describe('Template save and import ordering', () => {
  function editor() {
    window.nexoDevice = 'iPhone'
    const s = fixture(), template = newTemplate('org')
    template.imageBlocks = [{ id: 'old-image', imageData: 'old', x: 46, y: 46, width: 160, height: 20 }]
    s.templates = [template]
    let complete!: () => void, reject!: (error: Error) => void
    const mutate = vi.fn().mockImplementation(() => new Promise<void>((resolve, fail) => { complete = resolve; reject = fail }))
    const notify = vi.fn()
    test.context = { mutate, notify, demo: true, busy: false }
    const hooks = new test.Hooks()
    const render = () => component(hooks.render(() => DocumentStudio({ s, orgID: 'org', initial: template, back: vi.fn() })), 'MobileStudio').props
    return { render, mutate, notify, complete: () => complete(), reject: () => reject(new Error('Synthetic save failed')) }
  }
  it.each(['save', 'saveCopy'])('coalesces repeated %s callbacks and waits for the original save', async (action) => {
    const r = editor(), studio = r.render(), settled = vi.fn()
    const first = studio[action](), repeated = studio[action]()
    repeated.then(settled)
    await flush()
    expect(r.mutate).toHaveBeenCalledOnce()
    expect(settled).not.toHaveBeenCalled()
    expect(r.render().busy).toBe(true)
    r.complete()
    await Promise.all([first, repeated])
    expect(settled).toHaveBeenCalledOnce()
    expect(r.render().busy).toBe(false)
    if (action === 'saveCopy') expect(r.render().draft.name.split(tr('· copia'))).toHaveLength(2)
  })
  it('shares one failed save with overlapping save/copy callers and permits a deliberate retry', async () => {
    const r = editor(), studio = r.render()
    studio.patch({ headerTitle: 'Keep this edit' })
    const first = r.render().save(), copy = r.render().saveCopy()
    const results = Promise.allSettled([first, copy])
    await flush()
    expect(r.mutate).toHaveBeenCalledOnce()
    r.reject()
    expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(r.render().draft.headerTitle).toBe('Keep this edit')
    expect(r.render().busy).toBe(false)
    const retry = r.render().save()
    await flush()
    expect(r.mutate).toHaveBeenCalledTimes(2)
    r.complete()
    await retry
    expect(r.render().dirty).toBe(false)
  })
  it('appends an imported image to the latest list without resurrecting removed images', async () => {
    const r = editor()
    let complete!: (value: unknown) => void
    test.bridge.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    const pending = r.render().importImage()
    r.render().patch({ imageBlocks: [] })
    complete({ data: 'new-image', width: 160, height: 20 })
    await pending
    expect(r.render().draft.imageBlocks).toHaveLength(1)
    expect(r.render().draft.imageBlocks[0].imageData).toBe('new-image')
  })
  it('preserves both out-of-order image imports instead of replacing the first completed image', async () => {
    const r = editor(), complete: ((value: unknown) => void)[] = []
    test.bridge.mockImplementation(() => new Promise((resolve) => { complete.push(resolve) }))
    const first = r.render().importImage(), second = r.render().importImage()
    complete[1]({ data: 'second-image', width: 100, height: 100 })
    await second
    complete[0]({ data: 'first-image', width: 100, height: 100 })
    await first
    expect(r.render().draft.imageBlocks.map((image: { imageData: string }) => image.imageData)).toEqual(['old', 'second-image', 'first-image'])
  })
  it('fits current text and table edits when a PDF import completes', async () => {
    const r = editor()
    let complete!: (value: unknown) => void
    test.bridge.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    const pending = r.render().importPDF()
    r.render().addText()
    r.render().patch({ rowHeight: 80, tableTopOffset: 600 })
    complete({ data: 'pdf', listPageIndex: 0, pages: [{ width: 320, height: 350 }] })
    await pending
    const draft = r.render().draft
    expect(draft.textBlocks).toHaveLength(1)
    expect(draft.rowHeight).toBe(80)
    expect(draft.tableTopOffset).toBe(173)
    expect(draft.textBlocks[0].x + draft.textBlocks[0].width).toBeLessThanOrEqual(320)
  })
  it('retains repeated text additions before a rerender', () => {
    const r = editor(), studio = r.render()
    const first = studio.addText(), second = studio.addText()
    expect(r.render().draft.textBlocks.map((text: { id: string }) => text.id)).toEqual([first, second])
  })
  it('keeps the most recently requested PDF when imports finish out of order', async () => {
    const r = editor(), complete: ((value: unknown) => void)[] = []
    test.bridge.mockImplementation(({ command }) => command === 'importPDF'
      ? new Promise((resolve) => { complete.push(resolve) }) : Promise.resolve({ image: 'preview', pages: [{ width: 612, height: 792 }] }))
    const first = r.render().importPDF(), second = r.render().importPDF()
    complete[1]({ data: 'new-pdf', listPageIndex: 0, pages: [{ width: 612, height: 792 }] })
    await second
    complete[0]({ data: 'old-pdf', listPageIndex: 0, pages: [{ width: 612, height: 792 }] })
    await first
    expect(r.render().draft.backgroundPDFData).toBe('new-pdf')
  })
  it('does not apply a delayed PDF after the user chose blank paper', async () => {
    const r = editor()
    let complete!: (value: unknown) => void
    test.bridge.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    const pending = r.render().importPDF()
    r.render().patch({ backgroundPDFData: undefined, listPageIndex: 0 })
    complete({ data: 'old-pdf', listPageIndex: 0, pages: [{ width: 612, height: 792 }] })
    await pending
    expect(r.render().draft.backgroundPDFData).toBeUndefined()
  })
  it.each(['undo', 'redo'])('%s cancels an older pending paper replacement', async (action) => {
    const r = editor()
    let complete!: (value: unknown) => void
    test.bridge.mockImplementation(({ command }) => command === 'importPDF'
      ? new Promise((resolve) => { complete = resolve }) : Promise.resolve({ image: 'preview', pages: [{ width: 612, height: 792 }] }))
    r.render().patch({ backgroundPDFData: 'chosen-paper' })
    if (action === 'redo') r.render().undo()
    const pending = r.render().importPDF()
    r.render()[action]()
    const expected = r.render().draft.backgroundPDFData
    complete({ data: 'stale-paper', listPageIndex: 0, pages: [{ width: 612, height: 792 }] })
    await pending
    expect(r.render().draft.backgroundPDFData).toBe(expected)
  })
  it('does not report a superseded PDF import failure as a current error', async () => {
    const r = editor()
    let reject!: (error: Error) => void
    test.bridge.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    const pending = r.render().importPDF()
    r.render().patch({ backgroundPDFData: undefined })
    reject(new Error('Superseded picker failure'))
    await pending
    expect(r.notify).not.toHaveBeenCalled()
  })
  it.each(['importImage', 'importPDF'])('canceled %s leaves the latest draft alone', async (action) => {
    const r = editor()
    let complete!: (value: unknown) => void
    test.bridge.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    const pending = r.render()[action]()
    r.render().addText()
    const expected = r.render().draft
    complete({ cancelled: true })
    await pending
    expect(r.render().draft).toEqual(expected)
  })
})


describe('Startup draft recovery barrier', () => {
  function app() {
    const s = fixture(), hooks = new test.Hooks(), notify = vi.fn(), mutate = vi.fn()
    const context = { snapshot: s, initialOrganizationID: 'org', drive: emptyDrive, driveBusy: false,
      demo: false, loading: false, fault: '', busy: false, notify, mutate, toast: null, reload: vi.fn().mockResolvedValue(undefined) }
    test.context = context
    const requests: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = []
    test.bridge.mockImplementation(({ command }) => command === 'recoverDraft'
      ? new Promise((resolve, reject) => requests.push({ resolve, reject })) : Promise.resolve({}))
    const render = () => hooks.render(() => App())
    const activeEditor = () => find(render(), (element) => !!element.props.initial && !!element.props.back)
    const retry = () => find(render(), (element) => element.type === 'button' && element.props.children === tr('Reintentar')).props.onClick()
    const noDraftWrites = () => expect(test.bridge.mock.calls.some(([request]) => request.command === 'draftState')).toBe(false)
    return { render, activeEditor, retry, noDraftWrites, requests, context, hooks, notify, mutate }
  }
  const recovered = () => ({ template: { ...newTemplate('org'), name: 'Recovered work' }, organizationID: 'org' })

  it('keeps editor entry unavailable until the saved draft is recovered', async () => {
    const r = app()
    const tree = r.render()
    expect(() => component(tree, 'SearchSheet')).toThrow()
    expect(() => r.activeEditor()).toThrow()
    r.noDraftWrites()
    const draft = recovered()
    r.requests[0].resolve(draft)
    await flush()
    expect(r.activeEditor().props.initial).toEqual(draft.template)
    expect(r.notify).toHaveBeenCalledWith(tr('Borrador recuperado'))
  })
  it('unlocks a workspace only after confirming that no saved draft exists', async () => {
    const r = app()
    r.render()
    r.requests[0].resolve({})
    await flush()
    expect(component(r.render(), 'SearchSheet')).toBeDefined()
    expect(() => r.activeEditor()).toThrow()
    r.noDraftWrites()
  })
  it('preserves a failed read and lets an explicit retry recover the original draft', async () => {
    const r = app()
    r.render()
    r.requests[0].reject(new Error('Synthetic temporary read failure'))
    await flush()
    expect(() => component(r.render(), 'SearchSheet')).toThrow()
    expect(find(r.render(), (element) => element.props.role === 'alert')).toBeDefined()
    r.noDraftWrites()
    r.retry()
    r.render()
    expect(r.requests).toHaveLength(2)
    const draft = recovered()
    r.requests[1].resolve(draft)
    await flush()
    expect(r.activeEditor().props.initial).toEqual(draft.template)
  })
  it('ignores an old recovery result in demo mode and reads again after returning', async () => {
    const r = app()
    r.render()
    r.context.demo = true
    expect(component(r.render(), 'SearchSheet')).toBeDefined()
    r.requests[0].resolve(recovered())
    await flush()
    expect(() => r.activeEditor()).toThrow()
    expect(r.notify).not.toHaveBeenCalled()
    r.context.demo = false
    r.render()
    expect(r.requests).toHaveLength(2)
    r.requests[1].resolve({})
    await flush()
    expect(component(r.render(), 'SearchSheet')).toBeDefined()
    r.noDraftWrites()
  })
  it('does not apply a recovery response after the app unmounts', async () => {
    const r = app()
    r.render()
    r.hooks.dispose()
    r.requests[0].resolve(recovered())
    await flush()
    expect(r.notify).not.toHaveBeenCalled()
    r.noDraftWrites()
  })
  it('keeps an orphan draft blocked and offers backup recovery instead of clearing it', async () => {
    const r = app()
    r.context.snapshot = { ...r.context.snapshot, organizations: [] }
    r.render()
    r.requests[0].resolve(recovered())
    await flush()
    expect(find(r.render(), (element) => element.props.role === 'alert')).toBeDefined()
    expect(find(r.render(), (element) => element.type === 'button' && element.props.children === tr('Importar copia'))).toBeDefined()
    expect(() => r.activeEditor()).toThrow()
    r.noDraftWrites()
  })
  it('checks the latest workspace before recovering a draft and can explicitly restore its trashed space', async () => {
    const r = app()
    r.render()
    r.context.snapshot = { ...r.context.snapshot, organizations: [{ ...r.context.snapshot.organizations[0], deletedAt: '2026-10-24T00:00:00Z' }] }
    r.render()
    r.requests[0].resolve(recovered())
    await flush()
    expect(() => r.activeEditor()).toThrow()
    r.noDraftWrites()
    r.mutate.mockImplementation(async () => {
      r.context.snapshot = { ...r.context.snapshot, organizations: [{ ...r.context.snapshot.organizations[0], deletedAt: undefined }] }
      return r.context.snapshot
    })
    find(r.render(), (element) => element.type === 'button' && element.props.children === tr('Restaurar {0}', 'Synthetic')).props.onClick()
    await flush()
    r.render()
    expect(r.mutate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'setOrganizationDeleted', organizationID: 'org', deleted: false, expectedDeleted: true }))
    expect(r.requests).toHaveLength(2)
    const draft = recovered()
    r.requests[1].resolve(draft)
    await flush()
    expect(r.activeEditor().props.initial).toEqual(draft.template)
  })
  it.each(['missing-template', 'missing-id', 'wrong-space'])('preserves a malformed %s draft instead of starting another editor', async (kind) => {
    const r = app(), draft = recovered()
    const malformed = kind === 'missing-template' ? { organizationID: 'org' }
      : { ...draft, template: { ...draft.template, ...(kind === 'missing-id' ? { id: '' } : { organizationID: 'different-space' }) } }
    r.render()
    r.requests[0].resolve(malformed)
    await flush()
    expect(find(r.render(), (element) => element.props.role === 'alert')).toBeDefined()
    expect(() => component(r.render(), 'SearchSheet')).toThrow()
    expect(() => r.activeEditor()).toThrow()
    r.noDraftWrites()
  })
  it('keeps a draft retryable when restoring its trashed space fails', async () => {
    const r = app()
    r.context.snapshot = { ...r.context.snapshot, organizations: [{ ...r.context.snapshot.organizations[0], deletedAt: '2026-10-24T00:00:00Z' }] }
    r.render()
    r.requests[0].resolve(recovered())
    await flush()
    r.mutate.mockRejectedValue(new Error('Synthetic restore rejected'))
    const button = find(r.render(), (element) => element.type === 'button' && element.props.children === tr('Restaurar {0}', 'Synthetic'))
    button.props.onClick()
    button.props.onClick()
    await flush()
    expect(r.mutate).toHaveBeenCalledOnce()
    expect(find(r.render(), (element) => element.props.role === 'alert').props.children).toBe('Synthetic restore rejected')
    r.retry()
    r.render()
    expect(r.requests).toHaveLength(2)
    r.noDraftWrites()
  })
  it('retries an orphan draft after an explicitly imported workspace makes its space available', async () => {
    const r = app(), saved = r.context.snapshot
    r.context.snapshot = { ...saved, organizations: [] }
    r.context.reload.mockImplementation(async () => { r.context.snapshot = saved })
    r.render()
    r.requests[0].resolve(recovered())
    await flush()
    const previous = test.bridge.getMockImplementation()!
    test.bridge.mockImplementation((request) => request.command === 'restoreWorkspace'
      ? Promise.resolve({ restored: true }) : previous(request))
    find(r.render(), (element) => element.type === 'button' && element.props.children === tr('Importar copia')).props.onClick()
    await flush()
    r.render()
    expect(r.context.reload).toHaveBeenCalledOnce()
    expect(r.requests).toHaveLength(2)
    const draft = recovered()
    r.requests[1].resolve(draft)
    await flush()
    expect(r.activeEditor().props.initial).toEqual(draft.template)
    r.noDraftWrites()
  })
  it('does not allow keyboard document creation to bypass pending recovery', async () => {
    const r = app()
    r.render()
    for (const key of ['3', 'n']) {
      window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key, metaKey: true }))
      r.render()
    }
    r.requests[0].resolve({})
    await flush()
    expect(() => r.activeEditor()).toThrow()
    r.noDraftWrites()
  })
})


describe('Space rename lifecycle', () => {
  function editor() {
    const s = fixture(), appHooks = new test.Hooks(), switchHooks = new test.Hooks()
    s.organizations.push({ ...s.organizations[0], id: 'other-org', name: 'Other space' })
    let reject!: (error: Error) => void, resolve!: () => void
    const mutate = vi.fn().mockImplementation(() => new Promise<void>((done, fail) => { resolve = done; reject = fail }))
    test.context = { snapshot: s, initialOrganizationID: 'org', drive: emptyDrive, driveBusy: false,
      demo: true, loading: false, fault: '', busy: false, notify: vi.fn(), mutate, toast: null }
    const app = () => appHooks.render(() => App())
    const switcher = component(app(), 'SpaceSwitcher')
    const render = () => switchHooks.render(() => invoke(switcher))
    find(render(), (element) => typeof element.type === 'function' && element.type.name === 'MenuItem' && element.props.children === tr('Renombrar')).props.onClick()
    find(render(), (element) => element.type === 'input').props.onChange({ target: { value: 'Keep typed name' } })
    const input = () => find(render(), (element) => element.type === 'input')
    const escape = () => ({ key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() })
    return { app, switcher, render, input, escape, mutate, resolve: () => resolve(), reject: () => reject(new Error('Synthetic rename failed')) }
  }
  it('submits once before rerender and keeps the pending name read-only', async () => {
    const r = editor(), form = r.render()
    form.props.onSubmit({ preventDefault: vi.fn() })
    form.props.onSubmit({ preventDefault: vi.fn() })
    expect(r.mutate).toHaveBeenCalledOnce()
    expect(r.input().props.readOnly).toBe(true)
    r.resolve()
    await flush()
    expect(() => r.input()).toThrow()
  })
  it('retains a rejected name after submit/blur and supports a deliberate retry', async () => {
    const r = editor(), form = r.render()
    form.props.onSubmit({ preventDefault: vi.fn() })
    find(form, (element) => element.type === 'input').props.onBlur()
    r.reject()
    await flush()
    expect(r.input().props).toMatchObject({ value: 'Keep typed name', readOnly: false })
    r.render().props.onSubmit({ preventDefault: vi.fn() })
    expect(r.mutate).toHaveBeenCalledTimes(2)
    expect(r.mutate.mock.calls[1][0]).toMatchObject({ kind: 'rename', entity: 'organization', id: 'org', name: 'Keep typed name' })
    r.resolve()
    await flush()
    expect(() => r.input()).toThrow()
  })
  it('does not submit a rename through an old form callback after Escape', () => {
    const r = editor(), form = r.render()
    r.input().props.onKeyDown(r.escape())
    form.props.onSubmit({ preventDefault: vi.fn() })
    expect(r.mutate).not.toHaveBeenCalled()
    expect(() => r.input()).toThrow()
  })
  it('does not present an outstanding rename as canceled by Escape', async () => {
    const r = editor(), form = r.render()
    form.props.onSubmit({ preventDefault: vi.fn() })
    r.input().props.onKeyDown(r.escape())
    expect(r.input().props.readOnly).toBe(true)
    r.reject()
    await flush()
    expect(r.input().props.value).toBe('Keep typed name')
  })
  it('still allows blur to cancel an unsubmitted name', () => {
    const r = editor()
    r.input().props.onBlur()
    expect(r.mutate).not.toHaveBeenCalled()
    expect(() => r.input()).toThrow()
  })
  it('gives each active space its own rename component identity', () => {
    const r = editor()
    expect(r.switcher.key).toBe('org')
    r.switcher.props.enter('other-org')
    const next = component(r.app(), 'SpaceSwitcher')
    expect(next.key).toBe('other-org')
    expect(next.props.current).toMatchObject({ id: 'other-org', name: 'Other space' })
  })
})

function classificationChip(
  kind: "component" | "category",
  mutate = vi.fn().mockResolvedValue(fixture()),
) {
  const s = fixture();
  s.categories = [
    { id: "category", componentID: "component", name: "Synthetic category" },
  ];
  s.events[0].categoryID = "category";
  const form = eventForm(s, "edit", mutate),
    hooks = new test.Hooks();
  const render = () =>
    hooks.render(() =>
      invoke(
        find(
          form.render(),
          (element) =>
            typeof element.type === "function" &&
            element.type.name === "NewChip" &&
            element.props.label ===
              tr(kind === "component" ? "Otro" : "Categoría"),
        ),
      ),
    );
  const input = () => find(render(), (element) => element.type === "input");
  const open = (name: string) => {
    render().props.onClick();
    input().props.onChange({ target: { value: name } });
  };
  return { render, input, open, mutate, form, s };
}

describe("Event classification cancellation lifecycle", () => {
  it.each(["component", "category"] as const)(
    "Escape cancels %s creation before trailing blur or Enter",
    async (kind) => {
      const chip = classificationChip(kind);
      chip.open("Do not create");
      const input = chip.input();
      input.props.onKeyDown({ key: "Escape", stopPropagation: vi.fn() });
      input.props.onBlur();
      input.props.onKeyDown({ key: "Enter", preventDefault: vi.fn() });
      await flush();
      expect(chip.mutate).not.toHaveBeenCalled();
      expect(chip.render().type).toBe("button");
      chip.render().props.onClick();
      expect(chip.input().props.value).toBe("");
    },
  );

  it("does not present a submitted creation as canceled, and keeps its rejected name retryable", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    const chip = classificationChip(
      "component",
      vi.fn().mockReturnValueOnce(pending).mockResolvedValue(fixture()),
    );
    chip.open("Keep rejected name");
    const input = chip.input();
    input.props.onKeyDown({ key: "Enter", preventDefault: vi.fn() });
    input.props.onKeyDown({ key: "Escape", stopPropagation: vi.fn() });
    expect(chip.input().props).toMatchObject({
      value: "Keep rejected name",
      readOnly: true,
    });
    reject(new Error("Synthetic creation failed"));
    await flush();
    expect(chip.input().props).toMatchObject({
      value: "Keep rejected name",
      readOnly: false,
    });
    chip.input().props.onKeyDown({ key: "Enter", preventDefault: vi.fn() });
    await flush();
    expect(chip.mutate).toHaveBeenCalledTimes(2);
    expect(chip.mutate.mock.calls[1][0].name).toBe("Keep rejected name");
    expect(chip.render().type).toBe("button");
  });

  it("ignores a retained input callback after successful creation closes the editor", async () => {
    const chip = classificationChip("component");
    chip.open("Create once");
    const input = chip.input();
    input.props.onKeyDown({ key: "Enter", preventDefault: vi.fn() });
    await flush();
    expect(chip.render().type).toBe("button");
    input.props.onBlur();
    await flush();
    expect(chip.mutate).toHaveBeenCalledOnce();
  });
});

describe("Event classification asynchronous choice preservation", () => {
  it("ignores old-session callbacks after a canceled classification input reopens", async () => {
    const chip = classificationChip("component");
    chip.open("Canceled name");
    const old = chip.input();
    old.props.onKeyDown({ key: "Escape", stopPropagation: vi.fn() });
    chip.open("Current name");
    old.props.onChange({ target: { value: "Stale value" } });
    old.props.onBlur();
    old.props.onKeyDown({ key: "Escape", stopPropagation: vi.fn() });
    await flush();
    expect(chip.mutate).not.toHaveBeenCalled();
    expect(chip.input().props.value).toBe("Current name");
  });

  it.each(["component", "category-component", "category-category"] as const)(
    "retains newer explicit selection after pending %s creation",
    async (choice) => {
      let complete!: (value: ReturnType<typeof fixture>) => void;
      const pending = new Promise<ReturnType<typeof fixture>>((resolve) => {
        complete = resolve;
      });
      const mutate = vi
        .fn()
        .mockReturnValueOnce(pending)
        .mockResolvedValue(fixture());
      const chip = classificationChip(
        choice === "component" ? "component" : "category",
        mutate,
      );
      chip.s.components.push({
        id: "other-component",
        organizationID: "org",
        name: "Other component",
      });
      chip.s.categories.push({
        id: "other-category",
        componentID: "component",
        name: "Other category",
      });
      chip.open("Created classification");
      chip.input().props.onKeyDown({ key: "Enter", preventDefault: vi.fn() });
      find(
        chip.form.render(),
        (element) =>
          element.type === "button" &&
          element.props.children ===
            (choice === "category-category"
              ? "Other category"
              : "Other component"),
      ).props.onClick();
      complete(chip.s);
      await flush();
      await chip.form.render().props.onSubmit({ preventDefault: vi.fn() });
      const saved = mutate.mock.calls[1][0].entity;
      expect(saved.componentID).toBe(
        choice === "category-category" ? "component" : "other-component",
      );
      expect(saved.categoryID).toBe(
        choice === "category-category" ? "other-category" : undefined,
      );
    },
  );

  it("scopes an unsaved category input to its selected component", () => {
    const chip = classificationChip("category");
    chip.s.components.push({
      id: "other-component",
      organizationID: "org",
      name: "Other component",
    });
    const category = () =>
      find(
        chip.form.render(),
        (element) =>
          typeof element.type === "function" &&
          element.type.name === "NewChip" &&
          element.props.label === tr("Categoría"),
      );
    expect(category().key).toBe("component");
    find(
      chip.form.render(),
      (element) =>
        element.type === "button" &&
        element.props.children === "Other component",
    ).props.onClick();
    expect(category().key).toBe("other-component");
  });
});

function rosterPicker() {
  const s = fixture(),
    eventHooks = new test.Hooks(),
    hooks = new test.Hooks();
  s.events[0].volunteerCapacity = 2;
  s.members.push({
    id: "available",
    organizationID: "org",
    name: "Available",
    isActive: true,
  });
  let mode: "list" | "volunteers" | null = "list",
    event = s.events[0];
  const requests: {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }[] = [];
  const mutate = vi
    .fn()
    .mockImplementation(
      () =>
        new Promise((resolve, reject) => requests.push({ resolve, reject })),
    );
  const close = vi.fn(() => {
    mode = null;
  });
  test.context = { mutate, notify: vi.fn(), busy: false };
  const original = component(
    eventHooks.render(() =>
      EventView({
        s,
        event,
        edit: vi.fn(),
        document: vi.fn(),
        openMember: vi.fn(),
      }),
    ),
    "RosterPicker",
  );
  const render = () =>
    hooks.render(() =>
      invoke({
        ...original,
        props: { ...original.props, s, mode, event, close },
      }),
    );
  const input = () => find(render(), (element) => element.type === "input");
  const query = (value: string) =>
    input().props.onChange({ target: { value } });
  const add = () =>
    find(
      render(),
      (element) => element.props.className === "nx-picker-row new",
    );
  const submit = () =>
    find(
      render(),
      (element) =>
        element.type === "button" &&
        element.props.className === "nx-button primary",
    );
  const option = () =>
    find(render(), (element) => element.props.role === "option");
  return {
    s,
    render,
    input,
    query,
    add,
    submit,
    option,
    mutate,
    close,
    resolve: (index = 0) => requests[index].resolve(s),
    reject: (index = 0) =>
      requests[index].reject(new Error("Synthetic picker failure")),
    mode: (next: typeof mode) => {
      mode = next;
      render();
    },
    event: () => {
      event = { ...event, id: "next-event", title: "Next event" };
      render();
    },
    dispose: () => hooks.dispose(),
  };
}

describe("Roster picker request and session lifecycle", () => {
  it("creates only one person for repeated Enter and add callbacks", async () => {
    const r = rosterPicker();
    r.query("New synthetic person");
    const input = r.input(),
      add = r.add();
    input.props.onKeyDown({ key: "Enter", preventDefault: vi.fn() });
    add.props.onClick();
    expect(r.mutate).toHaveBeenCalledOnce();
    expect(r.input().props.readOnly).toBe(true);
    r.resolve();
    await flush();
    expect(r.input().props.value).toBe("");
    expect(r.submit().props.disabled).toBe(false);
  });
  it("submits the selected roster once before rerender", async () => {
    const r = rosterPicker();
    r.option().props.onClick();
    const submit = r.submit();
    submit.props.onClick();
    submit.props.onClick();
    expect(r.mutate).toHaveBeenCalledOnce();
    r.resolve();
    await flush();
    expect(r.close).toHaveBeenCalledOnce();
  });
  it.each(["add-first", "roster-first"])(
    "serializes person creation and roster submission: %s",
    (order) => {
      const r = rosterPicker();
      r.option().props.onClick();
      r.query("New synthetic person");
      const add = r.add(),
        submit = r.submit();
      if (order === "add-first") {
        add.props.onClick();
        submit.props.onClick();
      } else {
        submit.props.onClick();
        add.props.onClick();
      }
      expect(r.mutate).toHaveBeenCalledOnce();
      expect(r.submit().props.disabled).toBe(true);
    },
  );
  it("retains a failed new-person name and permits a deliberate retry", async () => {
    const r = rosterPicker();
    r.query("Retry person");
    r.add().props.onClick();
    r.reject();
    await flush();
    expect(r.input().props).toMatchObject({
      value: "Retry person",
      readOnly: false,
    });
    expect(
      find(r.render(), (element) => element.props.role === "alert").props
        .children,
    ).toBe("Synthetic picker failure");
    r.add().props.onClick();
    expect(r.mutate).toHaveBeenCalledTimes(2);
    expect(r.mutate.mock.calls[1][0]).toMatchObject({
      kind: "addMember",
      name: "Retry person",
    });
    r.resolve(1);
    await flush();
    expect(r.submit().props.disabled).toBe(false);
  });
  it("retains a rejected roster selection for retry without closing the picker", async () => {
    const r = rosterPicker();
    r.option().props.onClick();
    r.submit().props.onClick();
    r.reject();
    await flush();
    expect(r.close).not.toHaveBeenCalled();
    expect(r.option().props["aria-selected"]).toBe(true);
    expect(r.submit().props.disabled).toBe(false);
    r.submit().props.onClick();
    expect(r.mutate).toHaveBeenCalledTimes(2);
    expect(r.mutate.mock.calls[1][0]).toMatchObject({
      kind: "roster",
      memberIDs: ["available"],
    });
  });
  it("does not imply a pending write was canceled or accept selection/search edits while it is pending", () => {
    const r = rosterPicker();
    r.option().props.onClick();
    const option = r.option(),
      input = r.input();
    r.submit().props.onClick();
    input.props.onChange({ target: { value: "Later query" } });
    option.props.onClick();
    component(r.render(), "Sheet").props.onClose();
    find(
      r.render(),
      (element) =>
        element.type === "button" && element.props.children === tr("Cancelar"),
    ).props.onClick();
    expect(r.close).not.toHaveBeenCalled();
    expect(r.input().props).toMatchObject({ value: "", readOnly: true });
    expect(r.option().props).toMatchObject({
      disabled: true,
      "aria-selected": true,
    });
  });
  it("ignores retained submit and add callbacks after an idle dismissal", () => {
    const r = rosterPicker();
    r.option().props.onClick();
    r.query("Canceled person");
    const submit = r.submit(),
      add = r.add();
    component(r.render(), "Sheet").props.onClose();
    submit.props.onClick();
    add.props.onClick();
    expect(r.close).toHaveBeenCalledOnce();
    expect(r.mutate).not.toHaveBeenCalled();
  });
  it.each(["mode", "event"] as const)(
    "does not apply an old person creation to a newer %s session",
    async (change) => {
      const r = rosterPicker();
      r.query("Old person");
      r.add().props.onClick();
      if (change === "mode") r.mode("volunteers");
      else r.event();
      r.query("Current query");
      r.resolve();
      await flush();
      expect(r.input().props.value).toBe("Current query");
      expect(r.submit().props.disabled).toBe(true);
      expect(r.close).not.toHaveBeenCalled();
    },
  );
  it("ignores a superseded request error without unlocking a newer request", async () => {
    const r = rosterPicker();
    r.query("Old person");
    r.add().props.onClick();
    r.mode("volunteers");
    r.query("Current person");
    r.add().props.onClick();
    r.reject();
    await flush();
    expect(() =>
      find(r.render(), (element) => element.props.role === "alert"),
    ).toThrow();
    expect(r.input().props).toMatchObject({
      value: "Current person",
      readOnly: true,
    });
    r.resolve(1);
    await flush();
    expect(r.input().props.readOnly).toBe(false);
  });
  it("does not close a newer screen after the submitting picker unmounts", async () => {
    const r = rosterPicker();
    r.option().props.onClick();
    r.submit().props.onClick();
    r.dispose();
    r.resolve();
    await flush();
    expect(r.close).not.toHaveBeenCalled();
  });
});


function pendingForm(kind: "event" | "member" | "period") {
  const s = fixture(),
    outerHooks = new test.Hooks(),
    hooks = new test.Hooks(),
    completed = vi.fn();
  s.groups.push({
    id: "group",
    organizationID: "org",
    name: "Synthetic group",
  });
  let open = true,
    orgID = "org",
    retained: Element | undefined;
  const close = vi.fn(() => {
    open = false;
  });
  const requests: {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }[] = [];
  const mutate = vi
    .fn()
    .mockImplementation(
      () =>
        new Promise((resolve, reject) => requests.push({ resolve, reject })),
    );
  test.context = { mutate, busy: false };
  const outer = () =>
    outerHooks.render(() =>
      kind === "event"
        ? EventForm({
            s,
            orgID,
            draft: open ? { mode: "edit", event: s.events[0] } : null,
            close,
            saved: completed,
          })
        : SimpleForm({
            s,
            orgID,
            kind: open ? kind : null,
            close,
            created: completed,
          }),
    );
  const render = () => {
    const tree = outer();
    if (open)
      retained = component(
        tree,
        kind === "event" ? "EventFormBody" : "SimpleBody",
      );
    return hooks.render(() => invoke(retained!));
  };
  const input = () =>
    find(
      render(),
      (element) =>
        element.type === "input" &&
        element.props.className === "nx-title-field",
    );
  input().props.onChange({ target: { value: "Original submitted value" } });
  return {
    s,
    render,
    input,
    outer,
    close,
    completed,
    mutate,
    resolve: (index = 0) => requests[index].resolve(s),
    reject: (index = 0) =>
      requests[index].reject(new Error("Synthetic save failure")),
    externallyClose: () => {
      open = false;
      outer();
    },
    reopen: () => {
      open = true;
      outer();
    },
    switchSpace: () => {
      orgID = "other-org";
      outer();
    },
    dispose: () => {
      hooks.dispose();
      outerHooks.dispose();
    },
  };
}

describe("Primary form submission lifetime", () => {
  it.each(["event", "member"] as const)(
    "blocks %s Sheet/Cancel dismissal while its write is pending",
    async (kind) => {
      const r = pendingForm(kind),
        request = r.render().props.onSubmit({ preventDefault: vi.fn() });
      component(r.outer(), "Sheet").props.onClose();
      component(r.render(), "Footer").props.onCancel();
      expect(r.close).not.toHaveBeenCalled();
      r.resolve();
      await request;
      expect(r.completed).toHaveBeenCalledOnce();
      expect(r.close).toHaveBeenCalledOnce();
    },
  );
  it.each(["event", "member"] as const)(
    "ignores late %s completion after external close even while the exit body stays mounted",
    async (kind) => {
      const r = pendingForm(kind),
        request = r.render().props.onSubmit({ preventDefault: vi.fn() });
      r.externallyClose();
      r.resolve();
      await request;
      expect(r.completed).not.toHaveBeenCalled();
      expect(r.close).not.toHaveBeenCalled();
    },
  );
  it.each(["event", "member"] as const)(
    "ignores %s rejection after external unmount",
    async (kind) => {
      const r = pendingForm(kind),
        request = r.render().props.onSubmit({ preventDefault: vi.fn() });
      r.dispose();
      r.reject();
      await request;
      expect(r.completed).not.toHaveBeenCalled();
      expect(r.close).not.toHaveBeenCalled();
      expect(component(r.render(), "Footer").props.error).toBe("");
    },
  );
  it.each(["event", "member", "period"] as const)(
    "freezes %s primary-save edits immediately, then preserves submitted values",
    async (kind) => {
      const r = pendingForm(kind),
        input = r.input(),
        request = r.render().props.onSubmit({ preventDefault: vi.fn() });
      input.props.onChange({ target: { value: "Newer unsaved value" } });
      expect(r.input().props).toMatchObject({
        value: "Original submitted value",
        readOnly: true,
      });
      if (kind === "event")
        expect(component(r.render(), "Toggle").props.disabled).toBe(true);
      if (kind === "member")
        expect(
          find(
            r.render(),
            (element) =>
              element.type === "button" &&
              element.props.className === "nx-chip",
          ).props.disabled,
        ).toBe(true);
      if (kind === "period")
        expect(
          find(
            r.render(),
            (element) =>
              element.type === "input" && element.props.type === "date",
          ).props.disabled,
        ).toBe(true);
      r.resolve();
      await request;
      expect(r.close).toHaveBeenCalledOnce();
    },
  );
  it.each(["event", "member"] as const)(
    "unlocks a failed %s primary save without losing the draft and permits retry",
    async (kind) => {
      const r = pendingForm(kind),
        request = r.render().props.onSubmit({ preventDefault: vi.fn() });
      r.reject();
      await request;
      expect(r.input().props).toMatchObject({
        value: "Original submitted value",
        readOnly: false,
      });
      expect(component(r.render(), "Footer").props.error).toBe(
        "Synthetic save failure",
      );
      r.input().props.onChange({ target: { value: "Repaired value" } });
      const retry = r.render().props.onSubmit({ preventDefault: vi.fn() });
      expect(r.mutate).toHaveBeenCalledTimes(2);
      expect(r.mutate.mock.calls[1][0]).toMatchObject(
        kind === "event"
          ? { entity: { title: "Repaired value" } }
          : { name: "Repaired value" },
      );
      r.resolve(1);
      await retry;
      expect(r.close).toHaveBeenCalledOnce();
    },
  );
  it.each(["event", "member"] as const)(
    "does not submit an idle canceled %s form through a retained callback",
    async (kind) => {
      const r = pendingForm(kind),
        form = r.render();
      component(r.outer(), "Sheet").props.onClose();
      const request = form.props.onSubmit({ preventDefault: vi.fn() });
      expect(r.close).toHaveBeenCalledOnce();
      expect(r.mutate).not.toHaveBeenCalled();
      await request;
    },
  );
  it.each(["event", "member"] as const)(
    "keeps a reopened %s request locked when an earlier session completes",
    async (kind) => {
      const r = pendingForm(kind),
        oldRequest = r.render().props.onSubmit({ preventDefault: vi.fn() });
      r.externallyClose();
      r.reopen();
      r.input().props.onChange({ target: { value: "New session value" } });
      const newRequest = r.render().props.onSubmit({ preventDefault: vi.fn() });
      expect(r.mutate).toHaveBeenCalledTimes(2);
      r.resolve();
      await oldRequest;
      expect(r.input().props).toMatchObject({
        value: "New session value",
        readOnly: true,
      });
      expect(r.completed).not.toHaveBeenCalled();
      expect(r.close).not.toHaveBeenCalled();
      r.resolve(1);
      await newRequest;
      expect(r.completed).toHaveBeenCalledOnce();
      expect(r.close).toHaveBeenCalledOnce();
    },
  );
  it.each(["event", "member"] as const)(
    "invalidates old %s dismissals and body identity when changing spaces",
    (kind) => {
      const r = pendingForm(kind),
        original = component(r.outer(), "Sheet"),
        oldBody = component(
          r.outer(),
          kind === "event" ? "EventFormBody" : "SimpleBody",
        );
      r.switchSpace();
      const nextBody = component(
        r.outer(),
        kind === "event" ? "EventFormBody" : "SimpleBody",
      );
      expect(nextBody.key).not.toBe(oldBody.key);
      original.props.onClose();
      expect(r.close).not.toHaveBeenCalled();
    },
  );
});


describe("Phone sheet refused dismissal", () => {
  it.each(["event", "member"] as const)(
    "restores the %s sheet position when a pending save refuses a swipe",
    async (kind) => {
      window.innerWidth = 400;
      const r = pendingForm(kind),
        request = r.render().props.onSubmit({ preventDefault: vi.fn() });
      const hooks = new test.Hooks(),
        tree = hooks.render(() =>
          Sheet(
            component(r.outer(), "Sheet").props as Parameters<typeof Sheet>[0],
          ),
        );
      const panel = find(tree, (element) => element.props.role === "dialog"),
        grabber = find(
          tree,
          (element) => element.props.className === "nx-grabber",
        );
      vi.mocked(animate).mockClear();
      grabber.props.onPan(null, { offset: { y: 600 } });
      expect(panel.props.style.y.set).toHaveBeenLastCalledWith(600);
      grabber.props.onPanEnd(null, { offset: { y: 600 }, velocity: { y: 0 } });
      expect(r.close).not.toHaveBeenCalled();
      expect(animate).toHaveBeenCalledWith(
        panel.props.style.y,
        0,
        expect.anything(),
      );
      r.reject();
      await request;
      expect(component(r.render(), "Footer").props.error).toBe(
        "Synthetic save failure",
      );
    },
  );
  it("also restores a pending roster picker after a refused swipe", () => {
    window.innerWidth = 400;
    const r = rosterPicker();
    r.option().props.onClick();
    r.submit().props.onClick();
    const hooks = new test.Hooks(),
      tree = hooks.render(() =>
        Sheet(
          component(r.render(), "Sheet").props as Parameters<typeof Sheet>[0],
        ),
      );
    const panel = find(tree, (element) => element.props.role === "dialog"),
      grabber = find(
        tree,
        (element) => element.props.className === "nx-grabber",
      );
    vi.mocked(animate).mockClear();
    grabber.props.onPanEnd(null, { offset: { y: 600 }, velocity: { y: 0 } });
    expect(r.close).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledWith(
      panel.props.style.y,
      0,
      expect.anything(),
    );
  });
  it.each([undefined, true])(
    "keeps accepted %s dismissal and short-swipe reset behavior",
    (accepted) => {
      window.innerWidth = 400;
      const hooks = new test.Hooks(),
        onClose = vi.fn().mockReturnValue(accepted),
        tree = hooks.render(() =>
          Sheet({ open: true, onClose, children: null }),
        );
      const panel = find(tree, (element) => element.props.role === "dialog"),
        grabber = find(
          tree,
          (element) => element.props.className === "nx-grabber",
        );
      vi.mocked(animate).mockClear();
      grabber.props.onPanEnd(null, { offset: { y: 10 }, velocity: { y: 0 } });
      expect(animate).toHaveBeenCalledWith(
        panel.props.style.y,
        0,
        expect.anything(),
      );
      expect(onClose).not.toHaveBeenCalled();
      vi.mocked(animate).mockClear();
      grabber.props.onPanEnd(null, { offset: { y: 600 }, velocity: { y: 0 } });
      expect(onClose).toHaveBeenCalledOnce();
      expect(animate).not.toHaveBeenCalled();
    },
  );
});

function pendingRecord() {
  const requests: { resolve: (s: unknown) => void; reject: (error: Error) => void }[] = []
  const mutate = vi.fn(() => new Promise((resolve, reject) => requests.push({ resolve, reject })))
  const r = record(mutate)
  return { ...r,
    resolve: (i = 0) => requests[i].resolve(fixture()),
    reject: (i = 0) => requests[i].reject(new Error('Old note request failed')),
    history: (tree = r.render()) => find(tree, el => el.props.className === 'nx-group-row link').props.onClick(),
    exclude: (tree = r.render()) => find(tree, el => el.props.className === 'nx-group-row link danger').props.onClick(),
  }
}

describe('Attendance note session lifetime', () => {
  it.each(['row', 'event', 'unmount'] as const)('does not run old History navigation after %s changes', async (mode) => {
    const r = pendingRecord()
    r.history()
    expect(r.mutate).toHaveBeenCalledOnce()
    if (mode === 'unmount') r.dispose()
    else r.changeContext(mode === 'event')
    r.resolve()
    await flush()
    expect(r.openMember).not.toHaveBeenCalled()
    expect(r.close).not.toHaveBeenCalled()
  })
  it.each([false, true])('does not show a previous note failure in the new record (new event=%s)', async (event) => {
    const r = pendingRecord()
    r.render().props.onClose()
    r.changeContext(event)
    r.reject()
    await flush()
    expect(find(r.render(), el => el.type === 'textarea').props.value).toBe('Existing next note')
    expect(() => find(r.render(), el => el.props.role === 'alert')).toThrow()
  })
  it('keeps the new record baseline when an older save resolves', async () => {
    const r = pendingRecord()
    r.render().props.onClose()
    r.changeContext()
    r.resolve()
    await flush()
    find(r.render(), el => el.type === 'textarea').props.onChange({ target: { value: 'Edited next note' } })
    r.render().props.onClose()
    expect(r.mutate.mock.calls[1][0]).toMatchObject({ memberID: 'next-member', note: 'Edited next note', expectedNote: 'Existing next note' })
    r.resolve(1)
    await flush()
  })
  it.each(['resolve', 'reject'] as const)('starts the new record request independently and does not unlock it when old request %ss', async (outcome) => {
    const r = pendingRecord()
    r.history()
    const changed = r.changeContext()
    expect(find(changed, el => el.type === 'textarea').props.disabled).toBe(false)
    find(changed, el => el.type === 'textarea').props.onChange({ target: { value: 'Edited next note' } })
    r.render().props.onClose()
    expect(r.mutate).toHaveBeenCalledTimes(2)
    r[outcome]()
    await flush()
    expect(find(r.render(), el => el.type === 'textarea').props.disabled).toBe(true)
    expect(r.close).not.toHaveBeenCalled()
    expect(r.openMember).not.toHaveBeenCalled()
    expect(() => find(r.render(), el => el.props.role === 'alert')).toThrow()
    r.resolve(1)
    await flush()
    expect(r.close).toHaveBeenCalledOnce()
  })
  it.each(['resolve', 'reject'] as const)('restores phone y while dirty-note dismissal is deferred, including %s', async (outcome) => {
    window.innerWidth = 400
    const r = pendingRecord(), hooks = new test.Hooks()
    const tree = hooks.render(() => Sheet(r.render().props as Parameters<typeof Sheet>[0]))
    const panel = find(tree, el => el.props.role === 'dialog')
    const grabber = find(tree, el => el.props.className === 'nx-grabber')
    vi.mocked(animate).mockClear()
    grabber.props.onPan(null, { offset: { y: 600 } })
    grabber.props.onPanEnd(null, { offset: { y: 600 }, velocity: { y: 0 } })
    expect(r.mutate).toHaveBeenCalledOnce()
    expect(r.close).not.toHaveBeenCalled()
    expect(animate).toHaveBeenCalledWith(panel.props.style.y, 0, expect.anything())
    r[outcome]()
    await flush()
    if (outcome === 'resolve') expect(r.close).toHaveBeenCalledOnce()
    else {
      expect(r.close).not.toHaveBeenCalled()
      expect(find(r.render(), el => el.type === 'textarea').props.value).toBe('Avisó')
    }
  })
  it('does not close the new record after already-requested note-plus-exclusion finishes', async () => {
    const r = pendingRecord()
    r.exclude()
    r.changeContext()
    r.resolve()
    await flush()
    expect(r.mutate).toHaveBeenCalledTimes(2)
    expect(r.mutate.mock.calls[1][0]).toMatchObject({ kind: 'inclusion', eventID: 'event', memberID: 'member', included: false })
    r.resolve(1)
    await flush()
    expect(r.close).not.toHaveBeenCalled()
  })
  it('preserves an explicitly requested compound exclusion after unmount', async () => {
    const r = pendingRecord()
    r.exclude()
    r.dispose()
    r.resolve()
    await flush()
    expect(r.mutate).toHaveBeenCalledTimes(2)
    expect(r.mutate.mock.calls[1][0]).toMatchObject({ kind: 'inclusion', memberID: 'member' })
    r.resolve(1)
    await flush()
  })
  it('saves and navigates normally within the original History session', async () => {
    const r = pendingRecord()
    r.history()
    r.resolve()
    await flush()
    expect(r.openMember).toHaveBeenCalledWith('member')
    expect(r.close).toHaveBeenCalledOnce()
  })
})


describe('Attendance note synchronous controls', () => {
  it('does not accept edits or discard a submitted note before rerender', async () => {
    const r = pendingRecord(), tree = r.render()
    expect(tree.props.onClose()).toBe(false)
    find(tree, el => el.type === 'textarea').props.onChange({ target: { value: 'Not submitted' } })
    find(tree, el => el.props.className === 'nx-button').props.onClick()
    expect(r.close).not.toHaveBeenCalled()
    r.reject()
    await flush()
    expect(find(r.render(), el => el.type === 'textarea').props.value).toBe('Avisó')
  })
  it('invalidates retained actions after an explicit discard', async () => {
    const r = pendingRecord(), tree = r.render()
    find(tree, el => el.props.className === 'nx-button').props.onClick()
    tree.props.onClose()
    r.history(tree)
    r.exclude(tree)
    find(tree, el => el.props.className === 'nx-record-mark absent').props.onClick()
    expect(r.close).toHaveBeenCalledOnce()
    expect(r.mutate).not.toHaveBeenCalled()
    expect(r.openMember).not.toHaveBeenCalled()
  })
  it('ignores old controls after switching rows', () => {
    const r = pendingRecord(), tree = r.render()
    r.changeContext()
    tree.props.onClose()
    r.history(tree)
    r.exclude(tree)
    find(tree, el => el.type === 'textarea').props.onChange({ target: { value: 'Old row edit' } })
    expect(r.close).not.toHaveBeenCalled()
    expect(r.mutate).not.toHaveBeenCalled()
    expect(find(r.render(), el => el.type === 'textarea').props.value).toBe('Existing next note')
  })
  it('keeps clean phone dismissal synchronous without a competing reset', () => {
    window.innerWidth = 400
    const r = pendingRecord(), hooks = new test.Hooks()
    find(r.render(), el => el.type === 'textarea').props.onChange({ target: { value: '' } })
    const tree = hooks.render(() => Sheet(r.render().props as Parameters<typeof Sheet>[0]))
    const grabber = find(tree, el => el.props.className === 'nx-grabber')
    vi.mocked(animate).mockClear()
    grabber.props.onPanEnd(null, { offset: { y: 600 }, velocity: { y: 0 } })
    expect(r.close).toHaveBeenCalledOnce()
    expect(r.mutate).not.toHaveBeenCalled()
    expect(animate).not.toHaveBeenCalled()
  })
})

describe('Attendance note retained event exit', () => {
  it('does not navigate from an exiting event body before its animation unmounts', async () => {
    const r = pendingRecord()
    r.history()
    // App's event-keyed AnimatePresence retains the old event body with old props,
    // but its Motion presence context becomes false as the selection changes.
    test.present = false
    r.render()
    r.resolve()
    await flush()
    expect(r.openMember).not.toHaveBeenCalled()
    expect(r.close).not.toHaveBeenCalled()
  })
  it('preserves inclusion but skips stale UI close in the retained exit body', async () => {
    const r = pendingRecord()
    r.exclude()
    test.present = false
    r.render()
    r.resolve()
    await flush()
    expect(r.mutate).toHaveBeenCalledTimes(2)
    r.resolve(1)
    await flush()
    expect(r.close).not.toHaveBeenCalled()
  })
})


describe('Attendance note retained exit errors and re-entry', () => {
  it('does not set the exiting record error after an old note rejection', async () => {
    const r = pendingRecord()
    r.history()
    test.present = false
    r.render()
    r.reject()
    await flush()
    expect(() => find(r.render(), el => el.props.role === 'alert')).toThrow()
    expect(r.close).not.toHaveBeenCalled()
    expect(r.openMember).not.toHaveBeenCalled()
  })
  it.each(['resolve', 'reject'] as const)('starts a distinct session after exit reversal and ignores old %s', async (outcome) => {
    const r = pendingRecord()
    r.history()
    test.present = false
    r.render()
    test.present = true
    const reopened = r.render()
    expect(find(reopened, el => el.type === 'textarea').props.disabled).toBe(false)
    find(reopened, el => el.type === 'textarea').props.onChange({ target: { value: 'New session note' } })
    r.render().props.onClose()
    expect(r.mutate).toHaveBeenCalledTimes(2)
    r[outcome]()
    await flush()
    expect(find(r.render(), el => el.type === 'textarea').props.disabled).toBe(true)
    expect(r.close).not.toHaveBeenCalled()
    expect(r.openMember).not.toHaveBeenCalled()
    expect(() => find(r.render(), el => el.props.role === 'alert')).toThrow()
    r.resolve(1)
    await flush()
    expect(r.close).toHaveBeenCalledOnce()
    expect(r.openMember).not.toHaveBeenCalled()
  })
})

describe('Drive interface localization', () => {
  const space = (key = 'template:synthetic') => ({
    organizationID: 'org', folderID: 'synthetic-folder', pending: 0, canEdit: true, error: '',
    conflicts: [{ key, versions: [{ id: 'synthetic-version', device: 'Synthetic Mac', date: '2026-10-24T12:00:00Z', summary: 'Synthetic template' }] }],
  })
  it('shows English while connecting rather than leaking a Spanish pending label', async () => {
    let resolve!: () => void
    const runDrive = vi.fn(() => new Promise<void>(done => { resolve = done }))
    const context = { drive: { ...emptyDrive, configured: true }, driveBusy: false, runDrive }
    test.context = context
    const hooks = new test.Hooks(), render = () => hooks.render(() => DrivePanel({ orgID: 'org' }))
    const button = (tree: unknown) => find(tree, el => el.type === 'button' && el.props.className === 'button primary')
    expect(button(render()).props.children).toContain('Connect Google')
    button(render()).props.onClick()
    context.driveBusy = true
    const pending = button(render())
    expect(pending.props.children).toContain('Connecting…')
    expect(pending.props.disabled).toBe(true)
    expect(runDrive).toHaveBeenCalledExactlyOnceWith('driveConnect', {})
    resolve()
    await flush()
  })
  it('shows English while preparing a synthetic conflict preview', async () => {
    let resolve!: (value: unknown) => void
    test.bridge.mockImplementation(() => new Promise(done => { resolve = done }))
    test.context = { drive: { ...emptyDrive, configured: true, connected: true, spaces: [space()] }, driveBusy: false, notify: vi.fn() }
    const panelHooks = new test.Hooks(), previewHooks = new test.Hooks()
    const preview = component(panelHooks.render(() => DrivePanel({ orgID: 'org' })), 'VersionPreview')
    const render = () => previewHooks.render(() => invoke(preview))
    const button = (tree: unknown) => find(tree, el => el.type === 'button')
    expect(button(render()).props.children).toContain('View template')
    button(render()).props.onClick()
    expect(button(render()).props.children).toContain('Preparing…')
    expect(button(render()).props.disabled).toBe(true)
    expect(test.bridge).toHaveBeenCalledExactlyOnceWith({ command: 'drivePreviewTemplate', organizationID: 'org', key: 'template:synthetic', versionID: 'synthetic-version' })
    resolve({ token: 'synthetic-preview', pageCount: 1, image: 'synthetic-image' })
    await flush()
    expect(find(render(), el => el.type === 'img').props.alt).toBe('Template, page 1')
  })
  it('translates the fallback conflict heading without changing user content', () => {
    test.context = { drive: { ...emptyDrive, connected: true, spaces: [space('unknown:synthetic')] }, driveBusy: false }
    const hooks = new test.Hooks(), tree = hooks.render(() => DrivePanel({ orgID: 'org' }))
    expect(find(tree, el => el.type === 'h4').props.children).toBe('Record')
    expect(find(tree, el => el.type === 'p' && el.props.children === 'Synthetic template').props.children).toBe('Synthetic template')
  })
})

function versionPreview() {
  const space = {
    organizationID: 'org', folderID: 'synthetic-folder', pending: 0, canEdit: true, error: '',
    conflicts: [{ key: 'template:synthetic', versions: [{ id: 'synthetic-version', device: 'Synthetic Mac', date: '2026-10-24T12:00:00Z', summary: 'Synthetic template' }] }],
  }
  const notify = vi.fn()
  const runDrive = vi.fn(async () => { space.conflicts = [] })
  test.context = { drive: { ...emptyDrive, configured: true, connected: true, spaces: [space] }, driveBusy: false, notify, runDrive }
  const requests: { command: string; resolve: (value: unknown) => void; reject: (error: Error) => void }[] = []
  test.bridge.mockImplementation(({ command }) => new Promise((resolve, reject) => requests.push({ command, resolve, reject })))
  const panelHooks = new test.Hooks(), previewHooks = new test.Hooks()
  const panel = () => panelHooks.render(() => DrivePanel({ orgID: 'org' }))
  const preview = component(panel(), 'VersionPreview')
  const render = () => previewHooks.render(() => invoke(preview))
  return { notify, runDrive, requests, render, panel,
    start: () => find(render(), el => el.type === 'button'),
    next: () => find(render(), el => el.props['aria-label'] === tr('Página siguiente')),
    resolve: (i: number, value: unknown) => requests[i].resolve(value),
    reject: (i: number) => requests[i].reject(new Error('Synthetic old preview failure')),
    resolveConflict: async () => {
      find(panel(), el => el.type === 'button' && Array.isArray(el.props.children) && el.props.children.includes(tr('Usar esta versión'))).props.onClick()
      await flush()
      expect(() => component(panel(), 'VersionPreview')).toThrow()
      previewHooks.dispose()
    },
  }
}

describe('Drive conflict preview lifecycle', () => {
  it.each(['resolve', 'reject'] as const)('does not let a duplicate initial preview %s rewind or erase a later page', async (outcome) => {
    const r = versionPreview(), button = r.start()
    button.props.onClick()
    button.props.onClick()
    r.resolve(0, { token: 'first-token', pageCount: 3, image: 'page-1' })
    await flush()
    r.next().props.onClick()
    const pageRequest = r.requests.length - 1
    r.resolve(pageRequest, { image: 'page-2' })
    await flush()
    // A synchronous guard may avoid request 1 entirely; otherwise it must not
    // replace the newer successful page or report an obsolete request error.
    if (r.requests[1].command === 'drivePreviewTemplate') {
      if (outcome === 'resolve') r.resolve(1, { token: 'late-token', pageCount: 3, image: 'page-1' })
      else r.reject(1)
      await flush()
    }
    expect(find(r.render(), el => el.type === 'img').props).toMatchObject({ src: 'page-2', alt: tr('Plantilla, página {0}', 2) })
    expect(r.notify).not.toHaveBeenCalled()
  })
  it('does not notify an obsolete preview error after the user resolves the conflict', async () => {
    const r = versionPreview()
    r.start().props.onClick()
    await r.resolveConflict()
    expect(r.runDrive).toHaveBeenCalledWith('driveResolve', { organizationID: 'org', key: 'template:synthetic', versionID: 'synthetic-version' })
    r.reject(0)
    await flush()
    expect(r.notify).not.toHaveBeenCalled()
  })
  it('does not notify an old page error after the conflict preview is removed', async () => {
    const r = versionPreview()
    r.start().props.onClick()
    r.resolve(0, { token: 'token', pageCount: 3, image: 'page-1' })
    await flush()
    r.next().props.onClick()
    await r.resolveConflict()
    r.reject(1)
    await flush()
    expect(r.notify).not.toHaveBeenCalled()
  })
  it('does not notify from a retained preview after its Settings sheet starts exiting', async () => {
    const r = versionPreview()
    r.start().props.onClick()
    test.present = false
    r.render()
    r.reject(0)
    await flush()
    expect(r.notify).not.toHaveBeenCalled()
  })
  it('reports a current failure and permits a retry', async () => {
    const r = versionPreview()
    r.start().props.onClick()
    r.reject(0)
    await flush()
    expect(r.notify).toHaveBeenCalledExactlyOnceWith('Synthetic old preview failure', true)
    expect(r.start().props.disabled).toBe(false)
    r.start().props.onClick()
    r.resolve(1, { token: 'retry-token', pageCount: 1, image: 'retry-image' })
    await flush()
    expect(find(r.render(), el => el.type === 'img').props.src).toBe('retry-image')
  })
  it('renders normal page image and number together', async () => {
    const r = versionPreview()
    r.start().props.onClick()
    r.resolve(0, { token: 'token', pageCount: 3, image: 'page-1' })
    await flush()
    r.next().props.onClick()
    r.resolve(1, { image: 'page-2' })
    await flush()
    expect(find(r.render(), el => el.type === 'img').props).toMatchObject({ src: 'page-2', alt: tr('Plantilla, página {0}', 2) })
  })
})

describe('Drive preview request isolation', () => {
  it('shares a synchronous lock across repeated page callbacks', async () => {
    const r = versionPreview()
    r.start().props.onClick()
    r.resolve(0, { token: 'token', pageCount: 3, image: 'page-1' })
    await flush()
    const next = r.next()
    next.props.onClick()
    next.props.onClick()
    expect(r.requests).toHaveLength(2)
    r.resolve(1, { image: 'page-2' })
    await flush()
    expect(find(r.render(), el => el.type === 'img').props).toMatchObject({ src: 'page-2', alt: tr('Plantilla, página {0}', 2) })
  })
  it.each(['resolve', 'reject'] as const)('does not revive an old preview or unlock a new one after exit reversal and old %s', async (outcome) => {
    const r = versionPreview()
    r.start().props.onClick()
    test.present = false
    r.render()
    test.present = true
    expect(r.start().props.disabled).toBe(false)
    r.start().props.onClick()
    expect(r.requests).toHaveLength(2)
    if (outcome === 'resolve') r.resolve(0, { token: 'old-token', pageCount: 3, image: 'old-image' })
    else r.reject(0)
    await flush()
    expect(r.start().props.disabled).toBe(true)
    expect(r.notify).not.toHaveBeenCalled()
    r.resolve(1, { token: 'new-token', pageCount: 1, image: 'new-image' })
    await flush()
    expect(find(r.render(), el => el.type === 'img').props.src).toBe('new-image')
  })
  it('ignores retained preview callbacks after the conflict is removed', async () => {
    const r = versionPreview(), start = r.start()
    await r.resolveConflict()
    start.props.onClick()
    expect(test.bridge).not.toHaveBeenCalled()
  })
  it('keeps disabled pagination boundaries from requesting nonexistent pages', async () => {
    const r = versionPreview()
    r.start().props.onClick()
    r.resolve(0, { token: 'token', pageCount: 2, image: 'page-1' })
    await flush()
    const previous = find(r.render(), el => el.props['aria-label'] === tr('Página anterior'))
    expect(previous.props.disabled).toBe(true)
    previous.props.onClick()
    expect(r.requests).toHaveLength(1)
    r.next().props.onClick()
    r.resolve(1, { image: 'page-2' })
    await flush()
    const next = r.next()
    expect(next.props.disabled).toBe(true)
    next.props.onClick()
    expect(r.requests).toHaveLength(2)
  })
})

describe('Drive conflict opposite page callbacks', () => {
  it('does not let an older page response replace a newer accepted destination', async () => {
    const r = versionPreview()
    r.start().props.onClick()
    r.resolve(0, { token: 'token', pageCount: 3, image: 'page-1' })
    await flush()
    r.next().props.onClick()
    r.resolve(1, { image: 'page-2' })
    await flush()
    const middle = r.render()
    find(middle, el => el.props['aria-label'] === tr('Página anterior')).props.onClick()
    find(middle, el => el.props['aria-label'] === tr('Página siguiente')).props.onClick()
    const acceptedBoth = r.requests.length === 4
    if (acceptedBoth) { r.resolve(3, { image: 'page-3' }); await flush() }
    r.resolve(2, { image: 'page-1' })
    await flush()
    expect(find(r.render(), el => el.type === 'img').props).toMatchObject({
      src: acceptedBoth ? 'page-3' : 'page-1',
      alt: tr('Plantilla, página {0}', acceptedBoth ? 3 : 1),
    })
  })
})


describe('Space removal localization', () => {
  it.each(['resolve', 'reject'] as const)('keeps pending removal in English without translating user data on %s', async (outcome) => {
    const snapshot = fixture()
    snapshot.organizations[0].name = 'Conectando…'
    let resolve!: (value: unknown) => void, reject!: (error: Error) => void
    const mutate = vi.fn(() => new Promise((done, fail) => { resolve = done; reject = fail }))
    const changed = vi.fn(), notify = vi.fn()
    test.context = { snapshot, demo: true, busy: false, driveBusy: false, drive: emptyDrive, mutate, notify }
    const hooks = new test.Hooks()
    const render = () => hooks.render(() => SpaceManager({ close: vi.fn(), open: vi.fn(), create: vi.fn(), changed }))
    find(render(), el => el.props.className === 'icon-button space-delete').props.onClick()
    const button = () => find(render(), el => el.props.className === 'button danger-fill')
    expect(button().props.children).toBe('Move to Trash')
    button().props.onClick()
    expect(button().props.children).toBe('Deleting…')
    expect(button().props.disabled).toBe(true)
    expect(mutate).toHaveBeenCalledExactlyOnceWith({ kind: 'setOrganizationDeleted', organizationID: 'org', deleted: true, expectedDeleted: false, expectedName: 'Conectando…' })
    if (outcome === 'resolve') {
      resolve(snapshot)
      await flush()
      expect(changed).toHaveBeenCalledExactlyOnceWith('org', true)
      expect(notify).toHaveBeenCalledWith('Space moved to Trash', false, expect.any(Function))
    } else {
      reject(new Error('Conectando…'))
      await flush()
      expect(button().props.children).toBe('Move to Trash')
      expect(button().props.disabled).toBe(false)
      expect(find(render(), el => el.type === 'h3').props.children).toBe('Conectando…')
      expect(find(render(), el => el.props.role === 'alert').props.children).toBe('Conectando…')
      expect(changed).not.toHaveBeenCalled()
    }
  })
})
