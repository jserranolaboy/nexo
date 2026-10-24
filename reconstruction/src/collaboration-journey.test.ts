import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { COLLABORATION, describeCollaboration } from './collaboration-journey.ts'
import { DomainError } from './errors.ts'
import { FileWorkspaceStore } from './store.ts'

const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))

test('a local save survives a failed sync port, a stale write, and a paused restore', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'nexo-colaboracion-'))
  const created = spawnSync(
    process.execPath,
    ['--experimental-strip-types', cli, 'collaborate', '--directory', home, '--lang', 'es'],
    { encoding: 'utf8' },
  )
  assert.equal(created.status, 0, created.stderr)
  assert.match(created.stdout, /Guardado local conservado/)
  assert.match(created.stdout, /sync port unavailable/)

  const english = spawnSync(
    process.execPath,
    ['--experimental-strip-types', cli, 'collaborate-show', '--directory', home, '--lang', 'en'],
    { encoding: 'utf8' },
  )
  assert.equal(english.status, 0, english.stderr)
  assert.match(english.stdout, /Sync: paused/)
  assert.match(english.stdout, /Pending uploads: none/)
  assert.match(english.stdout, /alternativa-local/)
  assert.match(english.stdout, /alternativa-remota/)
  assert.equal(describeCollaboration(home, 'es').includes('Sincronización: en pausa'), true)
  assert.equal(describeCollaboration(home, 'es').includes('Subidas pendientes: ninguna'), true)

  const store = new FileWorkspaceStore(home)
  const bytes = readFileSync(store.primaryPath())
  const text = bytes.toString('utf8')
  assert.equal(/oauth|client_secret|googleapis|refresh_token/i.test(text), false)
  const workspace = store.load()
  assert.equal(workspace.spaces[0].id, COLLABORATION.spaceId)
  assert.equal(workspace.collaboration[0].paused, true)
  assert.deepEqual(workspace.collaboration[0].pendingUploads, [])
  assert.deepEqual(
    workspace.collaboration[0].entries[0].versions.map((version) => version.value),
    [COLLABORATION.localValue, COLLABORATION.remoteValue],
  )
  assert.ok(workspace.revision > 1)
  assert.throws(
    () => store.save(workspace, 0),
    (error: unknown) => error instanceof DomainError && error.code === 'stale-revision',
  )
  assert.deepEqual(readFileSync(store.primaryPath()), bytes)
  assert.deepEqual(
    store.load().collaboration[0].entries[0].versions.map((version) => version.value),
    [COLLABORATION.localValue, COLLABORATION.remoteValue],
  )
})

test('choosing one alternative drops the other and leaves the upload queue empty', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'nexo-colaboracion-'))
  const created = spawnSync(
    process.execPath,
    ['--experimental-strip-types', cli, 'collaborate', '--directory', home, '--lang', 'es'],
    { encoding: 'utf8' },
  )
  assert.equal(created.status, 0, created.stderr)
  const store = new FileWorkspaceStore(home)
  const before = store.load()
  const bytes = readFileSync(store.primaryPath())
  const rejected = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      cli,
      'collaborate-choose',
      '--directory',
      home,
      '--version',
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc9',
      '--lang',
      'es',
    ],
    { encoding: 'utf8' },
  )
  assert.notEqual(rejected.status, 0)
  assert.deepEqual(readFileSync(store.primaryPath()), bytes)

  const chosen = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      cli,
      'collaborate-choose',
      '--directory',
      home,
      '--version',
      COLLABORATION.localId,
      '--lang',
      'es',
    ],
    { encoding: 'utf8' },
  )
  assert.equal(chosen.status, 0, chosen.stderr)
  assert.match(chosen.stdout, /Alternativa elegida/)
  assert.match(chosen.stdout, /alternativa-local/)
  assert.equal(chosen.stdout.includes(COLLABORATION.remoteValue), false)

  const after = store.load()
  assert.equal(after.revision, before.revision + 1)
  assert.equal(after.collaboration[0].paused, true)
  assert.deepEqual(after.collaboration[0].pendingUploads, [])
  assert.deepEqual(
    after.collaboration[0].entries[0].versions.map((version) => version.value),
    [COLLABORATION.localValue],
  )
  const text = readFileSync(store.primaryPath(), 'utf8')
  assert.equal(text.includes(COLLABORATION.localValue), true)
  assert.equal(text.includes(COLLABORATION.localId), true)
  assert.equal(text.includes(COLLABORATION.remoteValue), false)
  assert.equal(text.includes(COLLABORATION.remoteId), false)
  assert.equal(/oauth|client_secret|googleapis|refresh_token/i.test(text), false)

  const shown = spawnSync(
    process.execPath,
    ['--experimental-strip-types', cli, 'collaborate-show', '--directory', home, '--lang', 'en'],
    { encoding: 'utf8' },
  )
  assert.equal(shown.status, 0, shown.stderr)
  assert.match(shown.stdout, /Sync: paused/)
  assert.match(shown.stdout, /Pending uploads: none/)
  assert.match(shown.stdout, /alternativa-local/)
  assert.equal(shown.stdout.includes(COLLABORATION.remoteValue), false)
})
