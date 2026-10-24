import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { chooseVolunteer, combineVolunteerSelection } from './commands.ts'
import { DomainError } from './errors.ts'
import { FileWorkspaceStore, readImport } from './store.ts'
import { rejectedVolunteerCommands, VOLUNTEERS } from './volunteer-journey.ts'
import { suggestVolunteers } from './volunteers.ts'

const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))

function directory(): string {
  return mkdtempSync(path.join(tmpdir(), 'nexo-volunteers-'))
}

function status(workspace: ReturnType<FileWorkspaceStore['load']>, encounterId: string, personId: string): string | undefined {
  return workspace.volunteers.find((entry) => entry.encounterId === encounterId && entry.personId === personId)?.status
}

test('the volunteer journey survives a new process', () => {
  const home = directory()
  const created = spawnSync(process.execPath, ['--experimental-strip-types', cli, 'volunteers', '--directory', home, '--lang', 'es'], {
    encoding: 'utf8',
  })
  assert.equal(created.status, 0, created.stderr)
  const shown = spawnSync(process.execPath, ['--experimental-strip-types', cli, 'volunteers-show', '--directory', home, '--lang', 'en'], {
    encoding: 'utf8',
  })
  assert.equal(shown.status, 0, shown.stderr)
  assert.match(shown.stdout, /Suggestion: Persona Tardía, Persona Nula, Persona Extra, Persona Temprana, Persona Reciente/)
  assert.match(shown.stdout, /Category suggestion: Persona Beta Categoría, Persona Alfa Categoría/)
  assert.match(shown.stdout, /Persona Cero: selected in Encuentro actual/)
  assert.match(shown.stdout, /Persona Tardía: no-show in Primera participación; interested in Encuentro actual/)
  assert.match(shown.stdout, /Persona Doble: completed in Primera participación; completed in Segunda participación; declined in Encuentro actual/)
  assert.match(shown.stdout, /Persona Fuera: not interested/)
  assert.doesNotMatch(shown.stdout, /Persona Fuera: selected/)
  const spanish = spawnSync(process.execPath, ['--experimental-strip-types', cli, 'volunteers-show', '--directory', home, '--lang', 'es'], {
    encoding: 'utf8',
  })
  assert.equal(spanish.status, 0, spanish.stderr)
  assert.match(spanish.stdout, /Sugerencia: Persona Tardía, Persona Nula, Persona Extra, Persona Temprana, Persona Reciente/)
  assert.match(spanish.stdout, /Sugerencia por categoría: Persona Beta Categoría, Persona Alfa Categoría/)
  assert.match(spanish.stdout, /Persona Temprana: completado en Primera participación; interesado en Encuentro actual/)
  assert.match(spanish.stdout, /Persona Reciente: completado en Segunda participación; interesado en Encuentro actual/)
  assert.match(spanish.stdout, /Persona Fuera: sin interés/)

  const store = new FileWorkspaceStore(home)
  const loaded = store.load()
  assert.equal(loaded.revision, 1)
  assert.equal(status(loaded, VOLUNTEERS.currentEncounterId, VOLUNTEERS.ceroId), 'selected')
  assert.equal(status(loaded, VOLUNTEERS.currentEncounterId, VOLUNTEERS.tardiaId), 'interested')
  assert.equal(status(loaded, VOLUNTEERS.currentEncounterId, VOLUNTEERS.nulaId), 'interested')
  assert.equal(status(loaded, VOLUNTEERS.currentEncounterId, VOLUNTEERS.extraId), 'interested')
  assert.equal(status(loaded, VOLUNTEERS.currentEncounterId, VOLUNTEERS.tempranaId), 'interested')
  assert.equal(status(loaded, VOLUNTEERS.currentEncounterId, VOLUNTEERS.recienteId), 'interested')
  assert.equal(status(loaded, VOLUNTEERS.currentEncounterId, VOLUNTEERS.dobleId), 'declined')
  assert.equal(status(loaded, VOLUNTEERS.earlierEncounterId, VOLUNTEERS.tardiaId), 'noShow')
  assert.equal(status(loaded, VOLUNTEERS.earlierEncounterId, VOLUNTEERS.tempranaId), 'completed')
  assert.equal(status(loaded, VOLUNTEERS.laterEncounterId, VOLUNTEERS.dobleId), 'completed')
  assert.equal(status(loaded, VOLUNTEERS.currentEncounterId, VOLUNTEERS.fueraId), undefined)
  const before = structuredClone(loaded.volunteers)
  const ranked = suggestVolunteers(loaded, VOLUNTEERS.currentEncounterId, VOLUNTEERS.periodId).map((item) => item.personId)
  assert.equal(ranked.includes(VOLUNTEERS.fueraId), false)
  assert.equal(ranked.includes(VOLUNTEERS.ceroId), false)
  assert.deepEqual(ranked, [
    VOLUNTEERS.tardiaId,
    VOLUNTEERS.nulaId,
    VOLUNTEERS.extraId,
    VOLUNTEERS.tempranaId,
    VOLUNTEERS.recienteId,
  ])
  assert.deepEqual(loaded.volunteers, before)
  assert.throws(
    () => chooseVolunteer(loaded, VOLUNTEERS.currentEncounterId, VOLUNTEERS.tardiaId),
    (error: unknown) => error instanceof DomainError && error.code === 'capacity-exceeded',
  )
  assert.throws(
    () => combineVolunteerSelection(loaded, VOLUNTEERS.currentEncounterId, [VOLUNTEERS.nulaId, VOLUNTEERS.extraId]),
    (error: unknown) => error instanceof DomainError && error.code === 'capacity-exceeded',
  )
  const bytes = readFileSync(store.primaryPath())
  const overloaded = structuredClone(loaded)
  const extra = overloaded.volunteers.find(
    (entry) => entry.encounterId === VOLUNTEERS.currentEncounterId && entry.personId === VOLUNTEERS.extraId,
  )
  if (!extra) throw new Error('missing volunteer')
  extra.status = 'selected'
  assert.throws(
    () => readImport(`${JSON.stringify(overloaded)}\n`),
    (error: unknown) => error instanceof DomainError && error.code === 'capacity-exceeded',
  )
  assert.deepEqual(readFileSync(store.primaryPath()), bytes)
  assert.equal(status(store.load(), VOLUNTEERS.currentEncounterId, VOLUNTEERS.extraId), 'interested')
  const category = suggestVolunteers(loaded, VOLUNTEERS.categoryEncounterId, VOLUNTEERS.periodId).map((item) => item.personId)
  assert.deepEqual(category, [VOLUNTEERS.betaCategoryId, VOLUNTEERS.alfaCategoryId])
  rejectedVolunteerCommands(loaded)
  assert.deepEqual(readFileSync(store.primaryPath()), bytes)
  assert.equal(status(store.load(), VOLUNTEERS.categoryEncounterId, VOLUNTEERS.alfaCategoryId), 'interested')
  assert.equal(status(store.load(), VOLUNTEERS.categoryPriorAId, VOLUNTEERS.alfaCategoryId), 'completed')
  assert.equal(status(store.load(), VOLUNTEERS.categoryPriorBId, VOLUNTEERS.betaCategoryId), 'completed')
  assert.equal(status(store.load(), VOLUNTEERS.cancelledEncounterId, VOLUNTEERS.ceroId), undefined)
  assert.equal(status(store.load(), VOLUNTEERS.openEncounterId, VOLUNTEERS.ceroId), undefined)
  assert.equal(status(store.load(), VOLUNTEERS.currentEncounterId, VOLUNTEERS.inactiveId), undefined)
  assert.equal(status(store.load(), VOLUNTEERS.currentEncounterId, VOLUNTEERS.otherPersonId), undefined)
  assert.deepEqual(suggestVolunteers(store.load(), VOLUNTEERS.outsideEncounterId, VOLUNTEERS.periodId), [])
})
