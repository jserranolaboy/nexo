import { describe, expect, it } from 'vitest'
import {
  attendanceResult,
  emptySnapshot,
  fitTemplateToPage,
  newTemplate,
  id,
  simulateAction,
  volunteerOrder,
  nextWholeHour,
} from './domain'
import { makeDemo } from './demo'
import type { Activity, Attendance, Period, Snapshot } from './domain'
const orgID = 'ORG',
  memberID = 'ANA',
  componentID = 'SERVICE'
const period: Period = {
  id: 'SEMESTER',
  organizationID: orgID,
  name: 'Semestre',
  startsAt: '2026-07-01T00:00:00Z',
  endsAt: '2027-01-01T00:00:00Z',
}
const event = (id: string, date = '2026-10-01T12:00:00Z'): Activity => ({
  id,
  organizationID: orgID,
  componentID,
  categoryID: 'CLINIC',
  title: id,
  startsAt: date,
  countsAttendance: true,
  isCancelled: false,
  volunteerCapacity: 1,
})
const row = (eventID: string, status: Attendance['status']): Attendance => ({
  id: eventID,
  eventID,
  memberID,
  status,
  isVoided: false,
  note: '',
})
function fixture(): Snapshot {
  const s = emptySnapshot()
  s.members = [
    { id: memberID, organizationID: orgID, name: 'Ana', isActive: true },
    { id: 'BEA', organizationID: orgID, name: 'Bea', isActive: true },
  ]
  return s
}
describe('individual attendance and historical scope', () => {
  it('excludes excused, pending, cancelled, voided, and events outside the period', () => {
    const s = fixture()
    s.events = ['p1', 'p2', 'absent', 'excused', 'pending', 'voided', 'cancelled', 'outside'].map(
      (v) => event(v),
    )
    s.events[6].isCancelled = true
    s.events[7].startsAt = period.endsAt
    s.attendance = [
      row('p1', 'present'),
      row('p2', 'present'),
      row('absent', 'absent'),
      row('excused', 'excused'),
      row('pending', 'pending'),
      { ...row('voided', 'absent'), isVoided: true },
      row('cancelled', 'absent'),
      row('outside', 'absent'),
    ]
    expect(attendanceResult(s, memberID, period)).toMatchObject({
      present: 2,
      absent: 1,
      excused: 1,
      pending: 1,
      total: 3,
      percentage: 67,
    })
  })
  it('keeps recorded component and date when the event changes', () => {
    const s = fixture()
    s.events = [{ ...event('A'), componentID: 'NEW', startsAt: '2027-02-01T00:00:00Z' }]
    s.attendance = [
      {
        ...row('A', 'present'),
        componentIDSnapshot: componentID,
        eventDateSnapshot: '2026-10-01T00:00:00Z',
      },
    ]
    expect(attendanceResult(s, memberID, period, componentID).percentage).toBe(100)
    expect(attendanceResult(s, memberID, period, 'NEW').percentage).toBeNull()
  })
  it('shows no percentage when all entries are excused or pending', () => {
    const s = fixture()
    s.events = [event('A')]
    s.attendance = [row('A', 'excused')]
    expect(attendanceResult(s, memberID, period).percentage).toBeNull()
  })
})
describe('volunteer suggestion and simulation isolation', () => {
  it('prioritizes fewer completed participations in the same category without selecting anyone', () => {
    const s = fixture(),
      current = event('CURRENT', '2026-11-01T00:00:00Z')
    s.events = [current, event('PRIOR'), { ...event('OTHER'), categoryID: 'OTHER_CATEGORY' }]
    s.volunteers = [
      {
        id: '1',
        eventID: current.id,
        memberID,
        status: 'interested',
        registeredAt: '2026-10-03T00:00:00Z',
      },
      {
        id: '2',
        eventID: current.id,
        memberID: 'BEA',
        status: 'interested',
        registeredAt: '2026-10-04T00:00:00Z',
      },
      {
        id: '3',
        eventID: 'PRIOR',
        memberID,
        status: 'completed',
        registeredAt: '2026-09-01T00:00:00Z',
      },
      {
        id: '4',
        eventID: 'OTHER',
        memberID: 'BEA',
        status: 'completed',
        registeredAt: '2026-09-01T00:00:00Z',
      },
    ]
    const before = JSON.stringify(s)
    expect(volunteerOrder(s, current, period).map((v) => v.memberID)).toEqual(['BEA', memberID])
    expect(JSON.stringify(s)).toBe(before)
    expect(volunteerOrder(s, current, { ...period, organizationID: 'OTHER' })).toEqual([])
  })
  it('counts completed people against capacity and leaves the previous snapshot intact on failure', () => {
    const s = fixture()
    s.events = [event('A')]
    s.volunteers = [
      {
        id: '1',
        eventID: 'A',
        memberID,
        status: 'completed',
        registeredAt: '2026-10-03T00:00:00Z',
      },
      {
        id: '2',
        eventID: 'A',
        memberID: 'BEA',
        status: 'interested',
        registeredAt: '2026-10-03T00:00:00Z',
      },
    ]
    const before = JSON.stringify(s)
    expect(() =>
      simulateAction(s, { kind: 'volunteer', eventID: 'A', memberID: 'BEA', status: 'selected' }),
    ).toThrow('cupos')
    expect(JSON.stringify(s)).toBe(before)
  })
  it('restores an excluded entry without resetting its status or note', () => {
    const s = fixture()
    s.events = [event('A')]
    s.attendance = [{ ...row('A', 'excused'), note: 'Avisó' }]
    const excluded = simulateAction(s, {
      kind: 'inclusion',
      eventID: 'A',
      memberID,
      included: false,
    })
    const restored = simulateAction(excluded, {
      kind: 'inclusion',
      eventID: 'A',
      memberID,
      included: true,
    })
    expect(restored.attendance[0]).toMatchObject({
      status: 'excused',
      note: 'Avisó',
      isVoided: false,
    })
    expect(s.revision).toBe(0)
  })
  it('produces native-compatible UUIDs without requiring a secure web origin', () => {
    expect(id()).toMatch(/^[A-F0-9]{8}-[A-F0-9]{4}-4[A-F0-9]{3}-[89AB][A-F0-9]{3}-[A-F0-9]{12}$/)
  })
})

it('preserves document elements when switching to a smaller original PDF page', () => {
  const template = {
    ...newTemplate(orgID),
    textBlocks: [{ id: 'TEXT', text: 'Heading', x: 500, y: 740, width: 100, fontSize: 24 }],
    imageBlocks: [{ id: 'IMAGE', imageData: 'bytes', x: 400, y: 500, width: 200, height: 260 }],
  }
  const fit = fitTemplateToPage(template, { width: 300, height: 400 })
  expect(fit.textBlocks).toHaveLength(1)
  expect(fit.imageBlocks).toHaveLength(1)
  expect(fit.textBlocks![0]).toMatchObject({ id: 'TEXT', text: 'Heading', x: 200, y: 340 })
  expect(fit.imageBlocks![0].x + fit.imageBlocks![0].width).toBeLessThanOrEqual(300)
  expect(fit.imageBlocks![0].y + fit.imageBlocks![0].height).toBeLessThanOrEqual(400)
  expect(template.textBlocks[0].x).toBe(500)
})

describe('0.4 editing', () => {
  it('creates a space without inventing a period', () => {
    const s = simulateAction(emptySnapshot(), { kind: 'createOrganization', id: 'ORG', name: 'Grupo' })
    expect(s.organizations).toHaveLength(1)
    expect(s.periods).toHaveLength(0)
  })
  it('editing an event moves its attendance with it and the toggle changes the result', () => {
    let s = makeDemo()
    const event = s.events.find((e) => s.attendance.some((a) => a.eventID === e.id && a.status === 'present'))!
    const row = s.attendance.find((a) => a.eventID === event.id && a.status === 'present')!
    const before = attendanceResult(s, row.memberID).present
    s = simulateAction(s, { kind: 'updateEvent', entity: { ...event, countsAttendance: false, title: 'Movido' } })
    expect(s.events.find((e) => e.id === event.id)!.title).toBe('Movido')
    expect(s.attendance.find((a) => a.id === row.id)!.countsAttendanceSnapshot).toBe(false)
    expect(attendanceResult(s, row.memberID).present).toBe(before - 1)
    expect(() => simulateAction(s, { kind: 'updateEvent', entity: { ...event, title: '  ' } })).toThrow()
  })
  it('renames keep identity', () => {
    const s = makeDemo(),
      c = s.components[0]
    const next = simulateAction(s, { kind: 'rename', entity: 'component', id: c.id, name: 'Nuevo nombre' })
    expect(next.components[0]).toMatchObject({ id: c.id, name: 'Nuevo nombre' })
    expect(() => simulateAction(s, { kind: 'rename', entity: 'group', id: 'X', name: 'a' })).toThrow()
  })
  it('suggests volunteers even when the space has no periods', () => {
    const s = makeDemo()
    const event = s.events.find((e) => e.volunteerCapacity != null)!
    expect(volunteerOrder(s, event, undefined).length).toBeGreaterThanOrEqual(0)
  })
  it('rounds new events to the next whole hour', () => {
    const d = nextWholeHour(new Date(2026, 9, 14, 17, 39))
    expect([d.getHours(), d.getMinutes()]).toEqual([18, 0])
  })
})
