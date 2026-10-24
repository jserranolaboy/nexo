import { DomainError } from './errors.ts'
import type { Workspace } from './model.ts'
import { containsInstant } from './time.ts'

export interface AttendanceRate {
  present: number
  absent: number
  excused: number
  pending: number
  counted: number
  ratio: number | null
}

const EMPTY: AttendanceRate = {
  present: 0,
  absent: 0,
  excused: 0,
  pending: 0,
  counted: 0,
  ratio: null,
}

export function attendanceRate(
  workspace: Workspace,
  personId: string,
  periodId?: string,
  componentId?: string,
): AttendanceRate {
  const period = periodId ? workspace.periods.find((item) => item.id === periodId) : undefined
  if (periodId && !period) throw new DomainError('missing-period')
  const encounters = new Map(workspace.encounters.map((encounter) => [encounter.id, encounter]))
  const rate = { ...EMPTY }
  for (const row of workspace.attendance) {
    if (row.personId !== personId || row.voided) continue
    const encounter = encounters.get(row.encounterId)
    if (!encounter || encounter.cancelled || !row.countsAttendance) continue
    if (period && encounter.spaceId !== period.spaceId) continue
    if (period && !containsInstant(period.startsAt, period.endsAt, row.eventInstant)) continue
    if (componentId && row.componentId !== componentId) continue
    rate[row.status] += 1
  }
  rate.counted = rate.present + rate.absent
  rate.ratio = rate.counted > 0 ? rate.present / rate.counted : null
  return rate
}

export function peopleOffRoster(workspace: Workspace, encounterId: string): string[] {
  const listed = new Set(
    workspace.attendance.filter((row) => row.encounterId === encounterId).map((row) => row.personId),
  )
  return workspace.people.filter((person) => !listed.has(person.id)).map((person) => person.id)
}
