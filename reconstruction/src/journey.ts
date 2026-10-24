import { attendanceRate } from './attendance.ts'
import {
  addComponent,
  addPeriod,
  addPerson,
  createEncounter,
  createSpace,
  setAttendance,
} from './commands.ts'
import { emptyWorkspace } from './model.ts'
import { FileWorkspaceStore } from './store.ts'

export const SYNTHETIC = {
  spaceId: '11111111-1111-4111-8111-111111111111',
  periodId: '22222222-2222-4222-8222-222222222222',
  alfaId: '33333333-3333-4333-8333-333333333331',
  betaId: '33333333-3333-4333-8333-333333333332',
  gammaId: '33333333-3333-4333-8333-333333333333',
  componentId: '44444444-4444-4444-8444-444444444444',
  encounterId: '55555555-5555-4555-8555-555555555555',
  spaceName: 'Espacio sintético',
  periodName: 'Período sintético',
  alfaName: 'Persona Alfa',
  betaName: 'Persona Beta',
  gammaName: 'Persona Gamma',
  encounterTitle: 'Encuentro sintético',
  timeZone: 'Etc/UTC',
  periodStart: '2026-01-01T00:00:00.000Z',
  periodEnd: '2027-01-01T00:00:00.000Z',
  encounterAt: '2026-10-24T15:00:00.000Z',
  recordedAt: '2026-10-24T15:05:00.000Z',
} as const

export function runFirstJourney(directory: string): void {
  const store = new FileWorkspaceStore(directory)
  let workspace = store.initialize(emptyWorkspace())
  workspace = createSpace(workspace, {
    id: SYNTHETIC.spaceId,
    name: SYNTHETIC.spaceName,
    timeZone: SYNTHETIC.timeZone,
  })
  workspace = addPeriod(workspace, {
    id: SYNTHETIC.periodId,
    spaceId: SYNTHETIC.spaceId,
    name: SYNTHETIC.periodName,
    startsAt: SYNTHETIC.periodStart,
    endsAt: SYNTHETIC.periodEnd,
  })
  workspace = addPerson(workspace, { id: SYNTHETIC.alfaId, spaceId: SYNTHETIC.spaceId, name: SYNTHETIC.alfaName })
  workspace = addPerson(workspace, { id: SYNTHETIC.betaId, spaceId: SYNTHETIC.spaceId, name: SYNTHETIC.betaName })
  workspace = addPerson(workspace, { id: SYNTHETIC.gammaId, spaceId: SYNTHETIC.spaceId, name: SYNTHETIC.gammaName })
  workspace = addComponent(workspace, {
    id: SYNTHETIC.componentId,
    spaceId: SYNTHETIC.spaceId,
    name: 'Componente sintético',
  })
  workspace = createEncounter(workspace, {
    id: SYNTHETIC.encounterId,
    spaceId: SYNTHETIC.spaceId,
    title: SYNTHETIC.encounterTitle,
    startsAt: SYNTHETIC.encounterAt,
    componentId: SYNTHETIC.componentId,
    personIds: [SYNTHETIC.alfaId, SYNTHETIC.betaId],
  })
  workspace = setAttendance(workspace, {
    encounterId: SYNTHETIC.encounterId,
    personId: SYNTHETIC.alfaId,
    status: 'present',
    recordedAt: SYNTHETIC.recordedAt,
  })
  workspace = setAttendance(workspace, {
    encounterId: SYNTHETIC.encounterId,
    personId: SYNTHETIC.betaId,
    status: 'absent',
    recordedAt: SYNTHETIC.recordedAt,
  })
  store.save(workspace, 0)
}

export function describeJourney(directory: string, lang: 'es' | 'en'): string {
  const workspace = new FileWorkspaceStore(directory).load()
  const space = workspace.spaces[0]
  const labels = lang === 'en'
    ? { present: 'present', absent: 'absent', excused: 'excused', pending: 'pending', none: 'no record', empty: 'no countable encounters' }
    : { present: 'presente', absent: 'ausente', excused: 'excusada', pending: 'por registrar', none: 'sin registro', empty: 'sin encuentros evaluables' }
  const lines = [`${space.name} [${space.timeZone}]`]
  for (const person of workspace.people) {
    const row = workspace.attendance.find((item) => item.personId === person.id)
    const rate = attendanceRate(workspace, person.id, workspace.periods[0]?.id)
    const mark = row ? labels[row.status] : labels.none
    const score = rate.ratio == null ? labels.empty : `${rate.present}/${rate.counted}`
    lines.push(`${person.name}: ${mark}; ${score}`)
  }
  return lines.join('\n')
}
