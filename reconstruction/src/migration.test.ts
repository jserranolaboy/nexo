import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createSpace } from './commands.ts'
import { DomainError } from './errors.ts'
import { emptyWorkspace } from './model.ts'
import { migrateLegacyFile, PREVIOUS_COPY } from './migrate.ts'
import { FileWorkspaceStore } from './store.ts'

const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))

const IDS = {
  space: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  alfa: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  gamma: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  beta: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  component: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  encounter: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  attendance: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
  missing: 'ffffffff-ffff-4fff-8fff-fffffffffff2',
} as const

test('a synthetic workspace migrates without rewriting the original bytes', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'nexo-migracion-'))
  const source = writeLegacy(home, 'origen', legacyBody())
  const original = readFileSync(source)
  const created = spawnSync(
    process.execPath,
    ['--experimental-strip-types', cli, 'migrate', '--directory', home, '--source', source, '--lang', 'es'],
    { encoding: 'utf8' },
  )
  assert.equal(created.status, 0, created.stderr)
  assert.match(created.stdout, /Migración comprobada/)
  assert.deepEqual(readFileSync(source), original)

  const shown = spawnSync(
    process.execPath,
    ['--experimental-strip-types', cli, 'show', '--directory', home, '--lang', 'es'],
    { encoding: 'utf8' },
  )
  assert.equal(shown.status, 0, shown.stderr)
  assert.match(shown.stdout, /Persona Alfa: presente; 1\/1/)
  assert.match(shown.stdout, /Persona Gamma: sin registro; sin encuentros evaluables/)

  const store = new FileWorkspaceStore(home)
  const workspace = store.load()
  assert.equal(workspace.schema, 'nexo-reconstruction-v1')
  assert.equal(workspace.people.length, 2)
  assert.equal(workspace.encounters.length, 1)
  assert.equal(workspace.encounters[0].title, 'Encuentro sintético')
  assert.equal(workspace.encounters[0].startsAt, '2026-03-01T00:00:00.000Z')
  assert.equal(workspace.attendance.length, 1)
  assert.equal(workspace.attendance[0].status, 'present')
  assert.equal(workspace.attendance[0].note, 'nota sintética')
  assert.equal(workspace.attendance[0].personId, IDS.alfa)
  assert.equal(
    workspace.attendance.some((row) => row.personId === IDS.gamma),
    false,
  )
  const text = readFileSync(store.primaryPath(), 'utf8')
  assert.equal(/oauth|googleapis|driveReplicas|vrr-data/i.test(text), false)
  assert.deepEqual(readFileSync(source), original)
})

test('a failed check keeps the previous new file and does not install an empty one', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'nexo-migracion-'))
  const store = new FileWorkspaceStore(home)
  const kept = store.save(createSpace(store.initialize(emptyWorkspace()), { name: 'Conservado', timeZone: 'Etc/UTC' }), 0)
  const before = readFileSync(store.primaryPath())
  assert.equal(kept.spaces[0].name, 'Conservado')

  const broken = writeLegacy(home, 'roto', legacyBody({ memberID: IDS.missing }))
  const rejected = spawnSync(
    process.execPath,
    ['--experimental-strip-types', cli, 'migrate', '--directory', home, '--source', broken, '--lang', 'es'],
    { encoding: 'utf8' },
  )
  assert.notEqual(rejected.status, 0)
  assert.deepEqual(readFileSync(store.primaryPath()), before)
  assert.equal(store.load().spaces[0].name, 'Conservado')
  assert.equal(store.load().people.length > 0 || store.load().spaces.length === 1, true)

  const fresh = mkdtempSync(path.join(tmpdir(), 'nexo-migracion-'))
  const source = writeLegacy(fresh, 'origen', legacyBody())
  assert.throws(
    () => migrateLegacyFile(fresh, source, () => {
      throw new DomainError('migration-rejected')
    }),
    (error: unknown) => error instanceof DomainError && error.code === 'migration-rejected',
  )
  assert.equal(existsPrimary(fresh), false)

  assert.throws(
    () => migrateLegacyFile(home, writeLegacy(home, 'sello', legacyBody()), () => {
      throw new DomainError('migration-rejected')
    }),
    (error: unknown) => error instanceof DomainError && error.code === 'migration-rejected',
  )
  assert.deepEqual(readFileSync(store.primaryPath()), before)
  assert.notEqual(store.load().spaces.length, 0)
})

test('revert restores the previous new copy', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'nexo-migracion-'))
  const first = writeLegacy(home, 'origen', legacyBody())
  const second = writeLegacy(home, 'otro', legacyBody({ personId: IDS.beta, personName: 'Persona Beta', includeGamma: false }))
  const firstBytes = readFileSync(first)
  const secondBytes = readFileSync(second)
  const created = spawnSync(
    process.execPath,
    ['--experimental-strip-types', cli, 'migrate', '--directory', home, '--source', first, '--lang', 'es'],
    { encoding: 'utf8' },
  )
  assert.equal(created.status, 0, created.stderr)
  const previous = readFileSync(new FileWorkspaceStore(home).primaryPath())
  const replaced = spawnSync(
    process.execPath,
    ['--experimental-strip-types', cli, 'migrate', '--directory', home, '--source', second, '--lang', 'es'],
    { encoding: 'utf8' },
  )
  assert.equal(replaced.status, 0, replaced.stderr)
  assert.equal(new FileWorkspaceStore(home).load().people[0].name, 'Persona Beta')
  assert.deepEqual(readFileSync(path.join(home, PREVIOUS_COPY)), previous)
  const reverted = spawnSync(
    process.execPath,
    ['--experimental-strip-types', cli, 'migrate-revert', '--directory', home, '--lang', 'es'],
    { encoding: 'utf8' },
  )
  assert.equal(reverted.status, 0, reverted.stderr)
  assert.match(reverted.stdout, /Copia nueva anterior restaurada/)
  assert.deepEqual(readFileSync(new FileWorkspaceStore(home).primaryPath()), previous)
  assert.equal(new FileWorkspaceStore(home).load().people.some((person) => person.name === 'Persona Alfa'), true)
  assert.deepEqual(readFileSync(first), firstBytes)
  assert.deepEqual(readFileSync(second), secondBytes)
})

test('vrr data and Application Support are refused', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'nexo-migracion-'))
  const vrr = path.join(home, 'vrr-data.json')
  mkdirSync(home, { recursive: true })
  writeFile(vrr, '{"kind":"vrr-data"}\n')
  assert.throws(
    () => migrateLegacyFile(home, vrr),
    (error: unknown) => error instanceof DomainError && error.code === 'unsupported-schema',
  )
  const disguised = writeLegacy(home, 'alfa', { kind: 'vrr-data' })
  assert.throws(
    () => migrateLegacyFile(home, disguised),
    (error: unknown) => error instanceof DomainError && error.code === 'unsupported-schema',
  )
  const blocked = path.join(home, 'Application Support', 'Nexo')
  mkdirSync(blocked, { recursive: true })
  const blockedFile = path.join(blocked, 'workspace-v1.json')
  writeFile(blockedFile, '{"kind":"vrr-data"}\n')
  assert.throws(
    () => migrateLegacyFile(home, blockedFile),
    (error: unknown) => error instanceof DomainError && error.code === 'refused-location',
  )
  assert.equal(existsPrimary(home), false)
  assert.equal(readFileSync(blockedFile, 'utf8'), '{"kind":"vrr-data"}\n')
})

function existsPrimary(directory: string): boolean {
  try {
    readFileSync(new FileWorkspaceStore(directory).primaryPath())
    return true
  } catch {
    return false
  }
}

function writeLegacy(directory: string, folder: string, body: unknown): string {
  const target = path.join(directory, folder)
  mkdirSync(target, { recursive: true })
  const file = path.join(target, 'workspace-v1.json')
  writeFile(file, JSON.stringify(body))
  return file
}

function writeFile(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function legacyBody(options?: {
  personId?: string
  personName?: string
  includeGamma?: boolean
  memberID?: string
}): Record<string, unknown> {
  const personId = options?.personId ?? IDS.alfa
  const personName = options?.personName ?? 'Persona Alfa'
  const members = [
    { id: personId, organizationID: IDS.space, name: personName, isActive: true },
    ...(options?.includeGamma === false
      ? []
      : [{ id: IDS.gamma, organizationID: IDS.space, name: 'Persona Gamma', isActive: true }]),
  ]
  return {
    schemaVersion: 1,
    revision: 3,
    organizations: [{ id: IDS.space, name: 'Espacio sintético', accentHex: '#315EAD', timeZoneIdentifier: 'Etc/UTC', deletedAt: null }],
    periods: [],
    members,
    groups: [],
    memberships: [],
    components: [{ id: IDS.component, organizationID: IDS.space, name: 'Componente' }],
    categories: [],
    events: [
      {
        id: IDS.encounter,
        organizationID: IDS.space,
        title: 'Encuentro sintético',
        startsAt: '2026-03-01T00:00:00Z',
        componentID: IDS.component,
        categoryID: null,
        countsAttendance: true,
        isCancelled: false,
        volunteerCapacity: null,
      },
    ],
    attendance: [
      {
        id: IDS.attendance,
        eventID: IDS.encounter,
        memberID: options?.memberID ?? personId,
        status: 'present',
        isVoided: false,
        note: 'nota sintética',
        recordedAt: '2026-03-01T00:05:00Z',
        eventDateSnapshot: '2026-03-01T00:00:00Z',
        componentIDSnapshot: IDS.component,
        categoryIDSnapshot: null,
        countsAttendanceSnapshot: true,
      },
    ],
    volunteers: [],
    collaborators: [],
    templates: [],
    syncStates: [],
    driveReplicas: [],
    resolvedSyncConflicts: [],
  }
}
