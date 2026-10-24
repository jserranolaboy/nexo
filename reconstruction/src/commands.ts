import { DomainError } from './errors.ts'
import { canonicalId, newId } from './ids.ts'
import type {
  Attendance,
  AttendanceStatus,
  CollaborationVersion,
  Encounter,
  Membership,
  Workspace,
} from './model.ts'
import { parseInstant } from './time.ts'
import { validate } from './validate.ts'
import { selectVolunteer } from './volunteers.ts'

export interface Clock {
  now(): string
}

export function systemClock(): Clock {
  return { now: () => new Date().toISOString() }
}

function draft(workspace: Workspace, mutate: (next: Workspace) => void): Workspace {
  const next = structuredClone(workspace)
  mutate(next)
  validate(next)
  return next
}

export function createSpace(workspace: Workspace, input: { id?: string; name: string; timeZone: string }): Workspace {
  return draft(workspace, (next) => {
    next.spaces.push({
      id: canonicalId(input.id ?? newId()),
      name: input.name.trim(),
      timeZone: input.timeZone,
    })
  })
}

export function addPeriod(
  workspace: Workspace,
  input: { id?: string; spaceId: string; name: string; startsAt: string; endsAt: string },
): Workspace {
  return draft(workspace, (next) => {
    next.periods.push({
      id: canonicalId(input.id ?? newId()),
      spaceId: canonicalId(input.spaceId),
      name: input.name.trim(),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    })
  })
}

export function addPerson(
  workspace: Workspace,
  input: { id?: string; spaceId: string; name: string; active?: boolean },
): Workspace {
  return draft(workspace, (next) => {
    next.people.push({
      id: canonicalId(input.id ?? newId()),
      spaceId: canonicalId(input.spaceId),
      name: input.name.trim(),
      active: input.active ?? true,
    })
  })
}

export function addGroup(workspace: Workspace, input: { id?: string; spaceId: string; name: string }): Workspace {
  return draft(workspace, (next) => {
    next.groups.push({
      id: canonicalId(input.id ?? newId()),
      spaceId: canonicalId(input.spaceId),
      name: input.name.trim(),
    })
  })
}

export function addMembership(
  workspace: Workspace,
  input: { id?: string; personId: string; groupId: string; startsAt: string; endsAt?: string | null },
): Workspace {
  return draft(workspace, (next) => {
    const membership: Membership = {
      id: canonicalId(input.id ?? newId()),
      personId: canonicalId(input.personId),
      groupId: canonicalId(input.groupId),
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
    }
    next.memberships.push(membership)
  })
}

export function addComponent(
  workspace: Workspace,
  input: { id?: string; spaceId: string; name: string },
): Workspace {
  return draft(workspace, (next) => {
    next.components.push({
      id: canonicalId(input.id ?? newId()),
      spaceId: canonicalId(input.spaceId),
      name: input.name.trim(),
    })
  })
}

export function createEncounter(
  workspace: Workspace,
  input: {
    id?: string
    spaceId: string
    title: string
    startsAt: string
    componentId: string
    categoryId?: string | null
    personIds?: string[]
    volunteerCapacity?: number | null
    countsAttendance?: boolean
    cancelled?: boolean
  },
): Workspace {
  return draft(workspace, (next) => {
    const encounter: Encounter = {
      id: canonicalId(input.id ?? newId()),
      spaceId: canonicalId(input.spaceId),
      title: input.title.trim(),
      startsAt: input.startsAt,
      componentId: canonicalId(input.componentId),
      categoryId: input.categoryId ? canonicalId(input.categoryId) : null,
      countsAttendance: input.countsAttendance ?? true,
      cancelled: input.cancelled ?? false,
      volunteerCapacity: input.volunteerCapacity ?? null,
    }
    next.encounters.push(encounter)
    appendPendingRoster(next, encounter, input.personIds ?? [])
  })
}

export function setAttendance(
  workspace: Workspace,
  input: { encounterId: string; personId: string; status: AttendanceStatus; note?: string; recordedAt: string },
): Workspace {
  return draft(workspace, (next) => {
    const row = next.attendance.find(
      (item) =>
        item.encounterId === canonicalId(input.encounterId) &&
        item.personId === canonicalId(input.personId) &&
        !item.voided,
    )
    if (!row) throw new DomainError('not-on-roster')
    row.status = input.status
    if (input.note != null) row.note = input.note
    row.recordedAt = input.recordedAt
  })
}

export function duplicateEncounter(
  workspace: Workspace,
  input: { sourceId: string; id?: string; startsAt: string; copyRoster?: boolean },
): Workspace {
  return draft(workspace, (next) => {
    const source = next.encounters.find((item) => item.id === canonicalId(input.sourceId))
    if (!source) throw new DomainError('missing-encounter')
    const copy: Encounter = {
      ...source,
      id: canonicalId(input.id ?? newId()),
      startsAt: input.startsAt,
      cancelled: false,
    }
    next.encounters.push(copy)
    if (input.copyRoster === false) return
    const people = next.attendance
      .filter((row) => row.encounterId === source.id && !row.voided)
      .map((row) => row.personId)
    appendPendingRoster(next, copy, people)
  })
}

export function registerVolunteer(
  workspace: Workspace,
  input: { id?: string; encounterId: string; personId: string; registeredAt: string },
): Workspace {
  return draft(workspace, (next) => {
    const encounter = next.encounters.find((item) => item.id === canonicalId(input.encounterId))
    const person = next.people.find((item) => item.id === canonicalId(input.personId))
    if (!encounter || encounter.cancelled || encounter.volunteerCapacity == null || !person || !person.active) {
      throw new DomainError('volunteer-unavailable')
    }
    next.volunteers.push({
      id: canonicalId(input.id ?? newId()),
      encounterId: encounter.id,
      personId: person.id,
      status: 'interested',
      registeredAt: input.registeredAt,
    })
  })
}

export function chooseVolunteer(workspace: Workspace, encounterId: string, personId: string): Workspace {
  return draft(workspace, (next) => {
    const chosen = selectVolunteer(next, canonicalId(encounterId), canonicalId(personId))
    const index = next.volunteers.findIndex((item) => item.id === chosen.id)
    next.volunteers[index] = chosen
  })
}

export function finishVolunteer(
  workspace: Workspace,
  encounterId: string,
  personId: string,
  participated: boolean,
): Workspace {
  return draft(workspace, (next) => {
    const entry = next.volunteers.find(
      (item) => item.encounterId === canonicalId(encounterId) && item.personId === canonicalId(personId),
    )
    if (!entry || entry.status !== 'selected') throw new DomainError('invalid-transition')
    entry.status = participated ? 'completed' : 'noShow'
  })
}

export function declineVolunteer(workspace: Workspace, encounterId: string, personId: string): Workspace {
  return draft(workspace, (next) => {
    const entry = next.volunteers.find(
      (item) => item.encounterId === canonicalId(encounterId) && item.personId === canonicalId(personId),
    )
    if (!entry || (entry.status !== 'interested' && entry.status !== 'selected')) {
      throw new DomainError('invalid-transition')
    }
    entry.status = 'declined'
  })
}

export function linkCollaboration(workspace: Workspace, spaceId: string, pendingUploads: string[] = []): Workspace {
  return draft(workspace, (next) => {
    next.collaboration.push({
      spaceId: canonicalId(spaceId),
      paused: false,
      pendingUploads: [...pendingUploads],
      entries: [],
    })
  })
}

export function combineVolunteerSelection(
  workspace: Workspace,
  encounterId: string,
  personIds: string[],
): Workspace {
  let next = workspace
  for (const personId of personIds) next = chooseVolunteer(next, encounterId, personId)
  return next
}

export function recordAlternative(
  workspace: Workspace,
  input: { spaceId: string; key: string; version: CollaborationVersion },
): Workspace {
  return draft(workspace, (next) => {
    const link = next.collaboration.find((item) => item.spaceId === canonicalId(input.spaceId))
    if (!link) throw new DomainError('missing-collaboration')
    const entry = link.entries.find((item) => item.key === input.key)
    if (entry) entry.versions.push({ ...input.version })
    else link.entries.push({ key: input.key, versions: [{ ...input.version }] })
  })
}

/** Keeps the chosen version and drops the others. A paused link does not gain an upload. */
export function chooseAlternative(
  workspace: Workspace,
  input: { spaceId: string; key: string; versionId: string },
): Workspace {
  return draft(workspace, (next) => {
    const link = next.collaboration.find((item) => item.spaceId === canonicalId(input.spaceId))
    if (!link) throw new DomainError('missing-collaboration')
    const entry = link.entries.find((item) => item.key === input.key)
    const chosenId = canonicalId(input.versionId)
    const chosen = entry?.versions.find((version) => canonicalId(version.id) === chosenId)
    if (!entry || entry.versions.length < 2 || !chosen) throw new DomainError('missing-alternative')
    entry.versions = [{ id: chosenId, value: chosen.value }]
    if (link.paused) link.pendingUploads = link.pendingUploads.slice()
  })
}

export function pauseCollaboration(workspace: Workspace): Workspace {
  return draft(workspace, (next) => {
    for (const link of next.collaboration) link.paused = true
  })
}

function appendPendingRoster(workspace: Workspace, encounter: Encounter, personIds: string[]): void {
  const seen = new Set<string>()
  for (const rawId of personIds) {
    const personId = canonicalId(rawId)
    if (seen.has(personId)) throw new DomainError('duplicate-attendance')
    seen.add(personId)
    const person = workspace.people.find((item) => item.id === personId && item.spaceId === encounter.spaceId && item.active)
    if (!person) throw new DomainError('invalid-member')
    const row: Attendance = {
      id: newId(),
      encounterId: encounter.id,
      personId,
      status: 'pending',
      voided: false,
      note: '',
      recordedAt: null,
      eventInstant: encounter.startsAt,
      componentId: encounter.componentId,
      categoryId: encounter.categoryId,
      countsAttendance: encounter.countsAttendance,
    }
    parseInstant(row.eventInstant)
    workspace.attendance.push(row)
  }
}

export function membershipIncludes(startsAt: string, endsAt: string | null, instant: string): boolean {
  const point = parseInstant(instant)
  if (point < parseInstant(startsAt)) return false
  return endsAt == null || point < parseInstant(endsAt)
}
