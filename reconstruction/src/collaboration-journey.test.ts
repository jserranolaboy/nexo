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
