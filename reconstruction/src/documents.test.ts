import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createSpace } from './commands.ts'
import type { DocumentDraft } from './documents.ts'
import { DomainError } from './errors.ts'
import { emptyWorkspace } from './model.ts'
import { DocumentDraftStore, FileWorkspaceStore } from './store.ts'

function home(): string {
  return mkdtempSync(path.join(tmpdir(), 'nexo-documents-'))
}

function draft(overrides: Partial<DocumentDraft> = {}): DocumentDraft {
  return {
    title: 'Acta sintetica',
    heading: 'Asistencia',
    footer: 'Cierre',
    page: { width: 40, height: 6 },
    rows: [],
    blocks: [],
    ...overrides,
  }
}

test('a document export keeps every page, its content, and its notes', () => {
  const directory = home()
  const notes = ['Nota uno\nlinea final uno', 'Nota dos\nlinea final dos', 'Nota tres\nlinea final tres']
  const body = draft({
    page: { width: 40, height: 6 },
    rows: notes.map((note, index) => ({ id: `fila-${index + 1}`, label: `Persona ${index + 1}`, note })),
    blocks: [{ id: 'bloque', text: 'Bloque sintetico\nlinea final del bloque' }],
  })
  const drafts = new DocumentDraftStore(directory)
  const saved = drafts.saveDocument(body)
  const exported = drafts.exportDocument(saved)
  assert.equal(exported.fits, true)
  assert.equal(exported.document?.pages.length, 4)
  const pages = exported.document?.pages ?? []
  assert.deepEqual(pages.map((page) => page.number), [1, 2, 3, 4])
  assert.deepEqual(pages[0].notes, [notes[0]])
  assert.deepEqual(pages[1].notes, [notes[1]])
  assert.deepEqual(pages[2].notes, [notes[2]])
  assert.deepEqual(pages[3].lines, ['Bloque sintetico', 'linea final del bloque'])
  assert.equal(pages[3].lines.at(-1), 'linea final del bloque')
  for (const page of pages) {
    assert.equal(page.title, body.title)
    assert.equal(page.heading, body.heading)
    assert.equal(page.footer, body.footer)
  }
  const recorded = pages.flatMap((page) => page.notes)
  assert.deepEqual(recorded, notes)
  assert.equal(drafts.exportPath().includes(`${path.sep}document-drafts${path.sep}`), true)
  assert.equal(drafts.exportPath().includes(`${path.sep}revision-copies${path.sep}`), false)
  assert.equal(drafts.readDocument()?.rows[2].note, notes[2])
  const shared = drafts.exportDocument(draft({
    page: { width: 40, height: 7 },
    rows: [
      { id: 'alfa', label: 'Persona Alfa', note: 'Nota alfa' },
      { id: 'beta', label: 'Persona Beta', note: 'Nota beta' },
    ],
  }))
  assert.equal(shared.document?.pages.length, 1)
  assert.deepEqual(shared.document?.pages[0].notes, ['Nota alfa', 'Nota beta'])
})

test('text that does not fit is reported whole and the export is not written', () => {
  const directory = home()
  const note = 'Linea uno\nLinea dos\nLinea tres\nLinea cuatro'
  const body = draft({
    rows: [{ id: 'fila', label: 'Persona Alfa', note }],
  })
  const drafts = new DocumentDraftStore(directory)
  drafts.saveDocument(body)
  const exported = drafts.exportDocument(body)
  assert.equal(exported.fits, false)
  assert.equal(exported.document, null)
  assert.equal(exported.problems[0].text, `Persona Alfa\n${note}`)
  assert.equal(exported.problems[0].text.includes(note), true)
  assert.equal(exported.draft.rows[0].note, note)
  assert.equal(drafts.readDocument()?.rows[0].note, note)
  assert.equal(existsSync(drafts.exportPath()), false)
})

test('a refused export leaves the previous page record unchanged', () => {
  const directory = home()
  const drafts = new DocumentDraftStore(directory)
  const fitting = draft({
    rows: [{ id: 'fila', label: 'Persona Alfa', note: 'Nota breve' }],
  })
  assert.equal(drafts.exportDocument(fitting).fits, true)
  const bytes = readFileSync(drafts.exportPath())
  const title = 'TITULO SINTETICO DEMASIADO LARGO'
  const refused = drafts.exportDocument(draft({ title, page: { width: 8, height: 6 }, rows: fitting.rows }))
  assert.equal(refused.fits, false)
  assert.equal(refused.problems.find((problem) => problem.id === 'title')?.text, title)
  assert.deepEqual(readFileSync(drafts.exportPath()), bytes)
  drafts.saveDocument(draft({ rows: [{ id: 'fila', label: 'Persona Alfa', note: 'Nota que sigue en el borrador' }] }))
  assert.equal(drafts.readDocument()?.rows[0].note, 'Nota que sigue en el borrador')
})

test('a document draft stays outside the workspace backup and survives restore', () => {
  const directory = home()
  const store = new FileWorkspaceStore(directory)
  const initial = store.initialize(emptyWorkspace())
  const saved = store.save(createSpace(initial, { name: 'Espacio sintetico', timeZone: 'Etc/UTC' }), 0)
  const marker = 'NOTA-SINTETICA-FUERA-DEL-ESPACIO'
  const drafts = new DocumentDraftStore(directory)
  drafts.saveDocument(draft({ rows: [{ id: 'fila', label: 'Persona Alfa', note: marker }] }))
  const draftBytes = readFileSync(drafts.documentPath())
  assert.equal(readFileSync(store.primaryPath(), 'utf8').includes(marker), false)
  const copies = readdirSync(store.revisionCopies())
  assert.equal(copies.length > 0, true)
  for (const name of copies) {
    assert.equal(readFileSync(path.join(store.revisionCopies(), name), 'utf8').includes(marker), false)
  }
  store.restore(path.join(store.revisionCopies(), copies[0]))
  assert.equal(store.load().revision > saved.revision, true)
  assert.deepEqual(readFileSync(drafts.documentPath()), draftBytes)
  assert.equal(drafts.readDocument()?.rows[0].note, marker)
})

test('an ill-shaped document draft is rejected before writing', () => {
  const directory = home()
  const drafts = new DocumentDraftStore(directory)
  const body = draft()
  const invalid: DocumentDraft = { ...body, rows: [{ id: '', label: 'Persona Alfa', note: 'nota' }] }
  assert.throws(
    () => drafts.saveDocument(invalid),
    (error: unknown) => error instanceof DomainError && error.code === 'invalid-draft',
  )
  assert.equal(existsSync(drafts.documentPath()), false)
})
