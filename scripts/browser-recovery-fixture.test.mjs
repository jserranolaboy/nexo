import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { installRecoveryFixture } from './browser-recovery-fixture.mjs'

function fixture(origin = 'http://127.0.0.1:4173') {
  const window = {}
  window.top = window
  runInNewContext(`(${installRecoveryFixture.toString()})()`, { window, location: { origin }, structuredClone })
  return { window, control: window.__nexoRecoveryFixture, send: window.webkit?.messageHandlers.valentina.postMessage }
}

test('preload does not install a bridge outside the owned localhost origin', () => {
  const { window } = fixture('https://example.com')
  assert.equal(window.webkit, undefined)
  assert.equal(window.__nexoRecoveryFixture, undefined)
})

test('recovery is explicitly deferred, fails, and retries the same isolated draft', async () => {
  const { send, control } = fixture()
  const first = send({ command: 'recoverDraft' })
  assert.equal(control.inspect().pending, 1)
  control.settle('fail')
  await assert.rejects(first, /Synthetic temporary draft read failure/)
  const retry = send({ command: 'recoverDraft' })
  control.settle('recover')
  const draft = await retry
  assert.deepEqual(draft, control.inspect().recovery)
  draft.template.name = 'Changed caller copy'
  assert.equal(control.inspect().recovery.template.name, 'Synthetic recovered draft')
  assert.deepEqual(control.inspect().unexpected, [])
})

test('unexpected commands and premature or destructive draft writes fail closed', async () => {
  const { send, control } = fixture()
  await assert.rejects(send({ command: 'driveConnect' }), /Unexpected synthetic bridge command/)
  await assert.rejects(send({ command: 'draftState', dirty: false }), /before recovery completed/)
  const read = send({ command: 'recoverDraft' })
  control.settle('recover')
  await read
  await assert.rejects(send({ command: 'draftState', dirty: false }), /cleared or replaced/)
  assert.equal(control.inspect().unexpected.length, 3)
})

test('only a preserved dirty recovered draft can be persisted after recovery', async () => {
  const { send, control } = fixture()
  const read = send({ command: 'recoverDraft' })
  control.settle('recover')
  const draft = await read
  await send({ command: 'draftState', dirty: true, ...draft })
  const loaded = await send({ command: 'load' })
  assert.equal(loaded.drive.connected, false)
  assert.equal(loaded.drive.configured, false)
  assert.equal(loaded.snapshot.templates.length, 0)
  assert.deepEqual(control.inspect().unexpected, [])
})
