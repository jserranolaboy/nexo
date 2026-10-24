import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attendanceRate } from './attendance.ts'
import {
  addComponent,
  addMembership,
  addPeriod,
  addPerson,
  createEncounter,
  createSpace,
  duplicateEncounter,
  membershipIncludes,
  setAttendance,
} from './commands.ts'
import { DomainError } from './errors.ts'
import { emptyWorkspace, type Workspace } from './model.ts'

const START = '2026-01-01T00:00:00.000Z'
const END = '2026-07-01T00:00:00.000Z'
const INSIDE = '2026-03-01T12:00:00.000Z'
const SPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const PERIOD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const PERSON = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const OTHER = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
const COMPONENT = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const ENCOUNTER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'

function base(): Workspace {
  let workspace = emptyWorkspace()
  workspace = createSpace(workspace, { id: SPACE, name: 'Espacio sintético', timeZone: 'Etc/UTC' })
  workspace = addPeriod(workspace, { id: PERIOD, spaceId: SPACE, name: 'Período sintético', startsAt: START, endsAt: END })
  workspace = addPerson(workspace, { id: PERSON, spaceId: SPACE, name: 'Persona Alfa' })
  workspace = addPerson(workspace, { id: OTHER, spaceId: SPACE, name: 'Persona Beta' })
  workspace = addComponent(workspace, { id: COMPONENT, spaceId: SPACE, name: 'Componente sintético' })
  return workspace
}

function withEncounter(workspace: Workspace, personIds: string[] = [PERSON]): Workspace {
  return createEncounter(workspace, {
    id: ENCOUNTER,
    spaceId: SPACE,
    title: 'Encuentro sintético',
    startsAt: INSIDE,
    componentId: COMPONENT,
    personIds,
  })
}

test('attendance rate counts present over present plus absent', () => {
  let workspace = withEncounter(base(), [PERSON])
  workspace = setAttendance(workspace, {
    encounterId: ENCOUNTER,
    personId: PERSON,
    status: 'present',
    recordedAt: INSIDE,
  })
  const second = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
  workspace = createEncounter(workspace, {
    id: second,
    spaceId: SPACE,
    title: 'Segundo encuentro',
    startsAt: '2026-04-01T12:00:00.000Z',
    componentId: COMPONENT,
    personIds: [PERSON],
  })
  workspace = setAttendance(workspace, {
    encounterId: second,
    personId: PERSON,
    status: 'absent',
    recordedAt: INSIDE,
  })
  const rate = attendanceRate(workspace, PERSON, PERIOD)
  assert.equal(rate.present, 1)
  assert.equal(rate.absent, 1)
  assert.equal(rate.ratio, 0.5)
})

test('pending, excused, voided, cancelled, and non-counting rows stay out of the rate', () => {
  let workspace = withEncounter(base())
  workspace = setAttendance(workspace, { encounterId: ENCOUNTER, personId: PERSON, status: 'pending', recordedAt: INSIDE })
  const excusedId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'
  workspace = createEncounter(workspace, {
    id: excusedId,
    spaceId: SPACE,
    title: 'Excusa',
    startsAt: '2026-04-02T12:00:00.000Z',
    componentId: COMPONENT,
    personIds: [PERSON],
  })
  workspace = setAttendance(workspace, { encounterId: excusedId, personId: PERSON, status: 'excused', recordedAt: INSIDE })
  const voided = structuredClone(workspace)
  voided.attendance[0].voided = true
  voided.attendance[0].status = 'absent'
  const cancelled = structuredClone(workspace)
  cancelled.encounters[0].cancelled = true
  cancelled.attendance[0].status = 'absent'
  const uncounted = structuredClone(workspace)
  uncounted.attendance[0].countsAttendance = false
  uncounted.attendance[0].status = 'absent'
  for (const sample of [workspace, voided, cancelled, uncounted]) {
    const rate = attendanceRate(sample, PERSON, PERIOD)
    assert.equal(rate.counted, 0)
    assert.equal(rate.ratio, null)
  }
  assert.equal(attendanceRate(workspace, PERSON, PERIOD).pending, 1)
  assert.equal(attendanceRate(workspace, PERSON, PERIOD).excused, 1)
})

test('a person who is not on the roster does not receive an absence', () => {
  const workspace = withEncounter(base(), [PERSON])
  assert.equal(workspace.attendance.some((row) => row.personId === OTHER), false)
  const rate = attendanceRate(workspace, OTHER, PERIOD)
  assert.deepEqual(rate, { present: 0, absent: 0, excused: 0, pending: 0, counted: 0, ratio: null })
  assert.throws(
    () => setAttendance(workspace, { encounterId: ENCOUNTER, personId: OTHER, status: 'absent', recordedAt: INSIDE }),
    (error: unknown) => error instanceof DomainError && error.code === 'not-on-roster',
  )
})

test('periods include the start instant and exclude the end instant', () => {
  const workspace = withEncounter(base(), [PERSON])
  const atStart = structuredClone(workspace)
  atStart.encounters[0].startsAt = START
  atStart.attendance[0].eventInstant = START
  atStart.attendance[0].status = 'present'
  const atEnd = structuredClone(workspace)
  atEnd.encounters[0].startsAt = END
  atEnd.attendance[0].eventInstant = END
  atEnd.attendance[0].status = 'present'
  assert.equal(attendanceRate(atStart, PERSON, PERIOD).ratio, 1)
  assert.equal(attendanceRate(atEnd, PERSON, PERIOD).ratio, null)
  assert.throws(
    () =>
      addPeriod(createSpace(emptyWorkspace(), { id: SPACE, name: 'Espacio sintético', timeZone: 'Etc/UTC' }), {
        spaceId: SPACE,
        name: 'Vacío',
        startsAt: START,
        endsAt: START,
      }),
    (error: unknown) => error instanceof DomainError && error.code === 'invalid-period',
  )
})

test('the recorded timezone does not move stored instants', () => {
  const utc = createSpace(emptyWorkspace(), { name: 'Uno', timeZone: 'Etc/UTC' })
  const other = createSpace(emptyWorkspace(), { name: 'Dos', timeZone: 'Pacific/Honolulu' })
  assert.equal(utc.spaces[0].timeZone, 'Etc/UTC')
  assert.equal(other.spaces[0].timeZone, 'Pacific/Honolulu')
  assert.equal(new Date(INSIDE).toISOString(), INSIDE)
})

test('duplicating an encounter and its roster is one snapshot and creates pending rows', () => {
  let workspace = withEncounter(base(), [PERSON, OTHER])
  workspace = setAttendance(workspace, {
    encounterId: ENCOUNTER,
    personId: PERSON,
    status: 'present',
    note: 'nota que no se copia',
    recordedAt: INSIDE,
  })
  const other = workspace.attendance.find((row) => row.personId === OTHER)
  if (!other) throw new Error('missing synthetic roster row')
  other.voided = true
  other.status = 'absent'
  const before = structuredClone(workspace)
  const copyId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9'
  const next = duplicateEncounter(workspace, {
    sourceId: ENCOUNTER,
    id: copyId,
    startsAt: '2026-03-08T12:00:00.000Z',
  })
  assert.equal(workspace.revision, before.revision)
  assert.equal(workspace.attendance[0].status, 'present')
  const copied = next.attendance.filter((row) => row.encounterId === copyId)
  assert.equal(copied.length, 1)
  assert.equal(copied[0].personId, PERSON)
  assert.ok(copied.every((row) => row.status === 'pending' && row.note === '' && row.recordedAt === null))
  assert.equal(next.attendance.find((row) => row.encounterId === ENCOUNTER && row.personId === PERSON)?.note, 'nota que no se copia')
  assert.equal(next.encounters.find((item) => item.id === ENCOUNTER)?.cancelled, false)
})

test('group membership is half-open', () => {
  const group = 'ffffffff-ffff-4fff-8fff-fffffffffff1'
  let workspace = base()
  workspace = addMembership(
    { ...workspace, groups: [...workspace.groups, { id: group, spaceId: SPACE, name: 'Grupo sintético' }] },
    { personId: PERSON, groupId: group, startsAt: START, endsAt: END },
  )
  assert.equal(membershipIncludes(START, END, START), true)
  assert.equal(membershipIncludes(START, END, END), false)
  assert.equal(membershipIncludes(START, null, '2026-12-31T00:00:00.000Z'), true)
})
