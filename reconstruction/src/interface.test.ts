import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { INTERFACE_AREAS } from './interface.ts'

const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))

test('the interface keeps every synthetic journey across a restart', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'nexo-interfaz-'))
  const wrote = run('interface', home, 'es')
  assert.equal(wrote.status, 0, wrote.stderr)
  assert.match(wrote.stdout, /Persona Alfa: presente; 1\/1/)
  assert.match(wrote.stdout, /Persona Beta: ausente; 0\/1/)
  assert.match(wrote.stdout, /Persona Gamma: sin registro; sin encuentros evaluables/)
  assert.doesNotMatch(wrote.stdout, /Persona Gamma: ausente/)
  assert.match(wrote.stdout, /Borrador: Nota breve/)
  assert.match(wrote.stdout, /PDF: export.pdf/)
  assert.match(wrote.stdout, /No cabe: Persona Alfa\nLinea uno\nLinea dos\nLinea tres\nLinea cuatro/)
  assert.match(wrote.stdout, /Sugerencia: Persona Tardía/)
  assert.match(wrote.stdout, /Persona Cero: seleccionado en Encuentro actual/)
  assert.match(wrote.stdout, /Rechazo de cupo: capacity-exceeded/)
  assert.match(wrote.stdout, /Sincronización: en pausa/)
  assert.match(wrote.stdout, /Subidas pendientes: ninguna/)
  assert.match(wrote.stdout, /alternativa-local/)
  assert.match(wrote.stdout, /alternativa-remota/)
  assert.match(wrote.stdout, /Alternativa elegida: alternativa-local/)
  assert.match(wrote.stdout, /Copia nueva anterior restaurada/)
  assert.doesNotMatch(wrote.stdout, /Persona Beta: presente/)

  const attendance = readFileSync(path.join(home, INTERFACE_AREAS.attendance, 'nexo-reconstruction-v1.json'))
  const pdf = readFileSync(path.join(home, INTERFACE_AREAS.documents, 'document-drafts', 'export.pdf'))
  const volunteers = readFileSync(path.join(home, INTERFACE_AREAS.volunteers, 'nexo-reconstruction-v1.json'))
  const collaboration = readFileSync(path.join(home, INTERFACE_AREAS.collaboration, 'nexo-reconstruction-v1.json'))
  const migration = readFileSync(path.join(home, INTERFACE_AREAS.migration, 'nexo-reconstruction-v1.json'))
  const source = readFileSync(path.join(home, INTERFACE_AREAS.migration, 'origen', 'workspace-v1.json'))

  const shown = run('interface-show', home, 'es')
  assert.equal(shown.status, 0, shown.stderr)
  assert.notEqual(shown.pid, wrote.pid)
  assert.match(shown.stdout, /Persona Alfa: presente; 1\/1/)
  assert.match(shown.stdout, /Persona Gamma: sin registro; sin encuentros evaluables/)
  assert.doesNotMatch(shown.stdout, /Persona Gamma: ausente/)
  assert.match(shown.stdout, /No cabe: Persona Alfa\nLinea uno\nLinea dos\nLinea tres\nLinea cuatro/)
  assert.match(shown.stdout, /Sugerencia: Persona Tardía/)
  assert.match(shown.stdout, /Persona Cero: seleccionado en Encuentro actual/)
  assert.match(shown.stdout, /Rechazo de cupo: capacity-exceeded/)
  assert.match(shown.stdout, /Sincronización: en pausa/)
  assert.match(shown.stdout, /Subidas pendientes: ninguna/)
  assert.match(shown.stdout, /alternativa-local/)
  assert.doesNotMatch(shown.stdout, /alternativa-remota/)
  assert.match(shown.stdout, /Persona Alfa: presente; 1\/1/)
  assert.doesNotMatch(shown.stdout, /Persona Beta: presente/)
  assert.deepEqual(readFileSync(path.join(home, INTERFACE_AREAS.attendance, 'nexo-reconstruction-v1.json')), attendance)
  assert.deepEqual(readFileSync(path.join(home, INTERFACE_AREAS.documents, 'document-drafts', 'export.pdf')), pdf)
  assert.deepEqual(readFileSync(path.join(home, INTERFACE_AREAS.volunteers, 'nexo-reconstruction-v1.json')), volunteers)
  assert.deepEqual(readFileSync(path.join(home, INTERFACE_AREAS.collaboration, 'nexo-reconstruction-v1.json')), collaboration)
  assert.deepEqual(readFileSync(path.join(home, INTERFACE_AREAS.migration, 'nexo-reconstruction-v1.json')), migration)
  assert.deepEqual(readFileSync(path.join(home, INTERFACE_AREAS.migration, 'origen', 'workspace-v1.json')), source)
  assert.equal(attendance.toString('utf8').includes('"schema": "nexo-reconstruction-v1"'), true)

  const english = run('interface-show', home, 'en')
  assert.equal(english.status, 0, english.stderr)
  assert.notEqual(english.pid, shown.pid)
  assert.match(english.stdout, /Persona Alfa: present; 1\/1/)
  assert.match(english.stdout, /Persona Gamma: no record; no countable encounters/)
  assert.doesNotMatch(english.stdout, /Persona Gamma: absent/)
  assert.match(english.stdout, /Draft: Nota breve/)
  assert.match(english.stdout, /Does not fit: Persona Alfa\nLinea uno\nLinea dos\nLinea tres\nLinea cuatro/)
  assert.match(english.stdout, /Suggestion: Persona Tardía/)
  assert.match(english.stdout, /Persona Cero: selected in Encuentro actual/)
  assert.match(english.stdout, /Quota refusal: capacity-exceeded/)
  assert.match(english.stdout, /Sync: paused/)
  assert.match(english.stdout, /Pending uploads: none/)
  assert.match(english.stdout, /alternativa-local/)
  assert.doesNotMatch(english.stdout, /alternativa-remota/)
  assert.doesNotMatch(english.stdout, /Persona Beta: present/)
})

function run(command: string, directory: string, lang: string): { status: number | null; pid: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', cli, command, '--directory', directory, '--lang', lang], {
    encoding: 'utf8',
  })
  return { status: result.status, pid: result.pid ?? 0, stdout: result.stdout, stderr: result.stderr }
}
