import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { applyForm, type FormScreen } from './form.ts'

test('a person fills the form and the same directory reopens', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nexo-formulario-'))
  const alfa = add(directory, 'Persona Alfa')
  const beta = add(directory, 'Persona Beta')
  const gamma = add(directory, 'Persona Gamma')
  const created = send(directory, {
    op: 'create-encounter',
    title: 'Encuentro del sábado',
    roster: [alfa.id, beta.id],
  })
  assert.equal(created.encounterTitle, 'Encuentro del sábado')
  assert.equal(created.spaceName, 'Espacio sintético')
  assert.equal(created.startsAt, '2026-10-24T15:00:00.000Z')
  assert.equal(created.registered, 2)
  const duplicate = send(directory, { op: 'create-encounter', title: 'Otro', roster: [] })
  assert.equal(duplicate.error, 'encounter-exists')
  assert.equal(duplicate.encounterTitle, 'Encuentro del sábado')
  assert.equal(person(created, 'Persona Gamma').listed, false)
  assert.match(person(created, 'Persona Gamma').line, /fuera de la lista/)
  assert.match(person(created, 'Persona Gamma').line, /sin encuentros evaluables/)
  assert.doesNotMatch(person(created, 'Persona Gamma').line, /ausente/)

  const seen: string[] = []
  let screen = created
  for (let step = 0; step < 5; step += 1) {
    screen = send(directory, { op: 'cycle', personId: alfa.id })
    seen.push(person(screen, 'Persona Alfa').line)
  }
  assert.deepEqual(
    seen.map((line) => line.split(': ')[1].split(';')[0]),
    ['presente', 'ausente', 'excusada', 'por registrar', 'presente'],
  )
  screen = send(directory, { op: 'cycle', personId: beta.id })
  screen = send(directory, { op: 'cycle', personId: beta.id })
  assert.match(person(screen, 'Persona Alfa').line, /presente; 1\/1/)
  assert.match(person(screen, 'Persona Beta').line, /ausente; 0\/1/)
  const before = readFileSync(path.join(directory, 'nexo-reconstruction-v1.json'))
  const refused = send(directory, { op: 'cycle', personId: gamma.id })
  assert.equal(refused.error, 'not-on-roster')
  assert.deepEqual(readFileSync(path.join(directory, 'nexo-reconstruction-v1.json')), before)

  const again = send(directory, { op: 'open' })
  assert.match(person(again, 'Persona Alfa').line, /presente; 1\/1/)
  assert.match(person(again, 'Persona Gamma').line, /fuera de la lista/)
  const english = send(directory, { op: 'open', lang: 'en' })
  assert.match(person(english, 'Persona Alfa').line, /present; 1\/1/)
  assert.match(person(english, 'Persona Gamma').line, /off the list/)
  assert.match(person(english, 'Persona Gamma').line, /no countable encounters/)
  assert.doesNotMatch(person(english, 'Persona Gamma').line, /absent/)

  const interested = send(directory, { op: 'interest', personId: alfa.id })
  assert.match(interested.suggestion, /Sugerencia: Persona Alfa/)
  const chosen = send(directory, { op: 'choose', personId: alfa.id })
  assert.equal(person(chosen, 'Persona Alfa').volunteer, 'seleccionado')
  assert.match(chosen.suggestion, /Sugerencia: ninguna/)

  const draft = send(directory, { op: 'draft', text: 'Nota breve' })
  assert.equal(draft.draft, 'Nota breve')
  assert.equal(draft.warning, '')
  const kept = readFileSync(path.join(directory, 'document-drafts', 'document.json'))
  const overflow = 'Linea uno\nLinea dos\nLinea tres\nLinea cuatro'
  const warned = send(directory, { op: 'draft', text: overflow })
  assert.equal(warned.draft, 'Nota breve')
  assert.match(warned.warning, /No cabe: Nota\nLinea uno\nLinea dos\nLinea tres\nLinea cuatro/)
  assert.deepEqual(readFileSync(path.join(directory, 'document-drafts', 'document.json')), kept)
})

test('the form shows a quota refusal, a paused restore, and a migration revert', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nexo-formulario-'))
  const uno = add(directory, 'Persona Uno')
  const dos = add(directory, 'Persona Dos')
  send(directory, { op: 'create-encounter', title: 'Encuentro del sábado', roster: [uno.id, dos.id] })
  send(directory, { op: 'interest', personId: uno.id })
  send(directory, { op: 'interest', personId: dos.id })
  const selected = send(directory, { op: 'choose', personId: uno.id })
  assert.equal(person(selected, 'Persona Uno').volunteer, 'seleccionado')
  const before = readFileSync(path.join(directory, 'nexo-reconstruction-v1.json'))
  const refused = send(directory, { op: 'choose', personId: dos.id })
  assert.equal(refused.refusal, 'Rechazo de cupo: capacity-exceeded')
  assert.equal(person(refused, 'Persona Uno').volunteer, 'seleccionado')
  assert.equal(person(refused, 'Persona Dos').volunteer, 'interesado')
  assert.deepEqual(readFileSync(path.join(directory, 'nexo-reconstruction-v1.json')), before)
  assert.equal(send(directory, { op: 'open', lang: 'en' }).refusal, 'Quota refusal: capacity-exceeded')

  const both = send(directory, { op: 'collaborate' })
  assert.match(both.collaboration, /alternativa-local/)
  assert.match(both.collaboration, /alternativa-remota/)
  assert.match(both.collaboration, /en pausa/)
  assert.match(both.collaboration, /ninguna/)
  const restored = send(directory, { op: 'restore' })
  assert.match(restored.collaboration, /alternativa-local/)
  assert.match(restored.collaboration, /alternativa-remota/)
  assert.match(restored.collaboration, /en pausa/)
  assert.match(restored.collaboration, /ninguna/)
  const local = restored.alternatives.find((item) => item.value === 'alternativa-local')
  assert.ok(local)
  const chosen = send(directory, { op: 'choose-alternative', versionId: local.id })
  assert.match(chosen.collaboration, /alternativa-local/)
  assert.doesNotMatch(chosen.collaboration, /alternativa-remota/)
  assert.equal(chosen.alternatives.length, 1)
  assert.match(chosen.collaboration, /en pausa/)
  assert.match(chosen.collaboration, /ninguna/)
  const english = send(directory, { op: 'open', lang: 'en' })
  assert.match(english.collaboration, /Sync: paused/)
  assert.match(english.collaboration, /Pending uploads: none/)

  const source = path.join(directory, 'origen', 'workspace-v1.json')
  const migrated = send(directory, { op: 'migrate' })
  const origin = readFileSync(source)
  assert.equal(migrated.encounterTitle, 'Encuentro sintético')
  assert.match(person(migrated, 'Persona Alfa').line, /presente/)
  assert.match(person(migrated, 'Persona Gamma').line, /fuera de la lista/)
  assert.doesNotMatch(person(migrated, 'Persona Gamma').line, /ausente/)
  assert.deepEqual(readFileSync(source), origin)
  const reverted = send(directory, { op: 'revert' })
  assert.equal(reverted.encounterTitle, 'Encuentro del sábado')
  assert.equal(person(reverted, 'Persona Uno').volunteer, 'seleccionado')
  assert.equal(reverted.refusal, 'Rechazo de cupo: capacity-exceeded')
  assert.match(reverted.collaboration, /en pausa/)
  assert.deepEqual(readFileSync(source), origin)
})

test('a component and a group are stored, and the other period hides the encounter', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nexo-formulario-'))
  const opened = send(directory, { op: 'open' })
  assert.equal(opened.periodName, 'Período sintético')
  assert.deepEqual(opened.periods.map((item) => item.name), ['Período sintético', 'Período anterior'])
  assert.equal(opened.spaces.length, 1)
  assert.deepEqual(opened.components.map((item) => item.name), ['Componente sintético'])
  assert.deepEqual(opened.groups, [])
  const before = readFileSync(path.join(directory, 'nexo-reconstruction-v1.json'))

  const blankComponent = send(directory, { op: 'add-component', name: '   ' })
  assert.equal(blankComponent.error, 'invalid-name')
  assert.deepEqual(blankComponent.components.map((item) => item.name), ['Componente sintético'])
  const blankGroup = send(directory, { op: 'add-group', name: '' })
  assert.equal(blankGroup.error, 'invalid-name')
  assert.equal(blankGroup.groups.length, 0)
  const longGroup = send(directory, { op: 'add-group', name: 'g'.repeat(201) })
  assert.equal(longGroup.error, 'invalid-name')
  assert.deepEqual(readFileSync(path.join(directory, 'nexo-reconstruction-v1.json')), before)

  const component = send(directory, { op: 'add-component', name: '  Coro sintético  ' })
  const coro = component.components.find((item) => item.name === 'Coro sintético')
  assert.ok(coro)
  assert.equal(coro.encounters, 0)
  assert.equal(component.components[0].name, 'Componente sintético')
  const group = send(directory, { op: 'add-group', name: 'Grupo sintético' })
  assert.deepEqual(group.groups.map((item) => item.name), ['Grupo sintético'])
  const fitting = send(directory, { op: 'draft', text: 'Nota breve' })
  assert.equal(fitting.draft, 'Nota breve')
  assert.equal(fitting.warning, '')
  assert.equal(fitting.error, '')
  const keptDraft = readFileSync(path.join(directory, 'document-drafts', 'document.json'))
  const overflow = 'Linea uno\nLinea dos\nLinea tres\nLinea cuatro'
  const warned = send(directory, { op: 'draft', text: overflow })
  assert.equal(warned.draft, 'Nota breve')
  assert.equal(warned.warning, `No cabe: Nota\n${overflow}`)
  assert.deepEqual(readFileSync(path.join(directory, 'document-drafts', 'document.json')), keptDraft)

  const alfa = add(directory, 'Persona Alfa')
  const created = send(directory, { op: 'create-encounter', title: 'Encuentro del sábado', roster: [alfa.id] })
  assert.equal(created.components.find((item) => item.name === 'Componente sintético')?.encounters, 1)
  assert.equal(created.components.find((item) => item.name === 'Coro sintético')?.encounters, 0)
  assert.equal(created.encounterTitle, 'Encuentro del sábado')
  const marked = send(directory, { op: 'cycle', personId: alfa.id })
  assert.match(person(marked, 'Persona Alfa').line, /presente; 1\/1/)
  const stored = readFileSync(path.join(directory, 'nexo-reconstruction-v1.json'))

  const earlier = created.periods.find((item) => item.name === 'Período anterior')
  assert.ok(earlier)
  const hidden = send(directory, { op: 'select-period', periodId: earlier.id })
  assert.equal(hidden.periodName, 'Período anterior')
  assert.equal(hidden.encounterTitle, '')
  assert.match(person(hidden, 'Persona Alfa').line, /fuera de la lista/)
  assert.match(person(hidden, 'Persona Alfa').line, /sin encuentros evaluables/)
  assert.doesNotMatch(person(hidden, 'Persona Alfa').line, /presente|ausente/)
  assert.deepEqual(readFileSync(path.join(directory, 'nexo-reconstruction-v1.json')), stored)
  const still = send(directory, { op: 'open' })
  assert.equal(still.periodName, 'Período anterior')
  assert.equal(still.groups[0]?.name, 'Grupo sintético')
  assert.ok(still.components.some((item) => item.name === 'Coro sintético'))

  const missing = send(directory, { op: 'select-period', periodId: '99999999-9999-4999-8999-999999999999' })
  assert.equal(missing.error, 'missing-period')
  assert.equal(missing.periodName, 'Período anterior')
  const current = created.periods.find((item) => item.name === 'Período sintético')
  assert.ok(current)
  const shown = send(directory, { op: 'select-period', periodId: current.id })
  assert.equal(shown.periodName, 'Período sintético')
  assert.equal(shown.encounterTitle, 'Encuentro del sábado')
  assert.match(person(shown, 'Persona Alfa').line, /presente; 1\/1/)
  const english = send(directory, { op: 'open', lang: 'en' })
  assert.match(person(english, 'Persona Alfa').line, /present; 1\/1/)
})

function add(directory: string, name: string): FormScreen['people'][number] {
  const screen = send(directory, { op: 'add-person', name })
  const found = person(screen, name)
  assert.equal(found.name, name)
  return found
}

function send(directory: string, body: Record<string, unknown>): FormScreen {
  return JSON.parse(applyForm(directory, JSON.stringify(body))) as FormScreen
}

function person(screen: FormScreen, name: string): FormScreen['people'][number] {
  const found = screen.people.find((item) => item.name === name)
  assert.ok(found, name)
  return found
}
