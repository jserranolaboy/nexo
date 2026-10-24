import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { draftFromUnknown, layoutDocument, type DocumentDraft, type ExportResult } from './documents.ts'
import { DomainError } from './errors.ts'
import type {
  Attendance,
  AttendanceStatus,
  CollaborationLink,
  Component,
  Encounter,
  Group,
  Membership,
  Period,
  Person,
  Space,
  Volunteer,
  VolunteerStatus,
  Workspace,
} from './model.ts'
import { SCHEMA } from './model.ts'
import { validate } from './validate.ts'

const ATTENDANCE: readonly AttendanceStatus[] = ['pending', 'present', 'absent', 'excused']
const VOLUNTEER: readonly VolunteerStatus[] = ['interested', 'selected', 'declined', 'completed', 'noShow']

export class FileWorkspaceStore {
  readonly directory: string

  constructor(directory: string) {
    this.directory = directory
  }

  primaryPath(): string {
    return path.join(this.directory, 'nexo-reconstruction-v1.json')
  }

  revisionCopies(): string {
    return path.join(this.directory, 'revision-copies')
  }

  initialize(proposed: Workspace): Workspace {
    return this.locked(() => {
      if (existsSync(this.primaryPath())) throw new DomainError('already-initialized')
      if (this.copyNames().length > 0) throw new DomainError('refuse-empty-replacement')
      if (proposed.revision !== 0) throw new DomainError('invalid-revision')
      validate(proposed)
      const bytes = encode(proposed)
      this.writePrimary(bytes)
      return parseWorkspace(bytes.toString('utf8'))
    })
  }

  load(): Workspace {
    const raw = this.readPrimary()
    const workspace = parseWorkspace(raw.toString('utf8'))
    try {
      validate(workspace)
    } catch (error) {
      if (error instanceof DomainError && error.code === 'unsupported-schema') throw error
      throw new DomainError('corrupt-primary')
    }
    return workspace
  }

  save(proposed: Workspace, expectedRevision: number): Workspace {
    return this.locked(() => {
      const currentBytes = this.readPrimary()
      const current = this.load()
      if (current.revision !== expectedRevision) throw new DomainError('stale-revision')
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw new DomainError('revision-exhausted')
      const next: Workspace = { ...structuredClone(proposed), schema: SCHEMA, schemaVersion: 1, revision: current.revision + 1 }
      validate(next)
      const bytes = encode(next)
      validate(parseWorkspace(bytes.toString('utf8')))
      this.keepCopy(currentBytes, current.revision)
      this.keepCopy(bytes, next.revision)
      this.writePrimary(bytes)
      return parseWorkspace(bytes.toString('utf8'))
    })
  }

  restore(copyPath: string): Workspace {
    return this.locked(() => {
      const recovered = parseWorkspace(readFileSync(copyPath).toString('utf8'))
      validate(recovered)
      const primaryBytes = existsSync(this.primaryPath()) ? readFileSync(this.primaryPath()) : null
      let primaryRevision = -1
      if (primaryBytes) {
        try {
          primaryRevision = parseWorkspace(primaryBytes.toString('utf8')).revision
        } catch {
          primaryRevision = -1
        }
      }
      const highest = Math.max(recovered.revision, primaryRevision, this.highestCopyRevision())
      if (highest >= Number.MAX_SAFE_INTEGER) throw new DomainError('revision-exhausted')
      const next = structuredClone(recovered)
      next.revision = highest + 1
      for (const link of next.collaboration) link.paused = true
      validate(next)
      const bytes = encode(next)
      if (primaryBytes) {
        const quarantine = path.join(this.directory, 'quarantine')
        mkdirSync(quarantine, { recursive: true })
        writeFileSync(path.join(quarantine, `pre-restore-${randomUUID()}.json`), primaryBytes)
      }
      this.keepCopy(bytes, next.revision)
      this.writePrimary(bytes)
      return parseWorkspace(bytes.toString('utf8'))
    })
  }

  private readPrimary(): Buffer {
    if (!existsSync(this.primaryPath())) throw new DomainError('missing-primary')
    return readFileSync(this.primaryPath())
  }

  private writePrimary(bytes: Buffer): void {
    mkdirSync(this.directory, { recursive: true })
    const temporary = path.join(this.directory, `.primary-${randomUUID()}.tmp`)
    writeFileSync(temporary, bytes)
    renameSync(temporary, this.primaryPath())
  }

  private keepCopy(bytes: Buffer, revision: number): void {
    mkdirSync(this.revisionCopies(), { recursive: true })
    writeFileSync(path.join(this.revisionCopies(), `revision-${revision}-${randomUUID()}.json`), bytes)
  }

  private copyNames(): string[] {
    if (!existsSync(this.revisionCopies())) return []
    return readdirSync(this.revisionCopies()).filter((name) => name.endsWith('.json'))
  }

  private highestCopyRevision(): number {
    let highest = -1
    for (const name of this.copyNames()) {
      const match = /^revision-(\d+)-/.exec(name)
      if (!match) continue
      highest = Math.max(highest, Number(match[1]))
    }
    return highest
  }

  private locked<T>(action: () => T): T {
    mkdirSync(this.directory, { recursive: true })
    const lockPath = path.join(this.directory, '.write.lock')
    const descriptor = acquire(lockPath)
    try {
      return action()
    } finally {
      closeSync(descriptor)
      unlinkSync(lockPath)
    }
  }
}

export function readImport(raw: string): Workspace {
  const workspace = parseWorkspace(raw)
  validate(workspace)
  return workspace
}

export function commit(
  store: FileWorkspaceStore,
  proposed: Workspace,
  expectedRevision: number,
  afterCommit?: () => void,
): { workspace: Workspace; collaborationError: string | null } {
  const workspace = store.save(proposed, expectedRevision)
  if (!afterCommit) return { workspace, collaborationError: null }
  try {
    afterCommit()
    return { workspace, collaborationError: null }
  } catch (error) {
    return {
      workspace,
      collaborationError: error instanceof Error ? error.message : String(error),
    }
  }
}

export class DocumentDraftStore {
  readonly directory: string

  constructor(directory: string) {
    this.directory = directory
  }

  path(): string {
    return path.join(this.directory, 'document-drafts', 'draft.json')
  }

  save(text: string): void {
    if (this.path().includes(`${path.sep}revision-copies${path.sep}`)) {
      throw new DomainError('draft-in-backup')
    }
    mkdirSync(path.dirname(this.path()), { recursive: true })
    const temporary = `${this.path()}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify({ text }))
    renameSync(temporary, this.path())
  }

  read(): string | null {
    if (!existsSync(this.path())) return null
    const parsed: unknown = JSON.parse(readFileSync(this.path(), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || !('text' in parsed) || typeof parsed.text !== 'string') {
      throw new DomainError('invalid-draft')
    }
    return parsed.text
  }

  documentPath(): string {
    return path.join(this.directory, 'document-drafts', 'document.json')
  }

  exportPath(): string {
    return path.join(this.directory, 'document-drafts', 'export.json')
  }

  saveDocument(draft: DocumentDraft): DocumentDraft {
    const saved = draftFromUnknown(draft)
    this.writeAside(this.documentPath(), { kind: 'nexo-reconstruction-document-draft', ...saved })
    return saved
  }

  readDocument(): DocumentDraft | null {
    if (!existsSync(this.documentPath())) return null
    const parsed: unknown = JSON.parse(readFileSync(this.documentPath(), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || !('kind' in parsed) || parsed.kind !== 'nexo-reconstruction-document-draft') {
      throw new DomainError('invalid-draft')
    }
    return draftFromUnknown(parsed)
  }

  /**
   * Writes the page record only when every page fits.
   * A refusal leaves any previous export bytes in place and does not trim the draft.
   */
  exportDocument(draft: DocumentDraft): ExportResult {
    const result = layoutDocument(draft)
    if (!result.fits || !result.document) return result
    this.writeAside(this.exportPath(), { kind: 'nexo-reconstruction-document-export', pages: result.document.pages })
    return result
  }

  private writeAside(filePath: string, value: unknown): void {
    if (filePath.includes(`${path.sep}revision-copies${path.sep}`)) throw new DomainError('draft-in-backup')
    mkdirSync(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${randomUUID()}.tmp`
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
    renameSync(temporary, filePath)
  }
}

export function parseWorkspace(raw: string): Workspace {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new DomainError('corrupt-primary')
  }
  const record = recordOf(value)
  if (record.schema !== SCHEMA || record.schemaVersion !== 1) throw new DomainError('unsupported-schema')
  return {
    schema: SCHEMA,
    schemaVersion: 1,
    revision: integer(record.revision),
    spaces: array(record.spaces).map(spaceOf),
    periods: array(record.periods).map(periodOf),
    people: array(record.people).map(personOf),
    groups: array(record.groups).map(groupOf),
    memberships: array(record.memberships).map(membershipOf),
    components: array(record.components).map(componentOf),
    encounters: array(record.encounters).map(encounterOf),
    attendance: array(record.attendance).map(attendanceOf),
    volunteers: array(record.volunteers).map(volunteerOf),
    collaboration: array(record.collaboration).map(linkOf),
  }
}

function encode(workspace: Workspace): Buffer {
  return Buffer.from(`${JSON.stringify(sortKeys(workspace), null, 2)}\n`, 'utf8')
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) sorted[key] = sortKeys((value as Record<string, unknown>)[key])
  return sorted
}

function acquire(lockPath: string): number {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const descriptor = openSync(lockPath, 'wx')
      writeFileSync(descriptor, String(process.pid))
      return descriptor
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error
      const owner = Number(readFileSync(lockPath, 'utf8'))
      if (Number.isInteger(owner) && owner > 0 && !processAlive(owner)) {
        unlinkSync(lockPath)
        continue
      }
      const until = Date.now() + 20
      while (Date.now() < until) {
        /* wait for the other writer */
      }
    }
  }
  throw new DomainError('write-lock-unavailable')
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
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

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new DomainError('corrupt-primary')
  return value
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new DomainError('corrupt-primary')
  return value
}

function nullableText(value: unknown): string | null {
  if (value == null) return null
  return text(value)
}

function spaceOf(value: unknown): Space {
  const record = recordOf(value)
  return { id: text(record.id), name: text(record.name), timeZone: text(record.timeZone) }
}

function periodOf(value: unknown): Period {
  const record = recordOf(value)
  return {
    id: text(record.id),
    spaceId: text(record.spaceId),
    name: text(record.name),
    startsAt: text(record.startsAt),
    endsAt: text(record.endsAt),
  }
}

function personOf(value: unknown): Person {
  const record = recordOf(value)
  return { id: text(record.id), spaceId: text(record.spaceId), name: text(record.name), active: flag(record.active) }
}

function groupOf(value: unknown): Group {
  const record = recordOf(value)
  return { id: text(record.id), spaceId: text(record.spaceId), name: text(record.name) }
}

function membershipOf(value: unknown): Membership {
  const record = recordOf(value)
  return {
    id: text(record.id),
    personId: text(record.personId),
    groupId: text(record.groupId),
    startsAt: text(record.startsAt),
    endsAt: nullableText(record.endsAt),
  }
}

function componentOf(value: unknown): Component {
  const record = recordOf(value)
  return { id: text(record.id), spaceId: text(record.spaceId), name: text(record.name) }
}

function encounterOf(value: unknown): Encounter {
  const record = recordOf(value)
  const capacity = record.volunteerCapacity
  if (capacity != null && (typeof capacity !== 'number' || !Number.isSafeInteger(capacity))) {
    throw new DomainError('corrupt-primary')
  }
  return {
    id: text(record.id),
    spaceId: text(record.spaceId),
    title: text(record.title),
    startsAt: text(record.startsAt),
    componentId: text(record.componentId),
    categoryId: nullableText(record.categoryId),
    countsAttendance: flag(record.countsAttendance),
    cancelled: flag(record.cancelled),
    volunteerCapacity: capacity ?? null,
  }
}

function attendanceOf(value: unknown): Attendance {
  const record = recordOf(value)
  const status = text(record.status)
  if (!ATTENDANCE.includes(status as AttendanceStatus)) throw new DomainError('corrupt-primary')
  return {
    id: text(record.id),
    encounterId: text(record.encounterId),
    personId: text(record.personId),
    status: status as AttendanceStatus,
    voided: flag(record.voided),
    note: text(record.note),
    recordedAt: nullableText(record.recordedAt),
    eventInstant: text(record.eventInstant),
    componentId: text(record.componentId),
    categoryId: nullableText(record.categoryId),
    countsAttendance: flag(record.countsAttendance),
  }
}

function volunteerOf(value: unknown): Volunteer {
  const record = recordOf(value)
  const status = text(record.status)
  if (!VOLUNTEER.includes(status as VolunteerStatus)) throw new DomainError('corrupt-primary')
  return {
    id: text(record.id),
    encounterId: text(record.encounterId),
    personId: text(record.personId),
    status: status as VolunteerStatus,
    registeredAt: text(record.registeredAt),
  }
}

function linkOf(value: unknown): CollaborationLink {
  const record = recordOf(value)
  return {
    spaceId: text(record.spaceId),
    paused: flag(record.paused),
    pendingUploads: array(record.pendingUploads).map(text),
    entries: array(record.entries).map((entry) => {
      const item = recordOf(entry)
      return {
        key: text(item.key),
        versions: array(item.versions).map((version) => {
          const alternative = recordOf(version)
          return { id: text(alternative.id), value: text(alternative.value) }
        }),
      }
    }),
  }
}
