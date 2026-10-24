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
  store.save(workspace, 0)
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
  const heading = lang === 'en' ? 'Suggestion' : 'Sugerencia'
  const lines = [`${space.name} [${space.timeZone}]`, `${heading}: ${suggestion.length === 0 ? (lang === 'en' ? 'none' : 'ninguna') : suggestion}`]
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
