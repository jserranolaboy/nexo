// Owned Unix process groups for the hosted browser smoke, not a general process killer.
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const ownedGroups = new WeakMap()

export function startSmokeProcess(command, args, cwd) {
  if (process.platform === 'win32') throw new Error('Browser smoke process isolation requires a Unix host')
  // Node's detached option creates our group; it does not disable the browser sandbox
  // or enable ChromeDriver's unrelated browser-detach capability.
  const child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const owned = { child, output: '', error: null }
  ownedGroups.set(owned, child.pid)
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (data) => { owned.output = (owned.output + data).slice(-12_000) })
  }
  child.on('error', (error) => { owned.error = error })
  return owned
}

export async function stopSmokeProcess(owned) {
  if (!ownedGroups.has(owned)) throw new Error('Refusing cleanup of an unowned process')
  const group = ownedGroups.get(owned)
  const { child } = owned
  const signal = (value) => {
    try { process.kill(-group, value); return true }
    catch (error) { if (error.code === 'ESRCH') return false; throw error }
  }
  const stillRunning = async () => {
    const end = Date.now() + 2_000
    while (Date.now() < end) {
      if (!signal(0)) return false
      await delay(25)
    }
    return signal(0)
  }
  try {
    // A failed spawn has no PID. Never signal 0, our own group, or a caller's PID.
    if (!Number.isInteger(group) || group <= 1) return
    if (!signal('SIGTERM')) return
    // The leader can exit first while descendants retain the output pipes.
    if (await stillRunning()) {
      signal('SIGKILL')
      if (await stillRunning()) throw new Error(`Owned smoke process group ${group} did not disappear`)
    }
  } finally {
    // Exit and closed stdio are different events. Bound Node's liveness even if
    // cleanup fails or a descendant has created a separate session of its own.
    child.stdout?.destroy()
    child.stderr?.destroy()
    child.unref()
    ownedGroups.delete(owned)
  }
}
