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
