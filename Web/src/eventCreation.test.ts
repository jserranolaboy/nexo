import { describe, expect, it } from 'vitest'
import { emptySnapshot, id, simulateAction } from './domain'
import type { Activity } from './domain'

function fixture() {
  const s = emptySnapshot(),
    orgID = id(),
    componentID = id(),
    categoryID = id(),
    memberID = id(),
    otherID = id(),
    groupID = id()
  s.revision = 41
  s.organizations = [
    { id: orgID, name: 'Synthetic', accentHex: '#262629', timeZoneIdentifier: 'UTC' },
  ]
  s.components = [{ id: componentID, organizationID: orgID, name: 'Component' }]
  s.categories = [{ id: categoryID, componentID, name: 'Category' }]
  s.members = [
    { id: memberID, organizationID: orgID, name: 'Ana', isActive: true },
    { id: otherID, organizationID: orgID, name: 'Bea', isActive: true },
  ]
  s.groups = [{ id: groupID, organizationID: orgID, name: 'Group' }]
  s.memberships = [
    {
      id: id(),
      memberID,
      groupID,
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2026-11-01T00:00:00Z',
    },
  ]
  const event: Activity = {
    id: id(),
    organizationID: orgID,
    componentID,
    categoryID,
    title: 'Duplicate',
    startsAt: '2026-10-21T12:00:00Z',
    countsAttendance: true,
    isCancelled: false,
    volunteerCapacity: 2,
  }
  return { s, event, memberID, otherID, groupID }
}

describe('Atomic demo event creation with optional roster', () => {
  it('creates fresh pending attendance snapshots and advances exactly one revision', () => {
    const { s, event, memberID, otherID, groupID } = fixture(),
      before = structuredClone(s)
    const next = simulateAction(s, {
      kind: 'addEvent',
      entity: event,
      memberIDs: [memberID, otherID],
    })
    expect(next.revision).toBe(42)
    expect(next.events).toEqual([event])
    expect(next.attendance).toHaveLength(2)
    expect(next.attendance[0]).toMatchObject({
      memberID,
      eventID: event.id,
      status: 'pending',
      note: '',
      isVoided: false,
      memberNameSnapshot: 'Ana',
      groupIDsSnapshot: [groupID],
      eventDateSnapshot: event.startsAt,
      componentIDSnapshot: event.componentID,
      categoryIDSnapshot: event.categoryID,
      countsAttendanceSnapshot: true,
    })
    expect(next.attendance[1]).toMatchObject({ memberID: otherID, groupIDsSnapshot: [] })
    expect(new Set(next.attendance.map((row) => row.id)).size).toBe(2)
    expect(next.events[0]).not.toBe(event)
    expect(s).toEqual(before)
  })
  it.each([undefined, []])('creates only the event when memberIDs is %j', (memberIDs) => {
    const { s, event } = fixture()
    const next = simulateAction(s, {
      kind: 'addEvent',
      entity: event,
      ...(memberIDs === undefined ? {} : { memberIDs }),
    })
    expect(next.events).toEqual([event])
    expect(next.attendance).toEqual([])
    expect(next.revision).toBe(42)
  })
  it.each([
    'missing',
    'inactive',
    'foreign',
    'duplicate',
    'duplicate-case',
    'malformed',
    'too-many',
    'null',
  ])(
    'rejects %s roster atomically and permits a repaired retry with the same event ID',
    (invalid) => {
      const { s, event, memberID, otherID } = fixture()
      let memberIDs: unknown = [memberID, otherID]
      if (invalid === 'missing') memberIDs = [memberID, id()]
      if (invalid === 'inactive') s.members[1].isActive = false
      if (invalid === 'foreign') s.members[1].organizationID = id()
      if (invalid === 'duplicate') memberIDs = [memberID, memberID]
      if (invalid === 'duplicate-case') memberIDs = [memberID, memberID.toLowerCase()]
      if (invalid === 'malformed') memberIDs = [memberID, 'not-a-uuid']
      if (invalid === 'too-many') memberIDs = Array.from({ length: 10001 }, () => memberID)
      if (invalid === 'null') memberIDs = null
      const before = structuredClone(s)
      expect(() => simulateAction(s, { kind: 'addEvent', entity: event, memberIDs })).toThrow()
      expect(s).toEqual(before)
      const repaired = simulateAction(s, { kind: 'addEvent', entity: event, memberIDs: [memberID] })
      expect(repaired.events).toEqual([event])
      expect(repaired.attendance).toHaveLength(1)
      expect(repaired.revision).toBe(42)
    },
  )
  it.each(['title', 'date', 'component', 'category', 'capacity', 'identity'])(
    'validates event %s before returning a committed snapshot',
    (invalid) => {
      const { s, event, memberID } = fixture(),
        broken = { ...event }
      if (invalid === 'title') broken.title = '  '
      if (invalid === 'date') broken.startsAt = 'invalid'
      if (invalid === 'component') broken.componentID = id()
      if (invalid === 'category') broken.categoryID = id()
      if (invalid === 'capacity') broken.volunteerCapacity = -1
      if (invalid === 'identity') s.events = [event]
      const before = structuredClone(s)
      expect(() =>
        simulateAction(s, { kind: 'addEvent', entity: broken, memberIDs: [memberID] }),
      ).toThrow()
      expect(s).toEqual(before)
    },
  )
  it('rejects adding a roster to a cancelled new event without retaining it', () => {
    const { s, event, memberID } = fixture(),
      before = structuredClone(s)
    expect(() =>
      simulateAction(s, {
        kind: 'addEvent',
        entity: { ...event, isCancelled: true },
        memberIDs: [memberID],
      }),
    ).toThrow()
    expect(s).toEqual(before)
  })
  it('retains roster command validation and historical group snapshots', () => {
    const { s, event, memberID, groupID } = fixture()
    const created = simulateAction(s, { kind: 'addEvent', entity: event })
    const listed = simulateAction(created, {
      kind: 'roster',
      eventID: event.id,
      memberIDs: [memberID],
    })
    expect(listed.attendance[0].groupIDsSnapshot).toEqual([groupID])
    expect(listed.revision).toBe(43)
    expect(() =>
      simulateAction(listed, { kind: 'roster', eventID: event.id, memberIDs: [memberID] }),
    ).toThrow()
    expect(created.attendance).toEqual([])
  })
})
