import { DomainError } from './errors.ts'
import { canonicalId } from './ids.ts'
import { SCHEMA, type Workspace } from './model.ts'
import { assertHalfOpen, parseInstant } from './time.ts'
import { assertCapacity } from './volunteers.ts'

export function validate(workspace: Workspace): void {
  if (workspace.schema !== SCHEMA || workspace.schemaVersion !== 1) throw new DomainError('unsupported-schema')
  if (!Number.isSafeInteger(workspace.revision) || workspace.revision < 0) throw new DomainError('invalid-revision')
  unique(workspace.spaces.map((item) => item.id))
  unique(workspace.periods.map((item) => item.id))
  unique(workspace.people.map((item) => item.id))
  unique(workspace.groups.map((item) => item.id))
  unique(workspace.memberships.map((item) => item.id))
  unique(workspace.components.map((item) => item.id))
  unique(workspace.encounters.map((item) => item.id))
  unique(workspace.attendance.map((item) => item.id))
  unique(workspace.volunteers.map((item) => item.id))
  uniquePairs(workspace.attendance.map((item) => `${item.encounterId}:${item.personId}`), 'duplicate-attendance')
  uniquePairs(workspace.volunteers.map((item) => `${item.encounterId}:${item.personId}`), 'duplicate-volunteer')
  const spaces = new Set(workspace.spaces.map((item) => canonicalId(item.id)))
  for (const space of workspace.spaces) {
    canonicalId(space.id)
    if (!space.name.trim() || space.name.length > 200) throw new DomainError('invalid-name')
    if (!/^[A-Za-z0-9_+/-]{1,64}$/.test(space.timeZone)) throw new DomainError('invalid-timezone')
  }
  for (const period of workspace.periods) {
    canonicalId(period.id)
    if (!spaces.has(period.spaceId)) throw new DomainError('broken-relationship')
    if (!period.name.trim()) throw new DomainError('invalid-name')
    assertHalfOpen(period.startsAt, period.endsAt)
  }
  for (const person of workspace.people) {
    canonicalId(person.id)
    if (!spaces.has(person.spaceId) || !person.name.trim()) throw new DomainError('broken-relationship')
  }
  for (const group of workspace.groups) {
    canonicalId(group.id)
    if (!spaces.has(group.spaceId)) throw new DomainError('broken-relationship')
  }
  const groups = new Set(workspace.groups.map((item) => item.id))
  for (const membership of workspace.memberships) {
    canonicalId(membership.id)
    if (!groups.has(membership.groupId) || !workspace.people.some((person) => person.id === membership.personId)) {
      throw new DomainError('broken-relationship')
    }
    parseInstant(membership.startsAt)
    if (membership.endsAt != null) assertHalfOpen(membership.startsAt, membership.endsAt)
  }
  const components = new Set(workspace.components.map((item) => item.id))
  for (const component of workspace.components) {
    canonicalId(component.id)
    if (!spaces.has(component.spaceId)) throw new DomainError('broken-relationship')
  }
  for (const encounter of workspace.encounters) {
    canonicalId(encounter.id)
    parseInstant(encounter.startsAt)
    if (!spaces.has(encounter.spaceId) || !components.has(encounter.componentId) || !encounter.title.trim()) {
      throw new DomainError('broken-relationship')
    }
  }
  const encounters = new Map(workspace.encounters.map((item) => [item.id, item]))
  for (const row of workspace.attendance) {
    const encounter = encounters.get(row.encounterId)
    const person = workspace.people.find((item) => item.id === row.personId)
    if (!encounter || !person || person.spaceId !== encounter.spaceId) throw new DomainError('broken-relationship')
    parseInstant(row.eventInstant)
  }
  for (const entry of workspace.volunteers) {
    const encounter = encounters.get(entry.encounterId)
    const person = workspace.people.find((item) => item.id === entry.personId)
    if (!encounter || !person || encounter.volunteerCapacity == null) throw new DomainError('broken-relationship')
    parseInstant(entry.registeredAt)
  }
  for (const link of workspace.collaboration) {
    if (!spaces.has(canonicalId(link.spaceId))) throw new DomainError('broken-relationship')
    uniqueText(link.entries.map((entry) => entry.key))
    for (const entry of link.entries) unique(entry.versions.map((version) => version.id))
  }
  assertCapacity(workspace)
}

function unique(ids: string[]): void {
  const canonical = ids.map((id) => canonicalId(id))
  if (new Set(canonical).size !== canonical.length) throw new DomainError('duplicate-identity')
}

function uniquePairs(pairs: string[], code: string): void {
  if (new Set(pairs).size !== pairs.length) throw new DomainError(code)
}

function uniqueText(values: string[]): void {
  if (values.some((value) => value.trim() === '') || new Set(values).size !== values.length) {
    throw new DomainError('duplicate-identity')
  }
}
