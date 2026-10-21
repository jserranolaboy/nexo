import { t as tr, locale } from './i18n'
import type { Attendance, Snapshot, Status } from './domain'

export const attendanceName = (s: Snapshot, row: Attendance) =>
  row.memberNameSnapshot || s.members.find((m) => m.id === row.memberID)?.name || tr('Persona')
export const searchKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim()
export function attendanceCounts(rows: Attendance[]) {
  const counts: Record<Status, number> = { pending: 0, present: 0, absent: 0, excused: 0 }
  for (const row of rows) if (!row.isVoided) counts[row.status]++
  return counts
}
export function pendingQueue(rows: Attendance[], s: Snapshot) {
  return rows
    .filter((row) => !row.isVoided && row.status === 'pending')
    .sort((a, b) =>
      attendanceName(s, a).localeCompare(attendanceName(s, b), locale, { sensitivity: 'base' }),
    )
    .map((row) => row.memberID)
}
