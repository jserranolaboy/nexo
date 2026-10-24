import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DomainError } from './errors.ts'
import { canonicalId } from './ids.ts'
import { SCHEMA, type AttendanceStatus, type Workspace } from './model.ts'
import { FileWorkspaceStore, parseWorkspace } from './store.ts'
import { parseInstant } from './time.ts'
import { validate } from './validate.ts'

const ATTENDANCE: readonly AttendanceStatus[] = ['pending', 'present', 'absent', 'excused']

export const PREVIOUS_COPY = 'nexo-reconstruction-previous.json'

export interface LegacyMember {
  id: string
  organizationID: string
  name: string
  isActive: boolean
}

export interface LegacyEvent {
  id: string
  organizationID: string
  title: string
  startsAt: string
  componentID: string
  categoryID: string | null
  countsAttendance: boolean
  isCancelled: boolean
  volunteerCapacity: number | null
}

export interface LegacyAttendance {
  id: string
  eventID: string
  memberID: string
  status: AttendanceStatus
  isVoided: boolean
  note: string
  recordedAt: string | null
  eventDateSnapshot: string | null
  componentIDSnapshot: string | null
  categoryIDSnapshot: string | null
  countsAttendanceSnapshot: boolean | null
}

export interface LegacySnapshot {
  organizations: { id: string; name: string; timeZoneIdentifier: string }[]
  components: { id: string; organizationID: string; name: string }[]
  members: LegacyMember[]
  events: LegacyEvent[]
  attendance: LegacyAttendance[]
}

/**
 * Reads an explicit synthetic workspace-v1.json and writes nexo-reconstruction-v1.json.
 * The source bytes stay in place. A failed check does not install an empty workspace.
 */
export function migrateLegacyFile(
  directory: string,
  sourcePath: string,
  seal: (workspace: Workspace) => void = () => undefined,
): Workspace {
  assertSourcePath(sourcePath)
  const original = readFileSync(sourcePath)
  const legacy = parseLegacy(original.toString('utf8'))
  const projected = projectLegacy(legacy)
  validate(projected)
  if (!migrationMatches(legacy, projected)) throw new DomainError('migration-rejected')
  const store = new FileWorkspaceStore(directory)
  const previous = existsSync(store.primaryPath()) ? readFileSync(store.primaryPath()) : null
  try {
    if (previous) {
      const current = store.load()
      store.save({ ...projected, revision: current.revision }, current.revision)
    } else {
      store.initialize({ ...projected, revision: 0 })
    }
    const loaded = store.load()
    if (!migrationMatches(legacy, loaded)) throw new DomainError('migration-rejected')
    seal(loaded)
    if (!readFileSync(sourcePath).equals(original)) throw new DomainError('source-mutated')
    if (previous) writeFileSync(previousCopyPath(directory), previous)
    return loaded
  } catch (error) {
    restorePrimary(directory, previous)
    throw error
  }
}

/** Puts the previous new-format bytes back. A missing or invalid copy does not install an empty file. */
export function revertToPreviousCopy(directory: string): Workspace {
  const stored = previousCopyPath(directory)
  if (!existsSync(stored)) throw new DomainError('missing-previous')
  const bytes = readFileSync(stored)
  const workspace = parsePrevious(bytes)
  const store = new FileWorkspaceStore(directory)
  const temporary = path.join(directory, `.revert-${randomUUID()}.tmp`)
  writeFileSync(temporary, bytes)
  try {
    const checked = parsePrevious(readFileSync(temporary))
    if (!sameWork(workspace, checked)) throw new DomainError('migration-rejected')
    renameSync(temporary, store.primaryPath())
    return checked
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary)
    throw error
  }
}

export function migrationMatches(legacy: LegacySnapshot, workspace: Workspace): boolean {
  if (workspace.people.length !== legacy.members.length) return false
  if (workspace.encounters.length !== legacy.events.length) return false
  if (workspace.attendance.length !== legacy.attendance.length) return false
  for (const member of legacy.members) {
    const person = workspace.people.find((item) => item.id === canonicalId(member.id))
    if (!person || person.name !== member.name || person.active !== member.isActive) return false
    if (person.spaceId !== canonicalId(member.organizationID)) return false
  }
  for (const event of legacy.events) {
    const encounter = workspace.encounters.find((item) => item.id === canonicalId(event.id))
    if (!encounter || encounter.title !== event.title || encounter.cancelled !== event.isCancelled) return false
    if (encounter.startsAt !== canonicalizeInstant(event.startsAt)) return false
    if (encounter.countsAttendance !== event.countsAttendance) return false
  }
  for (const row of legacy.attendance) {
    const event = legacy.events.find((item) => canonicalId(item.id) === canonicalId(row.eventID))
    const attendance = workspace.attendance.find((item) => item.id === canonicalId(row.id))
    if (!event || !attendance) return false
    if (attendance.personId !== canonicalId(row.memberID) || attendance.encounterId !== canonicalId(row.eventID)) {
      return false
    }
    if (attendance.status !== row.status || attendance.voided !== row.isVoided || attendance.note !== row.note) return false
    if (attendance.eventInstant !== canonicalizeInstant(row.eventDateSnapshot ?? event.startsAt)) return false
    const recorded = row.recordedAt ? canonicalizeInstant(row.recordedAt) : null
    if (attendance.recordedAt !== recorded) return false
  }
  return true
}

function previousCopyPath(directory: string): string {
  return path.join(directory, PREVIOUS_COPY)
}

function assertSourcePath(sourcePath: string): void {
  const resolved = path.resolve(sourcePath)
  const parts = resolved.split(path.sep).map((part) => part.toLowerCase())
  if (parts.includes('application support')) throw new DomainError('refused-location')
  if (path.basename(resolved) === 'vrr-data.json') throw new DomainError('unsupported-schema')
  if (path.basename(resolved) !== 'workspace-v1.json') throw new DomainError('unsupported-schema')
}

function parseLegacy(raw: string): LegacySnapshot {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new DomainError('corrupt-primary')
  }
  const record = recordOf(value)
  if (record.kind === 'vrr-data') throw new DomainError('unsupported-schema')
  if (record.schemaVersion !== 1) throw new DomainError('unsupported-schema')
  return {
    organizations: array(record.organizations).map(organizationOf),
    components: array(record.components).map(componentOf),
    members: array(record.members).map(memberOf),
    events: array(record.events).map(eventOf),
    attendance: array(record.attendance).map(attendanceOf),
  }
}

function projectLegacy(legacy: LegacySnapshot): Workspace {
  const events = new Map(legacy.events.map((event) => [canonicalId(event.id), event]))
  return {
    schema: SCHEMA,
    schemaVersion: 1,
    revision: 0,
    spaces: legacy.organizations.map((organization) => ({
      id: canonicalId(organization.id),
      name: organization.name,
      timeZone: organization.timeZoneIdentifier,
    })),
    periods: [],
    people: legacy.members.map((member) => ({
      id: canonicalId(member.id),
      spaceId: canonicalId(member.organizationID),
      name: member.name,
      active: member.isActive,
    })),
    groups: [],
    memberships: [],
    components: legacy.components.map((component) => ({
      id: canonicalId(component.id),
      spaceId: canonicalId(component.organizationID),
      name: component.name,
    })),
    encounters: legacy.events.map((event) => ({
      id: canonicalId(event.id),
      spaceId: canonicalId(event.organizationID),
      title: event.title,
      startsAt: canonicalizeInstant(event.startsAt),
      componentId: canonicalId(event.componentID),
      categoryId: event.categoryID ? canonicalId(event.categoryID) : null,
      countsAttendance: event.countsAttendance,
      cancelled: event.isCancelled,
      volunteerCapacity: event.volunteerCapacity,
    })),
    attendance: legacy.attendance.map((row) => {
      const event = events.get(canonicalId(row.eventID))
      if (!event) throw new DomainError('broken-relationship')
      const category = row.categoryIDSnapshot ?? event.categoryID
      return {
        id: canonicalId(row.id),
        encounterId: canonicalId(row.eventID),
        personId: canonicalId(row.memberID),
        status: row.status,
        voided: row.isVoided,
        note: row.note,
        recordedAt: row.recordedAt ? canonicalizeInstant(row.recordedAt) : null,
        eventInstant: canonicalizeInstant(row.eventDateSnapshot ?? event.startsAt),
        componentId: canonicalId(row.componentIDSnapshot ?? event.componentID),
        categoryId: category ? canonicalId(category) : null,
        countsAttendance: row.countsAttendanceSnapshot ?? event.countsAttendance,
      }
    }),
    volunteers: [],
    collaboration: [],
  }
}

function parsePrevious(bytes: Buffer): Workspace {
  const workspace = parseWorkspace(bytes.toString('utf8'))
  validate(workspace)
  return workspace
}

function sameWork(left: Workspace, right: Workspace): boolean {
  return (
    left.people.length === right.people.length &&
    left.encounters.length === right.encounters.length &&
    left.attendance.length === right.attendance.length &&
    left.people.every((person, index) => person.id === right.people[index]?.id && person.name === right.people[index]?.name) &&
    left.attendance.every((row, index) => row.id === right.attendance[index]?.id && row.status === right.attendance[index]?.status)
  )
}

function restorePrimary(directory: string, previous: Buffer | null): void {
  const primary = new FileWorkspaceStore(directory).primaryPath()
  if (!previous) {
    if (existsSync(primary)) unlinkSync(primary)
    return
  }
  const temporary = path.join(directory, `.migration-rollback-${randomUUID()}.tmp`)
  writeFileSync(temporary, previous)
  renameSync(temporary, primary)
}

function canonicalizeInstant(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value)
  if (!match) throw new DomainError('invalid-instant')
  const canonical = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`
  parseInstant(canonical)
  return canonical
}

function organizationOf(value: unknown): { id: string; name: string; timeZoneIdentifier: string } {
  const record = recordOf(value)
  return { id: text(record.id), name: text(record.name), timeZoneIdentifier: text(record.timeZoneIdentifier) }
}

function componentOf(value: unknown): { id: string; organizationID: string; name: string } {
  const record = recordOf(value)
  return { id: text(record.id), organizationID: text(record.organizationID), name: text(record.name) }
}

function memberOf(value: unknown): LegacyMember {
  const record = recordOf(value)
  return {
    id: text(record.id),
    organizationID: text(record.organizationID),
    name: text(record.name),
    isActive: flag(record.isActive),
  }
}

function eventOf(value: unknown): LegacyEvent {
  const record = recordOf(value)
  const capacity = record.volunteerCapacity
  if (capacity != null && (typeof capacity !== 'number' || !Number.isSafeInteger(capacity))) {
    throw new DomainError('corrupt-primary')
  }
  return {
    id: text(record.id),
    organizationID: text(record.organizationID),
    title: text(record.title),
    startsAt: text(record.startsAt),
    componentID: text(record.componentID),
    categoryID: optionalText(record.categoryID),
    countsAttendance: flag(record.countsAttendance),
    isCancelled: flag(record.isCancelled),
    volunteerCapacity: capacity ?? null,
  }
}

function attendanceOf(value: unknown): LegacyAttendance {
  const record = recordOf(value)
  const status = text(record.status)
  if (!ATTENDANCE.includes(status as AttendanceStatus)) throw new DomainError('corrupt-primary')
  return {
    id: text(record.id),
    eventID: text(record.eventID),
    memberID: text(record.memberID),
    status: status as AttendanceStatus,
    isVoided: flag(record.isVoided),
    note: text(record.note),
    recordedAt: optionalText(record.recordedAt),
    eventDateSnapshot: optionalText(record.eventDateSnapshot),
    componentIDSnapshot: optionalText(record.componentIDSnapshot),
    categoryIDSnapshot: optionalText(record.categoryIDSnapshot),
    countsAttendanceSnapshot: optionalFlag(record.countsAttendanceSnapshot),
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('corrupt-primary')
  return value as Record<string, unknown>
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new DomainError('corrupt-primary')
  return value
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new DomainError('corrupt-primary')
  return value
}

function optionalText(value: unknown): string | null {
  if (value == null) return null
  return text(value)
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new DomainError('corrupt-primary')
  return value
}

function optionalFlag(value: unknown): boolean | null {
  if (value == null) return null
  return flag(value)
}
