import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addComponent,
  addPeriod,
  addPerson,
  chooseVolunteer,
  combineVolunteerSelection,
  createEncounter,
  createSpace,
  finishVolunteer,
  registerVolunteer,
} from './commands.ts'
import { DomainError } from './errors.ts'
import { emptyWorkspace, type Workspace } from './model.ts'
import { readImport } from './store.ts'
import { suggestVolunteers } from './volunteers.ts'

const PERIOD = '2026-01-01T00:00:00.000Z'
const PERIOD_END = '2027-01-01T00:00:00.000Z'
const SPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const PERIOD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const COMPONENT = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const CURRENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const FIRST = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
const SECOND = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'
const ZERO = '00000000-0000-4000-8000-000000000001'
const EARLY = '00000000-0000-4000-8000-000000000002'
const LATE = '00000000-0000-4000-8000-000000000003'
const TWICE = '00000000-0000-4000-8000-000000000004'

function workspace(): Workspace {
  let next = createSpace(emptyWorkspace(), { id: SPACE, name: 'Espacio sintético', timeZone: 'Etc/UTC' })
  next = addPeriod(next, { id: PERIOD_ID, spaceId: SPACE, name: 'Período sintético', startsAt: PERIOD, endsAt: PERIOD_END })
  next = addComponent(next, { id: COMPONENT, spaceId: SPACE, name: 'Componente sintético' })
  for (const [id, name] of [
    [ZERO, 'Persona Cero'],
    [EARLY, 'Persona Temprana'],
    [LATE, 'Persona Tardía'],
    [TWICE, 'Persona Doble'],
  ] as const) {
    next = addPerson(next, { id, spaceId: SPACE, name })
  }
  next = createEncounter(next, {
    id: FIRST,
    spaceId: SPACE,
    title: 'Primera participación',
    startsAt: '2026-02-01T00:00:00.000Z',
    componentId: COMPONENT,
    volunteerCapacity: 4,
  })
  next = createEncounter(next, {
    id: SECOND,
    spaceId: SPACE,
    title: 'Segunda participación',
    startsAt: '2026-03-01T00:00:00.000Z',
    componentId: COMPONENT,
    volunteerCapacity: 4,
  })
  next = createEncounter(next, {
    id: CURRENT,
    spaceId: SPACE,
    title: 'Encuentro actual',
    startsAt: '2026-04-01T00:00:00.000Z',
    componentId: COMPONENT,
    volunteerCapacity: 1,
  })
  return next
}

function register(next: Workspace, encounterId: string, personId: string, registeredAt: string): Workspace {
  return registerVolunteer(next, { encounterId, personId, registeredAt })
}

function complete(next: Workspace, encounterId: string, personId: string, registeredAt: string): Workspace {
  next = register(next, encounterId, personId, registeredAt)
  next = chooseVolunteer(next, encounterId, personId)
  return finishVolunteer(next, encounterId, personId, true)
}

test('suggestions use previous completed participation and stable tie breaks', () => {
  let next = workspace()
  next = complete(next, FIRST, EARLY, '2026-01-02T00:00:00.000Z')
  next = complete(next, FIRST, TWICE, '2026-01-02T00:00:00.000Z')
  next = complete(next, SECOND, LATE, '2026-01-03T00:00:00.000Z')
  next = complete(next, SECOND, TWICE, '2026-01-03T00:00:00.000Z')
  const untouched = structuredClone(next)
  for (const personId of [ZERO, EARLY, LATE, TWICE]) {
    next = register(next, CURRENT, personId, '2026-01-10T00:00:00.000Z')
  }
  const ordered = suggestVolunteers(next, CURRENT, PERIOD_ID).map((item) => item.personId)
  assert.deepEqual(ordered, [ZERO, EARLY, LATE, TWICE])
  assert.deepEqual(
    untouched.volunteers.map((item) => item.status),
    next.volunteers.filter((item) => item.encounterId !== CURRENT).map((item) => item.status),
  )
  assert.ok(next.volunteers.filter((item) => item.encounterId === CURRENT).every((item) => item.status === 'interested'))
})

test('equal histories break ties by registration time and then by id', () => {
  let next = workspace()
  const same = '2026-01-10T00:00:00.000Z'
  next = register(next, CURRENT, LATE, same)
  next = register(next, CURRENT, EARLY, same)
  next = register(next, CURRENT, ZERO, '2026-01-09T00:00:00.000Z')
  assert.deepEqual(suggestVolunteers(next, CURRENT, PERIOD_ID).map((item) => item.personId), [ZERO, EARLY, LATE])
})

test('capacity is enforced by selection and by import or combine', () => {
  let next = workspace()
  next = register(next, CURRENT, ZERO, '2026-01-10T00:00:00.000Z')
  next = register(next, CURRENT, EARLY, '2026-01-11T00:00:00.000Z')
  const selected = chooseVolunteer(next, CURRENT, ZERO)
  assert.equal(selected.volunteers.find((item) => item.personId === ZERO && item.encounterId === CURRENT)?.status, 'selected')
  assert.throws(
    () => chooseVolunteer(selected, CURRENT, EARLY),
    (error: unknown) => error instanceof DomainError && error.code === 'capacity-exceeded',
  )
  assert.equal(
    selected.volunteers.find((item) => item.personId === EARLY && item.encounterId === CURRENT)?.status,
    'interested',
  )
  assert.throws(
    () => combineVolunteerSelection(next, CURRENT, [ZERO, EARLY]),
    (error: unknown) => error instanceof DomainError && error.code === 'capacity-exceeded',
  )
  assert.ok(next.volunteers.filter((item) => item.encounterId === CURRENT).every((item) => item.status === 'interested'))
  const overloaded = structuredClone(selected)
  const early = overloaded.volunteers.find((item) => item.personId === EARLY && item.encounterId === CURRENT)
  if (!early) throw new Error('missing volunteer')
  early.status = 'selected'
  const raw = `${JSON.stringify(overloaded)}\n`
  assert.throws(
    () => readImport(raw),
    (error: unknown) => error instanceof DomainError && error.code === 'capacity-exceeded',
  )
})
