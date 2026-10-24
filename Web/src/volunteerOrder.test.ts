import { describe, expect, it } from 'vitest'
import { emptySnapshot, volunteerOrder } from './domain'
import type { Activity, Volunteer } from './domain'

const current: Activity = {
  id: 'CURRENT',
  organizationID: 'ORG',
  componentID: 'SERVICE',
  categoryID: 'CLINIC',
  title: 'Synthetic shift',
  startsAt: '2026-11-01T00:00:00Z',
  countsAttendance: false,
  isCancelled: false,
  volunteerCapacity: 1,
}
const registration = (memberID: string, registeredAt: string): Volunteer => ({
  id: 'REG-' + memberID,
  eventID: current.id,
  memberID,
  status: 'interested',
  registeredAt,
})
function fixture(first: string, second: string) {
  const s = emptySnapshot()
  s.events = [current]
  s.members = ['A', 'B'].map((id) => ({ id, organizationID: 'ORG', name: id, isActive: true }))
  s.volunteers = [registration('B', second), registration('A', first)]
  return s
}
function addHistory(s: ReturnType<typeof fixture>, memberID: string, dates: string[]) {
  dates.forEach((startsAt, index) => {
    const id = memberID + '-' + index
    s.events.push({ ...current, id, startsAt })
    s.volunteers.push({ ...registration(memberID, startsAt), id, eventID: id, status: 'completed' })
  })
}

describe('Volunteer ordering compares instants, not ISO spellings', () => {
  it.each([
    ['2026-10-01T00:00:00Z', '2026-10-01T00:00:00.001Z'],
    ['2026-10-01T10:00:00+02:00', '2026-10-01T09:00:00Z'],
    ['2026-10-01T00:00:00.01Z', '2026-10-01T00:00:00.100Z'],
  ])('ranks earlier registration %s before %s', (first, second) => {
    const s = fixture(first, second),
      before = JSON.stringify(s)
    expect(volunteerOrder(s, current).map((v) => v.memberID)).toEqual(['A', 'B'])
    expect(JSON.stringify(s)).toBe(before)
  })
  it.each([
    ['2026-10-01T00:00:00Z', '2026-10-01T00:00:00.000Z'],
    ['2026-10-01T10:00:00+02:00', '2026-10-01T08:00:00Z'],
    ['2026-10-01T00:00:00.1Z', '2026-10-01T00:00:00.100Z'],
  ])('uses member identity for equal registration instants %s and %s', (first, second) => {
    expect(volunteerOrder(fixture(first, second), current).map((v) => v.memberID)).toEqual([
      'A',
      'B',
    ])
  })
  it('compares last participation chronologically before registration time', () => {
    const s = fixture('2026-10-10T00:00:00Z', '2026-10-01T00:00:00Z')
    addHistory(s, 'A', ['2026-10-01T10:00:00+02:00'])
    addHistory(s, 'B', ['2026-10-01T09:00:00Z'])
    expect(volunteerOrder(s, current).map((v) => v.memberID)).toEqual(['A', 'B'])
  })
  it('finds the true latest prior participation before comparing candidates', () => {
    const s = fixture('2026-10-10T00:00:00Z', '2026-10-10T00:00:00Z')
    addHistory(s, 'A', ['2026-10-01T10:00:00+02:00', '2026-10-01T09:00:00Z'])
    addHistory(s, 'B', ['2026-10-01T07:00:00Z', '2026-10-01T08:30:00Z'])
    const result = volunteerOrder(s, current)
    expect(result.map((v) => v.memberID)).toEqual(['B', 'A'])
    expect(result.find((v) => v.memberID === 'A')?.last).toBe('2026-10-01T09:00:00Z')
  })
  it('uses registration time when last participation has equal instants', () => {
    const s = fixture('2026-10-02T00:00:00Z', '2026-10-01T00:00:00Z')
    addHistory(s, 'A', ['2026-10-01T00:00:00.000Z'])
    addHistory(s, 'B', ['2026-10-01T00:00:00Z'])
    expect(volunteerOrder(s, current).map((v) => v.memberID)).toEqual(['B', 'A'])
  })
  it('keeps an invalid registration visible after dated peers without changing its source', () => {
    const s = fixture('not-a-date', '2026-10-01T00:00:00Z'),
      before = JSON.stringify(s)
    expect(volunteerOrder(s, current).map((v) => v.memberID)).toEqual(['B', 'A'])
    expect(JSON.stringify(s)).toBe(before)
  })
  it('uses member identity as the deterministic fallback for two invalid registration dates', () => {
    expect(volunteerOrder(fixture('not-a-date', ''), current).map((v) => v.memberID)).toEqual([
      'A',
      'B',
    ])
  })
  it('does not suggest volunteers for an invalid target date without a period filter', () => {
    const s = fixture('2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')
    expect(volunteerOrder(s, { ...current, startsAt: 'not-a-date' })).toEqual([])
  })
  it('ignores invalid, same-instant, and future history without losing valid prior participation', () => {
    const s = fixture('2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')
    addHistory(s, 'A', ['not-a-date', '2026-11-01T01:00:00+01:00', '2026-11-02T00:00:00Z'])
    addHistory(s, 'B', ['2026-10-02T00:00:00Z'])
    expect(
      volunteerOrder(s, current).map(({ memberID, count, last }) => ({ memberID, count, last })),
    ).toEqual([
      { memberID: 'A', count: 0, last: '' },
      { memberID: 'B', count: 1, last: '2026-10-02T00:00:00Z' },
    ])
  })
})
