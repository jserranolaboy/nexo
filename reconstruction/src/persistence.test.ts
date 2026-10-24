import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { attendanceRate } from './attendance.ts'
import {
  addComponent,
  addPerson,
  createEncounter,
  createSpace,
  duplicateEncounter,
  linkCollaboration,
  recordAlternative,
  setAttendance,
} from './commands.ts'
import { DomainError } from './errors.ts'
import { describeJourney, SYNTHETIC } from './journey.ts'
import { emptyWorkspace } from './model.ts'
import { commit, DocumentDraftStore, FileWorkspaceStore, parseWorkspace } from './store.ts'
import { preflightText } from './documents.ts'

const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))

function directory(): string {
  return mkdtempSync(path.join(tmpdir(), 'nexo-synthetic-'))
}

test('the first journey survives a new process', () => {
  const home = directory()
  const created = spawnSync(process.execPath, ['--experimental-strip-types', cli, 'journey', '--directory', home, '--lang', 'es'], {
    encoding: 'utf8',
  })
  assert.equal(created.status, 0, created.stderr)
  const shown = spawnSync(process.execPath, ['--experimental-strip-types', cli, 'show', '--directory', home, '--lang', 'en'], {
    encoding: 'utf8',
  })
  assert.equal(shown.status, 0, shown.stderr)
  assert.match(shown.stdout, /Persona Alfa: present; 1\/1/)
  assert.match(shown.stdout, /Persona Beta: absent; 0\/1/)
  assert.match(shown.stdout, /Persona Gamma: no record; no countable encounters/)
  const spanish = describeJourney(home, 'es')
  assert.match(spanish, /Persona Alfa: presente; 1\/1/)
  assert.match(spanish, /Persona Gamma: sin registro; sin encuentros evaluables/)
  const restored = new FileWorkspaceStore(home).load()
  assert.equal(restored.schema, 'nexo-reconstruction-v1')
  assert.equal(restored.revision, 1)
  assert.equal(restored.spaces[0].timeZone, 'Etc/UTC')
  assert.equal(attendanceRate(restored, SYNTHETIC.gammaId, SYNTHETIC.periodId).ratio, null)
  assert.equal(restored.attendance.length, 2)
})

test('a stale write is rejected and a later collaboration failure keeps the local save', () => {
  const home = directory()
  const store = new FileWorkspaceStore(home)
  let workspace = store.initialize(emptyWorkspace())
  workspace = createSpace(workspace, { name: 'Espacio sintético', timeZone: 'Etc/UTC' })
  const saved = store.save(workspace, 0)
  const bytes = readFileSync(store.primaryPath())
  assert.throws(
    () => store.save(workspace, 0),
    (error: unknown) => error instanceof DomainError && error.code === 'stale-revision',
  )
  assert.deepEqual(readFileSync(store.primaryPath()), bytes)
  const renamed = createSpace(saved, { id: '99999999-9999-4999-8999-999999999999', name: 'Otro espacio', timeZone: 'Etc/UTC' })
  const committed = commit(store, renamed, saved.revision, () => {
    throw new Error('drive status unavailable')
  })
  assert.equal(committed.collaborationError, 'drive status unavailable')
  assert.equal(store.load().revision, saved.revision + 1)
  assert.equal(store.load().spaces.length, 2)
})

test('corrupt bytes are kept and a restore invalidates the previous writer', () => {
  const home = directory()
  const store = new FileWorkspaceStore(home)
  const initial = store.initialize(emptyWorkspace())
  const saved = store.save(createSpace(initial, { name: 'Espacio sintético', timeZone: 'Etc/UTC' }), 0)
  const backup = path.join(home, 'synthetic-copy.json')
  writeFileSync(backup, readFileSync(store.primaryPath()))
  const second = store.save(createSpace(saved, { id: '99999999-9999-4999-8999-999999999999', name: 'Segundo', timeZone: 'Etc/UTC' }), saved.revision)
  const beforeRestore = readFileSync(store.primaryPath())
  const restored = store.restore(backup)
  assert.ok(restored.revision > second.revision)
  assert.equal(restored.spaces.length, 1)
  assert.throws(
    () => store.save(second, second.revision),
    (error: unknown) => error instanceof DomainError && error.code === 'stale-revision',
  )
  const quarantine = readFileSync(path.join(home, 'quarantine', readdirSync(path.join(home, 'quarantine'))[0]))
  assert.deepEqual(quarantine, beforeRestore)
  writeFileSync(store.primaryPath(), Buffer.from('{'))
  const damaged = readFileSync(store.primaryPath())
  assert.throws(() => store.load(), (error: unknown) => error instanceof DomainError && error.code === 'corrupt-primary')
  assert.throws(() => store.save(restored, restored.revision), (error: unknown) => error instanceof DomainError && error.code === 'corrupt-primary')
  assert.throws(() => store.initialize(emptyWorkspace()), (error: unknown) => error instanceof DomainError && error.code === 'already-initialized')
  assert.deepEqual(readFileSync(store.primaryPath()), damaged)
})

test('an empty workspace does not replace retained bytes', () => {
  const home = directory()
  mkdirSync(path.join(home, 'revision-copies'))
  writeFileSync(path.join(home, 'revision-copies', 'revision-4-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'), '{')
  const store = new FileWorkspaceStore(home)
  assert.throws(
    () => store.initialize(emptyWorkspace()),
    (error: unknown) => error instanceof DomainError && error.code === 'refuse-empty-replacement',
  )
  assert.equal(readFileSync(path.join(home, 'revision-copies', 'revision-4-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'), 'utf8'), '{')
})

test('document drafts stay outside workspace backups', () => {
  const home = directory()
  const store = new FileWorkspaceStore(home)
  store.initialize(emptyWorkspace())
  const drafts = new DocumentDraftStore(home)
  const marker = 'BORRADOR-SINTETICO que no entra en la copia del espacio'
  drafts.save(marker)
  assert.equal(drafts.read(), marker)
  assert.equal(readFileSync(store.primaryPath(), 'utf8').includes(marker), false)
  assert.equal(drafts.path().includes(`${path.sep}revision-copies${path.sep}`), false)
  assert.equal(drafts.path().includes(`${path.sep}document-drafts${path.sep}`), true)
})

test('collaboration keeps alternatives and restore does not enqueue an upload', () => {
  const home = directory()
  const store = new FileWorkspaceStore(home)
  let workspace = store.initialize(emptyWorkspace())
  workspace = createSpace(workspace, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', name: 'Espacio sintético', timeZone: 'Etc/UTC' })
  workspace = linkCollaboration(workspace, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', ['queued-change'])
  workspace = recordAlternative(workspace, {
    spaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    key: 'encounter:1',
    version: { id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', value: 'local' },
  })
  workspace = recordAlternative(workspace, {
    spaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    key: 'encounter:1',
    version: { id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', value: 'remote' },
  })
  const saved = store.save(workspace, 0)
  const versions = saved.collaboration[0].entries[0].versions.map((item) => item.value)
  assert.deepEqual(versions, ['local', 'remote'])
  const copy = path.join(home, 'paused-copy.json')
  writeFileSync(copy, readFileSync(store.primaryPath()))
  const restored = store.restore(copy)
  assert.equal(restored.collaboration[0].paused, true)
  assert.deepEqual(restored.collaboration[0].pendingUploads, ['queued-change'])
  assert.deepEqual(restored.collaboration[0].entries[0].versions.map((item) => item.value), ['local', 'remote'])
})

test('duplicating an encounter commits the new pending roster in one revision', () => {
  const home = directory()
  const store = new FileWorkspaceStore(home)
  let workspace = store.initialize(emptyWorkspace())
  const space = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  const person = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
  const component = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
  const encounter = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
  workspace = createSpace(workspace, { id: space, name: 'Espacio sintético', timeZone: 'Etc/UTC' })
  workspace = addPerson(workspace, { id: person, spaceId: space, name: 'Persona Alfa' })
  workspace = addComponent(workspace, { id: component, spaceId: space, name: 'Componente' })
  workspace = createEncounter(workspace, {
    id: encounter,
    spaceId: space,
    title: 'Encuentro',
    startsAt: '2026-03-01T00:00:00.000Z',
    componentId: component,
    personIds: [person],
  })
  workspace = setAttendance(workspace, {
    encounterId: encounter,
    personId: person,
    status: 'present',
    note: 'marca original',
    recordedAt: '2026-03-01T00:05:00.000Z',
  })
  const saved = store.save(workspace, 0)
  const copy = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
  const duplicated = duplicateEncounter(saved, { sourceId: encounter, id: copy, startsAt: '2026-03-08T00:00:00.000Z' })
  const committed = store.save(duplicated, saved.revision)
  assert.equal(committed.revision, saved.revision + 1)
  const rows = committed.attendance.filter((row) => row.encounterId === copy)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'pending')
  assert.equal(rows[0].note, '')
  assert.equal(committed.attendance.find((row) => row.encounterId === encounter)?.status, 'present')
  assert.equal(store.load().revision, committed.revision)
})

test('legacy workspace and VRR files are rejected without migration', () => {
  assert.throws(
    () => parseWorkspace('{"schemaVersion":1,"revision":0}'),
    (error: unknown) => error instanceof DomainError && error.code === 'unsupported-schema',
  )
  assert.throws(
    () => parseWorkspace('{"kind":"vrr-data"}'),
    (error: unknown) => error instanceof DomainError && error.code === 'unsupported-schema',
  )
})

test('text that does not fit is reported whole', () => {
  const note = 'Linea uno\nLinea dos\nLinea tres'
  const report = preflightText([{ id: 'note', text: note }], { width: 8, height: 2 })
  assert.equal(report.fits, false)
  assert.equal(report.problems[0].text, note)
  assert.equal(report.blocks[0].text, note)
  const home = directory()
  const store = new FileWorkspaceStore(home)
  let workspace = store.initialize(emptyWorkspace())
  workspace = createSpace(workspace, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', name: 'Espacio sintético', timeZone: 'Etc/UTC' })
  workspace = addComponent(workspace, { id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', spaceId: workspace.spaces[0].id, name: 'Componente' })
  workspace = addPerson(workspace, { id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', spaceId: workspace.spaces[0].id, name: 'Persona Alfa' })
  workspace = createEncounter(workspace, {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    spaceId: workspace.spaces[0].id,
    title: 'Encuentro',
    startsAt: '2026-03-01T00:00:00.000Z',
    componentId: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    personIds: ['cccccccc-cccc-4ccc-8ccc-ccccccccccc1'],
  })
  workspace = setAttendance(workspace, {
    encounterId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    personId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    status: 'present',
    note,
    recordedAt: '2026-03-01T00:05:00.000Z',
  })
  assert.equal(workspace.attendance[0].note, note)
})
