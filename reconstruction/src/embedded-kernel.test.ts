import assert from 'node:assert/strict'
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const kernelPath = fileURLToPath(new URL('../apple/Sources/NexoInterfazUI/kernel.js', import.meta.url))

test('the embedded kernel runs the window actions without node builtins', () => {
  assert.equal(existsSync(kernelPath), true, 'kernel.js is missing')
  const home = mkdtempSync(path.join(tmpdir(), 'nexo-embebido-'))
  const wrote = press(home, 'attendance', 'es')
  assert.match(wrote, /Persona Alfa: presente; 1\/1/)
  assert.match(wrote, /Persona Gamma: sin registro; sin encuentros evaluables/)
  assert.doesNotMatch(wrote, /Persona Gamma: ausente/)
  const bytes = readFileSync(path.join(home, 'asistencia', 'nexo-reconstruction-v1.json'))
  const again = press(home, 'attendance-read', 'en')
  assert.match(again, /Persona Alfa: present; 1\/1/)
  assert.match(again, /no record; no countable encounters/)
  assert.doesNotMatch(again, /Persona Gamma: absent/)
  assert.deepEqual(readFileSync(path.join(home, 'asistencia', 'nexo-reconstruction-v1.json')), bytes)

  const document = press(home, 'document', 'es')
  assert.match(document, /No cabe: Persona Alfa\nLinea uno\nLinea dos\nLinea tres\nLinea cuatro/)
  assert.equal(readFileSync(path.join(home, 'documentos', 'document-drafts', 'export.pdf')).subarray(0, 5).toString('latin1'), '%PDF-')

  const volunteers = press(home, 'volunteers', 'en')
  assert.match(volunteers, /Suggestion: Persona Tardía/)
  assert.match(volunteers, /selected in Encuentro actual/)
  assert.match(volunteers, /Quota refusal: capacity-exceeded/)

  const collaboration = press(home, 'collaboration', 'es')
  assert.match(collaboration, /Subidas pendientes: ninguna/)
  assert.match(collaboration, /alternativa-remota/)
  const chosen = press(home, 'collaboration-choose', 'es')
  assert.match(chosen, /Alternativa elegida: alternativa-local/)
  assert.match(chosen, /Subidas pendientes: ninguna/)
  assert.doesNotMatch(chosen, /alternativa-remota/)

  const migrated = press(home, 'migration', 'en')
  assert.match(migrated, /Persona Beta: present/)
  const source = readFileSync(path.join(home, 'migracion', 'origen', 'workspace-v1.json'))
  const reverted = press(home, 'migration-revert', 'es')
  assert.match(reverted, /Copia nueva anterior restaurada/)
  assert.match(reverted, /Persona Alfa: presente; 1\/1/)
  assert.match(reverted, /Persona Gamma: sin registro/)
  assert.doesNotMatch(reverted, /Persona Gamma: ausente/)
  assert.doesNotMatch(reverted, /Persona Beta: presente/)
  assert.deepEqual(readFileSync(path.join(home, 'migracion', 'origen', 'workspace-v1.json')), source)
})

test('the embedded form writes a component, a group, and a period change', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'nexo-embebido-form-'))
  const opened = form(home, { op: 'open' })
  assert.equal(opened.components[0]?.name, 'Componente sintético')
  assert.deepEqual(opened.groups, [])
  const named = form(home, { op: 'add-component', name: 'Coro sintético' })
  assert.ok(named.components.some((item) => item.name === 'Coro sintético' && item.encounters === 0))
  const grouped = form(home, { op: 'add-group', name: 'Grupo sintético' })
  assert.equal(grouped.groups[0]?.name, 'Grupo sintético')
  const blank = form(home, { op: 'add-group', name: ' ' })
  assert.equal(blank.error, 'invalid-name')
  assert.equal(blank.groups.length, 1)
  const earlier = opened.periods.find((item) => item.name === 'Período anterior')
  if (!earlier) throw new Error('missing earlier period')
  const hidden = form(home, { op: 'select-period', periodId: earlier.id })
  assert.equal(hidden.periodName, 'Período anterior')
  assert.equal(hidden.encounterTitle, '')
  const draft = form(home, { op: 'draft', text: 'Nota breve' })
  assert.equal(draft.draft, 'Nota breve')
  assert.equal(draft.warning, '')
  const overflow = 'Linea uno\nLinea dos\nLinea tres\nLinea cuatro'
  const warned = form(home, { op: 'draft', text: overflow })
  assert.equal(warned.draft, 'Nota breve')
  assert.equal(warned.warning.includes(overflow), true)
  assert.equal(warned.warning.startsWith('No cabe:'), true)
})

function form(directory: string, body: Record<string, unknown>): {
  components: { name: string; encounters: number }[]
  groups: { name: string }[]
  periods: { id: string; name: string }[]
  periodName: string
  encounterTitle: string
  draft: string
  warning: string
  error: string
} {
  const context = boot(directory)
  const value: unknown = vm.runInContext(`nexoForm(${JSON.stringify(JSON.stringify(body))})`, context)
  if (typeof value !== 'string' || value.startsWith('Error:')) throw new Error(String(value))
  return JSON.parse(value) as ReturnType<typeof form>
}

function press(directory: string, action: string, lang: string): string {
  const context = boot(directory)
  const value: unknown = vm.runInContext(
    `nexoPress(${JSON.stringify(action)}, ${JSON.stringify(lang)})`,
    context,
  )
  if (typeof value !== 'string') throw new Error('empty kernel result')
  if (value.startsWith('Error:')) throw new Error(value)
  return value
}

function boot(directory: string): vm.Context {
  const context: vm.Context = {
    nexoFs,
    TextEncoder,
    TextDecoder,
    structuredClone,
    btoa,
    atob,
    console,
  }
  vm.createContext(context)
  vm.runInContext(readFileSync(kernelPath, 'utf8'), context, { filename: 'kernel.js' })
  context.NEXO_DIRECTORY = directory
  return context
}

function nexoFs(op: string, payload: string): string {
  const body = JSON.parse(payload) as {
    path?: string
    from?: string
    to?: string
    data?: string
    fd?: number
  }
  try {
    if (op === 'read') return ok({ data: readFileSync(body.path ?? '').toString('base64') })
    if (op === 'write') {
      writeFileSync(body.path ?? '', Buffer.from(body.data ?? '', 'base64'))
      return ok({})
    }
    if (op === 'exists') return ok({ data: existsSync(body.path ?? '') })
    if (op === 'mkdir') {
      mkdirSync(body.path ?? '', { recursive: true })
      return ok({})
    }
    if (op === 'rename') {
      if (existsSync(body.to ?? '')) unlinkSync(body.to ?? '')
      renameSync(body.from ?? '', body.to ?? '')
      return ok({})
    }
    if (op === 'unlink') {
      unlinkSync(body.path ?? '')
      return ok({})
    }
    if (op === 'readdir') return ok({ data: readdirSync(body.path ?? '') })
    if (op === 'open') {
      try {
        return ok({ data: openSync(body.path ?? '', 'wx') })
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? String(error.code) : 'EIO'
        return JSON.stringify({ ok: false, code })
      }
    }
    if (op === 'writefd') {
      writeFileSync(body.fd ?? -1, body.data ?? '')
      return ok({})
    }
    if (op === 'close') {
      closeSync(body.fd ?? -1)
      return ok({})
    }
    return JSON.stringify({ ok: false, code: 'EIO' })
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'EIO'
    return JSON.stringify({ ok: false, code })
  }
}

function ok(value: { data?: unknown }): string {
  return JSON.stringify({ ok: true, ...value })
}
