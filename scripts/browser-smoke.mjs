// Real DOM smoke for the built, in-memory browser demo. No native bridge or accounts.
// Requires an installed Chrome/ChromeDriver pair; never downloads a browser or disables its sandbox.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { access } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { installRecoveryFixture } from './browser-recovery-fixture.mjs'
import { startSmokeProcess, stopSmokeProcess } from './smoke-process.mjs'

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../Web')
const site = 'http://127.0.0.1:4173'
const driverURL = 'http://127.0.0.1:9515'
const elementKey = 'element-6066-11e4-a52e-4f735466cecf'
const stop = new AbortController()
const deadline = setTimeout(() => stop.abort(new Error('Browser smoke exceeded 180 seconds')), 180_000)
const interrupt = () => stop.abort(new Error('Browser smoke interrupted'))
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)
const children = []
let sessionID

async function unusedPort(port) {
  const server = createServer()
  try {
    server.listen(port, '127.0.0.1')
    await once(server, 'listening')
  } finally {
    await new Promise((done) => server.close(done))
  }
}

function start(command, args) {
  const owned = startSmokeProcess(command, args, web)
  children.push(owned)
  return owned
}

function healthy() {
  stop.signal.throwIfAborted()
  for (const owned of children) {
    if (owned.error) throw owned.error
    if (owned.child.exitCode !== null || owned.child.signalCode !== null) {
      throw new Error(`Smoke child exited unexpectedly:\n${owned.output}`)
    }
  }
}

async function request(path, method = 'GET', body, cleanup = false) {
  if (!cleanup) healthy()
  // ChromeDriver allows up to 60 seconds to start Chrome. A ready /status is
  // not a ready browser; keep this one allowance inside the overall deadline.
  const timeout = method === 'POST' && path === '/session' ? 60_000 : 10_000
  const response = await fetch(driverURL + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: cleanup ? AbortSignal.timeout(5_000) : AbortSignal.any([stop.signal, AbortSignal.timeout(timeout)]),
  })
  const data = await response.json()
  if (!response.ok || data.value?.error) {
    const error = new Error(`WebDriver ${method} ${path}: ${data.value?.message || response.status}`)
    error.code = data.value?.error
    throw error
  }
  return data.value
}

const command = (path, method = 'GET', body) => request(`/session/${sessionID}${path}`, method, body)
const observe = (script, args = []) => command('/execute/sync', 'POST', { script, args })

async function until(label, condition, timeout = 15_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    healthy()
    try {
      const value = await condition()
      if (value) return value
    } catch (error) {
      if (!['no such element', 'stale element reference'].includes(error.code)) throw error
    }
    await delay(100, undefined, { signal: stop.signal })
  }
  throw new Error(`Timed out: ${label}`)
}

async function element(selector, using = 'css selector') {
  return until(`one visible enabled element: ${selector}`, async () => {
    const matches = await command('/elements', 'POST', { using, value: selector })
    assert.ok(matches.length <= 1, `Ambiguous selector: ${selector}`)
    if (!matches.length) return false
    const id = matches[0][elementKey]
    if (!await command(`/element/${id}/displayed`) || !await command(`/element/${id}/enabled`)) return false
    return id
  })
}

async function click(selector, using) {
  const id = await element(selector, using)
  // Never retry a click: a lost response may already have changed application state.
  await command(`/element/${id}/click`, 'POST', {})
}

async function keys(selector, text) {
  const id = await element(selector)
  await command(`/element/${id}/value`, 'POST', { text })
}

const nav = (label) => click(`//nav[contains(@class,'nx-nav')]/button[span[normalize-space(.)='${label}']]`, 'xpath')
const person = (name) => click(`//button[contains(@class,'nx-person-row')][.//strong[normalize-space(.)='${name}']]`, 'xpath')
const nameInput = 'article.nx-person input[aria-label="Name"]'
const rename = (name) => `article.nx-person button[aria-label="Name: ${name}"]`
const record = '.nx-event button[aria-label="Attendance for Mateo Santos"]'
const noteInput = '[role="dialog"] textarea[placeholder="Reason, notice, comment"]'

async function focused(selector) {
  await until(`focus on ${selector}`, () => observe('return document.activeElement?.matches(arguments[0]) === true', [selector]))
}

async function closedRecord() {
  await until('attendance dialog removed', () => observe('return document.querySelectorAll("[role=dialog]").length === 0'))
  await focused(record)
}

try {
  assert.notEqual(process.getuid?.(), 0, 'Run Chrome as an unprivileged test user with its sandbox enabled')
  await access(join(web, 'dist/index.html'))
  await unusedPort(4173)
  await unusedPort(9515)
  start(process.execPath, [join(web, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'])
  const driver = process.env.CHROMEWEBDRIVER ? join(process.env.CHROMEWEBDRIVER, 'chromedriver') : 'chromedriver'
  start(driver, ['--port=9515']) // ChromeDriver's default access is local-only.
  await until('Vite preview startup', async () => {
    try { return (await fetch(site, { signal: AbortSignal.timeout(1_000) })).ok }
    catch (error) { if (error.cause?.code === 'ECONNREFUSED') return false; throw error }
  })
  await until('ChromeDriver startup', async () => {
    try { return (await request('/status')).ready }
    catch (error) { if (error.cause?.code === 'ECONNREFUSED') return false; throw error }
  })
  const session = await request('/session', 'POST', { capabilities: { alwaysMatch: {
    browserName: 'chrome',
    'goog:chromeOptions': {
      args: ['--headless=new', '--window-size=1440,1000', '--lang=en-US'],
      prefs: { 'intl.accept_languages': 'en-US,en' },
      detach: false,
    },
  } } })
  sessionID = session.sessionId
  assert.ok(sessionID, 'ChromeDriver returned a session')
  console.log(`Chrome ${session.capabilities.browserVersion}; ChromeDriver ${session.capabilities.chrome?.chromedriverVersion}`)
  await command('/timeouts', 'POST', { implicit: 0, pageLoad: 20_000, script: 5_000 })
  await command('/url', 'POST', { url: site })
  await element('.opening-primary')
  assert.equal(await observe('return document.documentElement.lang'), 'en')
  assert.equal(await observe('return Boolean(window.webkit?.messageHandlers?.valentina)'), false)
  assert.equal(await observe('return document.querySelector(".opening-primary").textContent.trim()'), 'Explore example')
  await click('.opening-primary')
  await element('.nx-app.is-demo.layout-wide')

  await nav('People')
  await person('Ana Rivera')
  await click(rename('Ana Rivera'))
  await focused(nameInput)
  assert.deepEqual(await observe('const e=document.activeElement; return [e.value,e.selectionStart,e.selectionEnd]'), ['Ana Rivera', 0, 10])
  await keys(nameInput, 'Canceled synthetic name')
  await keys(nameInput, '\uE00C') // Escape cancels; later focus/blur must not commit it.
  await element(rename('Ana Rivera'))
  await click('input[aria-label="Search people"]')
  await nav('Events')
  await nav('People')
  await person('Ana Rivera')
  await click(rename('Ana Rivera'))
  await focused(nameInput)
  await keys(nameInput, 'Synthetic DOM Member')
  await keys(nameInput, '\uE007') // Enter saves through the real key handler.
  await element(rename('Synthetic DOM Member'))
  await nav('Events')
  await nav('People')
  await person('Synthetic DOM Member')
  await element(rename('Synthetic DOM Member'))
  console.log('PASS: rename autofocus/select, Escape cancellation, Enter save, navigation persistence')

  await nav('Events')
  await click("//button[contains(@class,'nx-agenda-row')][.//*[normalize-space(.)='Jornada de bienestar']]", 'xpath')
  await click(record)
  await focused('[role="dialog"]')
  assert.equal(await observe('return document.querySelectorAll("[role=dialog]").length'), 1)
  await click(noteInput)
  await keys(noteInput, 'Synthetic browser note saved with Escape')
  await keys(noteInput, '\uE00C') // A dirty note saves before dismissal; this is not discard.
  await closedRecord()
  await click(record)
  await focused('[role="dialog"]')
  assert.equal(await observe('return document.querySelector(arguments[0]).value', [noteInput]), 'Synthetic browser note saved with Escape')
  await click('[role="dialog"] button[aria-label="Close"]')
  await closedRecord()
  console.log('PASS: attendance dialog focus, Escape save, focus restoration, reopened note, Close')

  // Reload with an entirely synthetic, allowlisted bridge before application modules evaluate.
  // CDP only installs the fixture; user actions below still use real WebDriver clicks/keys.
  await command('/goog/cdp/execute', 'POST', {
    cmd: 'Page.addScriptToEvaluateOnNewDocument',
    params: { source: `(${installRecoveryFixture.toString()})()` },
  })
  await command('/url', 'POST', { url: site })
  const inspectRecovery = () => observe('return window.__nexoRecoveryFixture.inspect()')
  const blockedRecovery = async () => {
    assert.equal(await observe('return document.querySelectorAll(".document-studio, .nx-app, [role=dialog], input").length'), 0)
    const state = await inspectRecovery()
    assert.equal(state.calls.filter((call) => call.command === 'draftState').length, 0)
    assert.deepEqual(state.unexpected, [])
    return state
  }
  await element('[role="status"][aria-label="Opening draft"]')
  await until('deferred recovery request', async () => (await inspectRecovery()).pending > 0)
  const original = (await blockedRecovery()).recovery
  // Resolve/reject only the test transport, never a React handler or application state.
  await observe('window.__nexoRecoveryFixture.settle("fail")')
  await element('.nx-recovery [role="alert"]')
  assert.equal(await observe('return document.querySelector(".nx-recovery [role=alert]").textContent'), 'Synthetic temporary draft read failure')
  await keys('body', '\uE00C')
  const failed = await blockedRecovery()
  assert.deepEqual(failed.recovery, original)
  const reads = failed.calls.filter((call) => call.command === 'recoverDraft').length
  await click('//main[contains(@class,"nx-recovery")]/button[normalize-space(.)="Try again"]', 'xpath')
  await element('[role="status"][aria-label="Opening draft"]')
  await until('explicit retry makes another deferred read', async () =>
    (await inspectRecovery()).calls.filter((call) => call.command === 'recoverDraft').length > reads)
  await blockedRecovery()
  await observe('window.__nexoRecoveryFixture.settle("recover")')
  await element('.document-studio input[aria-label="Template name"]')
  assert.equal(await observe('return document.querySelector(".document-studio input[aria-label=\\"Template name\\"]").value'), original.template.name)
  await until('recovered dirty draft is preserved', async () =>
    (await inspectRecovery()).calls.some((call) => call.command === 'draftState'))
  const recovered = await inspectRecovery()
  assert.deepEqual(recovered.unexpected, [])
  assert.deepEqual(recovered.recovery, original)
  for (const call of recovered.calls.filter((call) => call.command === 'draftState')) {
    assert.equal(call.dirty, true)
    for (const [key, value] of Object.entries(original.template)) assert.deepEqual(call.template[key], value)
  }
  console.log('PASS: synthetic recovery pending/error block editor and draft writes; explicit Retry restores the original unsaved draft')
} catch (error) {
  console.error(error)
  if (sessionID && !stop.signal.aborted) {
    try {
      console.error('Synthetic demo DOM at failure:', await observe('return {url:location.href,active:document.activeElement?.outerHTML,dialogs:document.querySelectorAll("[role=dialog]").length,text:document.body.innerText.slice(0,4000)}'))
    } catch { /* The original failure remains authoritative. */ }
  }
  for (const owned of children) if (owned.output) console.error(owned.output)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  if (sessionID) {
    try { await request(`/session/${sessionID}`, 'DELETE', undefined, true) }
    catch (error) { console.error('Session cleanup failed:', error.message); process.exitCode = 1 }
  }
  for (const result of await Promise.allSettled(children.map(stopSmokeProcess))) {
    if (result.status === 'rejected') {
      console.error('Process cleanup failed:', result.reason)
      process.exitCode = 1
    }
  }
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
}
