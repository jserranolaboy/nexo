import {
  addComponent,
  addPeriod,
  addPerson,
  chooseVolunteer,
  createEncounter,
  createSpace,
  declineVolunteer,
  finishVolunteer,
  registerVolunteer,
} from './commands.ts'
import { DomainError } from './errors.ts'
import { emptyWorkspace, type VolunteerStatus, type Workspace } from './model.ts'
import { FileWorkspaceStore } from './store.ts'
import { suggestVolunteers } from './volunteers.ts'

export const VOLUNTEERS = {
  spaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  periodId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  componentId: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  earlierEncounterId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  laterEncounterId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
  currentEncounterId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
  ceroId: '10000000-0000-4000-8000-000000000001',
  tardiaId: '20000000-0000-4000-8000-000000000002',
  nulaId: '30000000-0000-4000-8000-000000000003',
  extraId: '40000000-0000-4000-8000-000000000004',
  tempranaId: '50000000-0000-4000-8000-000000000005',
  recienteId: '60000000-0000-4000-8000-000000000006',
  dobleId: '70000000-0000-4000-8000-000000000007',
  fueraId: '80000000-0000-4000-8000-000000000008',
  categoryComponentId: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
  categoryAId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  categoryBId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  categoryPriorAId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4',
  categoryPriorBId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
  categoryEncounterId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6',
  cancelledEncounterId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7',
  openEncounterId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8',
  outsideEncounterId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9',
  alfaCategoryId: '90000000-0000-4000-8000-000000000001',
  betaCategoryId: '90000000-0000-4000-8000-000000000002',
  inactiveId: '90000000-0000-4000-8000-000000000003',
  otherSpaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  otherPersonId: '90000000-0000-4000-8000-000000000004',
  spaceName: 'Espacio sintético',
  periodName: 'Período sintético',
  timeZone: 'Etc/UTC',
  periodStart: '2026-01-01T00:00:00.000Z',
  periodEnd: '2027-01-01T00:00:00.000Z',
  earlierAt: '2026-02-01T00:00:00.000Z',
  laterAt: '2026-03-01T00:00:00.000Z',
  currentAt: '2026-04-01T00:00:00.000Z',
  earlierTitle: 'Primera participación',
  laterTitle: 'Segunda participación',
  currentTitle: 'Encuentro actual',
} as const

const PEOPLE = [
  [VOLUNTEERS.ceroId, 'Persona Cero'],
  [VOLUNTEERS.tardiaId, 'Persona Tardía'],
  [VOLUNTEERS.nulaId, 'Persona Nula'],
  [VOLUNTEERS.extraId, 'Persona Extra'],
  [VOLUNTEERS.tempranaId, 'Persona Temprana'],
  [VOLUNTEERS.recienteId, 'Persona Reciente'],
  [VOLUNTEERS.dobleId, 'Persona Doble'],
  [VOLUNTEERS.fueraId, 'Persona Fuera'],
] as const

function participate(workspace: Workspace, encounterId: string, personId: string, registeredAt: string, participated: boolean): Workspace {
  let next = registerVolunteer(workspace, { encounterId, personId, registeredAt })
  next = chooseVolunteer(next, encounterId, personId)
  return finishVolunteer(next, encounterId, personId, participated)
}

/** One saved revision. Ranking comes from suggestVolunteers; only the first suggestion is chosen by hand. */
export function runVolunteerJourney(directory: string): void {
  const store = new FileWorkspaceStore(directory)
  let workspace = store.initialize(emptyWorkspace())
  workspace = createSpace(workspace, { id: VOLUNTEERS.spaceId, name: VOLUNTEERS.spaceName, timeZone: VOLUNTEERS.timeZone })
  workspace = addPeriod(workspace, {
    id: VOLUNTEERS.periodId,
    spaceId: VOLUNTEERS.spaceId,
    name: VOLUNTEERS.periodName,
    startsAt: VOLUNTEERS.periodStart,
    endsAt: VOLUNTEERS.periodEnd,
  })
  workspace = addComponent(workspace, { id: VOLUNTEERS.componentId, spaceId: VOLUNTEERS.spaceId, name: 'Componente sintético' })
  for (const [id, name] of PEOPLE) workspace = addPerson(workspace, { id, spaceId: VOLUNTEERS.spaceId, name })
  workspace = createEncounter(workspace, {
    id: VOLUNTEERS.earlierEncounterId,
    spaceId: VOLUNTEERS.spaceId,
    title: VOLUNTEERS.earlierTitle,
    startsAt: VOLUNTEERS.earlierAt,
    componentId: VOLUNTEERS.componentId,
    volunteerCapacity: 4,
  })
  workspace = createEncounter(workspace, {
    id: VOLUNTEERS.laterEncounterId,
    spaceId: VOLUNTEERS.spaceId,
    title: VOLUNTEERS.laterTitle,
    startsAt: VOLUNTEERS.laterAt,
    componentId: VOLUNTEERS.componentId,
    volunteerCapacity: 4,
  })
  workspace = createEncounter(workspace, {
    id: VOLUNTEERS.currentEncounterId,
    spaceId: VOLUNTEERS.spaceId,
    title: VOLUNTEERS.currentTitle,
    startsAt: VOLUNTEERS.currentAt,
    componentId: VOLUNTEERS.componentId,
    volunteerCapacity: 1,
  })
  workspace = participate(workspace, VOLUNTEERS.earlierEncounterId, VOLUNTEERS.tempranaId, '2026-01-02T00:00:00.000Z', true)
  workspace = participate(workspace, VOLUNTEERS.earlierEncounterId, VOLUNTEERS.dobleId, '2026-01-02T00:00:00.000Z', true)
  workspace = participate(workspace, VOLUNTEERS.earlierEncounterId, VOLUNTEERS.tardiaId, '2026-01-02T00:00:00.000Z', false)
  workspace = participate(workspace, VOLUNTEERS.laterEncounterId, VOLUNTEERS.dobleId, '2026-01-03T00:00:00.000Z', true)
  workspace = participate(workspace, VOLUNTEERS.laterEncounterId, VOLUNTEERS.recienteId, '2026-01-03T00:00:00.000Z', true)
  const interested: ReadonlyArray<readonly [string, string]> = [
    [VOLUNTEERS.ceroId, '2026-01-09T00:00:00.000Z'],
    [VOLUNTEERS.tardiaId, '2026-01-10T00:00:00.000Z'],
    [VOLUNTEERS.nulaId, '2026-01-11T00:00:00.000Z'],
    [VOLUNTEERS.extraId, '2026-01-11T00:00:00.000Z'],
    [VOLUNTEERS.tempranaId, '2026-01-12T00:00:00.000Z'],
    [VOLUNTEERS.recienteId, '2026-01-13T00:00:00.000Z'],
    [VOLUNTEERS.dobleId, '2026-01-14T00:00:00.000Z'],
  ]
  for (const [personId, registeredAt] of interested) {
    workspace = registerVolunteer(workspace, { encounterId: VOLUNTEERS.currentEncounterId, personId, registeredAt })
  }
  const ranked = suggestVolunteers(workspace, VOLUNTEERS.currentEncounterId, VOLUNTEERS.periodId)
  const manual = ranked[0]
  if (manual?.personId !== VOLUNTEERS.ceroId) throw new DomainError('invalid-transition')
  workspace = chooseVolunteer(workspace, VOLUNTEERS.currentEncounterId, manual.personId)
  workspace = declineVolunteer(workspace, VOLUNTEERS.currentEncounterId, VOLUNTEERS.dobleId)
  workspace = addCategoryJourney(workspace)
  store.save(workspace, 0)
  rejectedVolunteerCommands(store.load())
}

function addCategoryJourney(workspace: Workspace): Workspace {
  let next = addComponent(workspace, {
    id: VOLUNTEERS.categoryComponentId,
    spaceId: VOLUNTEERS.spaceId,
    name: 'Componente de categoría',
  })
  next = addPerson(next, { id: VOLUNTEERS.alfaCategoryId, spaceId: VOLUNTEERS.spaceId, name: 'Persona Alfa Categoría' })
  next = addPerson(next, { id: VOLUNTEERS.betaCategoryId, spaceId: VOLUNTEERS.spaceId, name: 'Persona Beta Categoría' })
  next = addPerson(next, { id: VOLUNTEERS.inactiveId, spaceId: VOLUNTEERS.spaceId, name: 'Persona Inactiva', active: false })
  next = createSpace(next, { id: VOLUNTEERS.otherSpaceId, name: 'Otro espacio', timeZone: VOLUNTEERS.timeZone })
  next = addPerson(next, { id: VOLUNTEERS.otherPersonId, spaceId: VOLUNTEERS.otherSpaceId, name: 'Persona Ajena' })
  next = createEncounter(next, {
    id: VOLUNTEERS.categoryPriorAId,
    spaceId: VOLUNTEERS.spaceId,
    title: 'Participación en la categoría',
    startsAt: '2026-06-01T00:00:00.000Z',
    componentId: VOLUNTEERS.categoryComponentId,
    categoryId: VOLUNTEERS.categoryAId,
    volunteerCapacity: 1,
  })
  next = createEncounter(next, {
    id: VOLUNTEERS.categoryPriorBId,
    spaceId: VOLUNTEERS.spaceId,
    title: 'Participación en otra categoría',
    startsAt: '2026-07-01T00:00:00.000Z',
    componentId: VOLUNTEERS.categoryComponentId,
    categoryId: VOLUNTEERS.categoryBId,
    volunteerCapacity: 1,
  })
  next = createEncounter(next, {
    id: VOLUNTEERS.categoryEncounterId,
    spaceId: VOLUNTEERS.spaceId,
    title: 'Encuentro de la categoría',
    startsAt: '2026-08-01T00:00:00.000Z',
    componentId: VOLUNTEERS.categoryComponentId,
    categoryId: VOLUNTEERS.categoryAId,
    volunteerCapacity: 2,
  })
  next = createEncounter(next, {
    id: VOLUNTEERS.cancelledEncounterId,
    spaceId: VOLUNTEERS.spaceId,
    title: 'Encuentro cancelado',
    startsAt: '2026-09-01T00:00:00.000Z',
    componentId: VOLUNTEERS.componentId,
    volunteerCapacity: 1,
    cancelled: true,
  })
  next = createEncounter(next, {
    id: VOLUNTEERS.openEncounterId,
    spaceId: VOLUNTEERS.spaceId,
    title: 'Encuentro sin cupo',
    startsAt: '2026-09-02T00:00:00.000Z',
    componentId: VOLUNTEERS.componentId,
    volunteerCapacity: null,
  })
  next = createEncounter(next, {
    id: VOLUNTEERS.outsideEncounterId,
    spaceId: VOLUNTEERS.spaceId,
    title: 'Encuentro fuera del período',
    startsAt: VOLUNTEERS.periodEnd,
    componentId: VOLUNTEERS.componentId,
    volunteerCapacity: 1,
  })
  next = participate(next, VOLUNTEERS.categoryPriorAId, VOLUNTEERS.alfaCategoryId, '2026-06-02T00:00:00.000Z', true)
  next = participate(next, VOLUNTEERS.categoryPriorBId, VOLUNTEERS.betaCategoryId, '2026-07-02T00:00:00.000Z', true)
  next = registerVolunteer(next, {
    encounterId: VOLUNTEERS.categoryEncounterId,
    personId: VOLUNTEERS.alfaCategoryId,
    registeredAt: '2026-01-20T00:00:00.000Z',
  })
  next = registerVolunteer(next, {
    encounterId: VOLUNTEERS.categoryEncounterId,
    personId: VOLUNTEERS.betaCategoryId,
    registeredAt: '2026-01-21T00:00:00.000Z',
  })
  const ranked = suggestVolunteers(next, VOLUNTEERS.categoryEncounterId, VOLUNTEERS.periodId).map((item) => item.personId)
  if (ranked[0] !== VOLUNTEERS.betaCategoryId || ranked[1] !== VOLUNTEERS.alfaCategoryId) {
    throw new DomainError('invalid-transition')
  }
  return next
}

/** Calls the existing guards. A rejection leaves the caller's workspace unsaved. */
export function rejectedVolunteerCommands(workspace: Workspace): void {
  const registeredAt = '2026-01-15T00:00:00.000Z'
  refuses(
    () => registerVolunteer(workspace, { encounterId: VOLUNTEERS.cancelledEncounterId, personId: VOLUNTEERS.ceroId, registeredAt }),
    'volunteer-unavailable',
  )
  refuses(
    () => registerVolunteer(workspace, { encounterId: VOLUNTEERS.openEncounterId, personId: VOLUNTEERS.ceroId, registeredAt }),
    'volunteer-unavailable',
  )
  refuses(
    () => registerVolunteer(workspace, { encounterId: VOLUNTEERS.currentEncounterId, personId: VOLUNTEERS.inactiveId, registeredAt }),
    'volunteer-unavailable',
  )
  refuses(
    () => chooseVolunteer(workspace, VOLUNTEERS.currentEncounterId, VOLUNTEERS.otherPersonId),
    'invalid-transition',
  )
  if (suggestVolunteers(workspace, VOLUNTEERS.outsideEncounterId, VOLUNTEERS.periodId).length !== 0) {
    throw new DomainError('volunteer-unavailable')
  }
  const drafted = registerVolunteer(workspace, {
    encounterId: VOLUNTEERS.currentEncounterId,
    personId: VOLUNTEERS.otherPersonId,
    registeredAt,
  })
  const suggested = suggestVolunteers(drafted, VOLUNTEERS.currentEncounterId, VOLUNTEERS.periodId)
  if (suggested.some((item) => item.personId === VOLUNTEERS.otherPersonId)) throw new DomainError('invalid-transition')
}

function refuses(command: () => Workspace, code: string): void {
  try {
    command()
  } catch (error) {
    if (error instanceof DomainError && error.code === code) return
    throw error
  }
  throw new DomainError(code)
}

export function describeVolunteers(directory: string, lang: 'es' | 'en'): string {
  const workspace = new FileWorkspaceStore(directory).load()
  const space = workspace.spaces[0]
  const labels: Record<VolunteerStatus, string> = lang === 'en'
    ? { interested: 'interested', selected: 'selected', declined: 'declined', completed: 'completed', noShow: 'no-show' }
    : { interested: 'interesado', selected: 'seleccionado', declined: 'declinado', completed: 'completado', noShow: 'no presentado' }
  const none = lang === 'en' ? 'not interested' : 'sin interés'
  const ranked = suggestVolunteers(workspace, VOLUNTEERS.currentEncounterId, VOLUNTEERS.periodId)
  const names = new Map(workspace.people.map((person) => [person.id, person.name]))
  const suggestion = ranked.map((item) => names.get(item.personId) ?? item.personId).join(', ')
  const categoryRanked = suggestVolunteers(workspace, VOLUNTEERS.categoryEncounterId, VOLUNTEERS.periodId)
  const categorySuggestion = categoryRanked.map((item) => names.get(item.personId) ?? item.personId).join(', ')
  const heading = lang === 'en' ? 'Suggestion' : 'Sugerencia'
  const categoryHeading = lang === 'en' ? 'Category suggestion' : 'Sugerencia por categoría'
  const noneSuggestion = lang === 'en' ? 'none' : 'ninguna'
  const lines = [
    `${space.name} [${space.timeZone}]`,
    `${heading}: ${suggestion.length === 0 ? noneSuggestion : suggestion}`,
    `${categoryHeading}: ${categorySuggestion.length === 0 ? noneSuggestion : categorySuggestion}`,
  ]
  for (const [personId, name] of PEOPLE) {
    const rows = workspace.volunteers.filter((entry) => entry.personId === personId)
    if (rows.length === 0) {
      lines.push(`${name}: ${none}`)
      continue
    }
    const text = rows.map((entry) => {
      const title = workspace.encounters.find((encounter) => encounter.id === entry.encounterId)?.title ?? entry.encounterId
      return lang === 'en' ? `${labels[entry.status]} in ${title}` : `${labels[entry.status]} en ${title}`
    }).join('; ')
    lines.push(`${name}: ${text}`)
  }
  return lines.join('\n')
}
