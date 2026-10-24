import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { startSmokeProcess, stopSmokeProcess } from './smoke-process.mjs'

async function until(condition) {
  const end = Date.now() + 5_000
  while (Date.now() < end) {
    if (await condition()) return
    await delay(20)
  }
  assert.fail('Synthetic child did not reach the expected state')
}

function alive(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { if (error.code === 'ESRCH') return false; throw error }
}

for (const leader of ['alive', 'exited']) {
  for (const resistant of [false, true]) {
    test(`cleanup stops ${leader} leader's ${resistant ? 'TERM-resistant' : 'ordinary'} descendant without touching another group`, { skip: process.platform === 'win32', timeout: 12_000 }, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'nexo-smoke-process-'))
      const marker = join(directory, 'grandchild-pid')
      const grandchild = `
        const { writeFileSync } = require('node:fs');
        ${resistant ? "process.on('SIGTERM', () => {});" : ''}
        writeFileSync(${JSON.stringify(marker)}, String(process.pid));
        setInterval(() => {}, 1000);
        setTimeout(() => process.exit(0), 10000).unref();
      `
      const parent = `
        const { spawn } = require('node:child_process');
        const { existsSync } = require('node:fs');
        spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();
        const ready = setInterval(() => {
          if (!existsSync(${JSON.stringify(marker)})) return;
          clearInterval(ready);
          ${leader === 'exited' ? 'process.exit(0);' : 'setInterval(() => {}, 1000);'}
        }, 10);
        setTimeout(() => process.exit(0), 10000).unref();
      `
      const owned = startSmokeProcess(process.execPath, ['-e', parent], directory)
      const sentinel = startSmokeProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], directory)
      let stopped = false
      let descendant
      try {
        await until(async () => {
          try { descendant = Number(await readFile(marker, 'utf8')); return Number.isInteger(descendant) && descendant > 1 }
          catch (error) { if (error.code === 'ENOENT') return false; throw error }
        })
        if (leader === 'exited') await until(() => owned.child.exitCode === 0)
        assert.equal(alive(descendant), true)
        assert.equal(alive(sentinel.child.pid), true)
        const began = Date.now()
        try { await stopSmokeProcess(owned) } finally { stopped = true }
        assert.ok(Date.now() - began < 5_000, 'Cleanup must have a bounded grace period')
        assert.equal(alive(descendant), false)
        assert.equal(owned.child.stdout.destroyed, true)
        assert.equal(owned.child.stderr.destroyed, true)
        assert.equal(alive(sentinel.child.pid), true, 'A separately owned group must remain alive')
      } finally {
        const cleanup = [stopSmokeProcess(sentinel)]
        if (!stopped) cleanup.push(stopSmokeProcess(owned))
        await Promise.allSettled(cleanup)
        // Only this fixture's recorded child, as a safety net for a failing regression.
        if (descendant && alive(descendant)) process.kill(descendant, 'SIGKILL')
        await rm(directory, { recursive: true, force: true })
      }
    })
  }
}

test('failed spawn cleans up without signaling a process group', { skip: process.platform === 'win32' }, async () => {
  const owned = startSmokeProcess('/nexo-synthetic-missing-command', [])
  await once(owned.child, 'error')
  assert.equal(owned.error.code, 'ENOENT')
  await stopSmokeProcess(owned)
  assert.equal(owned.child.stdout.destroyed, true)
  assert.equal(owned.child.stderr.destroyed, true)
})

test('cleanup refuses a process record it did not create', async () => {
  await assert.rejects(stopSmokeProcess({ child: { pid: process.pid } }), /unowned process/)
})
