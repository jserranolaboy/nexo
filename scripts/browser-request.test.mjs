import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

// Evaluate only the real request function, never the browser-launching script.
const source = readFileSync(new URL('./browser-smoke.mjs', import.meta.url), 'utf8')
const start = source.indexOf('async function request(')
const end = source.indexOf('\nconst command =', start)
assert.ok(start >= 0 && end > start, 'The request test boundary must remain explicit')

function harness(reject) {
  const globalSignal = { globalDeadline: true }
  const calls = []
  let healthChecks = 0
  const request = runInNewContext(`${source.slice(start, end)}; request`, {
    driverURL: 'http://127.0.0.1:9515',
    stop: { signal: globalSignal },
    healthy: () => { healthChecks++ },
    AbortSignal: { timeout: (milliseconds) => ({ milliseconds }), any: (signals) => ({ signals }) },
    fetch: async (url, options) => {
      calls.push({ url, options })
      if (reject) throw reject
      return { ok: true, json: async () => ({ value: { ok: true } }) }
    },
  })
  return { request, calls, globalSignal, healthChecks: () => healthChecks }
}

for (const [name, path, method, cleanup, milliseconds] of [
  ['session creation gets its own bounded startup allowance', '/session', 'POST', false, 60_000],
  ['status remains a short request', '/status', 'GET', false, 10_000],
  ['ordinary session commands keep their short deadline', '/session/id/url', 'POST', false, 10_000],
  ['non-creation session request keeps its short deadline', '/session', 'DELETE', false, 10_000],
  ['cleanup remains independently bounded', '/session/id', 'DELETE', true, 5_000],
]) {
  test(name, async () => {
    const h = harness()
    await h.request(path, method, {}, cleanup)
    assert.equal(h.calls.length, 1)
    const signal = h.calls[0].options.signal
    if (cleanup) {
      assert.equal(signal.milliseconds, milliseconds)
      assert.equal(h.healthChecks(), 0)
    } else {
      assert.equal(signal.signals[0], h.globalSignal, 'Every normal request retains the original overall deadline')
      assert.equal(signal.signals[1].milliseconds, milliseconds)
      assert.equal(h.healthChecks(), 1)
    }
  })
}

test('uncertain session creation is never retried', async () => {
  const timeout = new Error('Synthetic timeout after server-side creation may have begun')
  const h = harness(timeout)
  await assert.rejects(h.request('/session', 'POST', {}), (error) => error === timeout)
  assert.equal(h.calls.length, 1)
})
