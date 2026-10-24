import { DomainError } from './errors.ts'
import type { Volunteer, Workspace } from './model.ts'
import { containsInstant, parseInstant } from './time.ts'

export interface VolunteerSuggestion {
  personId: string
  completedInScope: number
  lastCompletedAt: string | null
  registeredAt: string
}

const OCCUPYING = new Set(['selected', 'completed'])

export function occupiedSlots(workspace: Workspace, encounterId: string): number {
  return workspace.volunteers.filter(
    (entry) => entry.encounterId === encounterId && OCCUPYING.has(entry.status),
  ).length
}

export function suggestVolunteers(
  workspace: Workspace,
  encounterId: string,
  periodId: string,
): VolunteerSuggestion[] {
  const encounter = workspace.encounters.find((item) => item.id === encounterId)
  const period = workspace.periods.find((item) => item.id === periodId)
  if (!encounter || !period) return []
  if (
    encounter.spaceId !== period.spaceId ||
    encounter.cancelled ||
    encounter.volunteerCapacity == null ||
    !containsInstant(period.startsAt, period.endsAt, encounter.startsAt)
  ) {
    return []
  }
  const people = new Map(workspace.people.map((person) => [person.id, person]))
  const encounters = new Map(workspace.encounters.map((item) => [item.id, item]))
  const prior = new Map<string, string[]>()
  for (const entry of workspace.volunteers) {
    if (entry.status !== 'completed') continue
    const previous = encounters.get(entry.encounterId)
    if (
      !previous ||
      previous.id === encounter.id ||
      previous.spaceId !== encounter.spaceId ||
      previous.cancelled ||
      parseInstant(previous.startsAt) >= parseInstant(encounter.startsAt) ||
      !containsInstant(period.startsAt, period.endsAt, previous.startsAt)
    ) {
      continue
    }
    const sameScope = encounter.categoryId
      ? previous.categoryId === encounter.categoryId
      : previous.componentId === encounter.componentId
    if (!sameScope) continue
    const dates = prior.get(entry.personId) ?? []
    dates.push(previous.startsAt)
    prior.set(entry.personId, dates)
  }
  const suggestions: VolunteerSuggestion[] = []
  for (const entry of workspace.volunteers) {
    if (entry.encounterId !== encounter.id || entry.status !== 'interested') continue
    const person = people.get(entry.personId)
    if (!person || person.spaceId !== encounter.spaceId || !person.active) continue
    const dates = (prior.get(person.id) ?? []).slice().sort()
    suggestions.push({
      personId: person.id,
      completedInScope: dates.length,
      lastCompletedAt: dates.at(-1) ?? null,
      registeredAt: entry.registeredAt,
    })
  }
  return suggestions.sort((left, right) => {
    if (left.completedInScope !== right.completedInScope) {
      return left.completedInScope - right.completedInScope
    }
    const last = compareOptionalInstant(left.lastCompletedAt, right.lastCompletedAt)
    if (last !== 0) return last
    const registered = parseInstant(left.registeredAt) - parseInstant(right.registeredAt)
    if (registered !== 0) return registered
    return left.personId < right.personId ? -1 : left.personId > right.personId ? 1 : 0
  })
}

function compareOptionalInstant(left: string | null, right: string | null): number {
  if (left === right) return 0
  if (left == null) return -1
  if (right == null) return 1
  return parseInstant(left) - parseInstant(right)
}

export function assertCapacity(workspace: Workspace): void {
  for (const encounter of workspace.encounters) {
    if (encounter.volunteerCapacity == null) continue
    if (!Number.isSafeInteger(encounter.volunteerCapacity) || encounter.volunteerCapacity < 1) {
      throw new DomainError('invalid-capacity')
    }
    if (occupiedSlots(workspace, encounter.id) > encounter.volunteerCapacity) {
      throw new DomainError('capacity-exceeded')
    }
  }
}

export function selectVolunteer(workspace: Workspace, encounterId: string, personId: string): Volunteer {
  const encounter = workspace.encounters.find((item) => item.id === encounterId)
  if (!encounter || encounter.cancelled || encounter.volunteerCapacity == null) {
    throw new DomainError('volunteer-unavailable')
  }
  const entry = workspace.volunteers.find(
    (item) => item.encounterId === encounterId && item.personId === personId && item.status === 'interested',
  )
  const person = workspace.people.find((item) => item.id === personId)
  if (!entry || !person || !person.active || person.spaceId !== encounter.spaceId) {
    throw new DomainError('invalid-transition')
  }
  if (occupiedSlots(workspace, encounterId) >= encounter.volunteerCapacity) {
    throw new DomainError('capacity-exceeded')
  }
  return { ...entry, status: 'selected' }
}
