import { describe, expect, it } from 'vitest'
import { attendanceCounts, pendingQueue, searchKey } from './attendanceModel'
import { emptySnapshot, simulateAction } from './domain'
import type { Attendance, Status } from './domain'
const row = (name: string, status: Status = 'pending', excluded = false): Attendance => ({
  id: name,
  memberID: name,
  eventID: 'e',
  status,
  isVoided: excluded,
  note: '',
  memberNameSnapshot: name,
})
describe('Registro de asistencia', () => {
  it('prepara la ronda solo con pendientes incluidos, ordenados por nombre', () => {
    const rows = [row('Érika'), row('Ana'), row('Bea', 'present'), row('Carla', 'pending', true)]
    expect(pendingQueue(rows, emptySnapshot())).toEqual(['Ana', 'Érika'])
    expect(rows[0].memberID).toBe('Érika')
  })
  it('cuenta registros, sin confundir la cobertura con el porcentaje de asistencia', () => {
    expect(
      attendanceCounts([
        row('a', 'present'),
        row('b', 'excused'),
        row('c'),
        row('d', 'absent', true),
      ]),
    ).toEqual({ present: 1, absent: 0, excused: 1, pending: 1 })
  })
  it('encuentra nombres aunque la búsqueda omita acentos o incluya espacios', () => {
    expect(searchKey('  Lucía TORRES ')).toBe('lucia torres')
  })
  it('rechaza deshacer si el estado cambió y conserva el registro original', () => {
    const s = emptySnapshot()
    s.attendance = [row('Ana', 'excused')]
    expect(() =>
      simulateAction(s, {
        kind: 'attendance',
        eventID: 'e',
        memberID: 'Ana',
        status: 'pending',
        expectedStatus: 'present',
      }),
    ).toThrow('Este registro cambió')
    expect(s.attendance[0].status).toBe('excused')
  })
  it('guardar una nota no sustituye el estado con uno anterior', () => {
    const s = emptySnapshot()
    s.attendance = [row('Ana', 'excused')]
    const next = simulateAction(s, {
      kind: 'attendance',
      eventID: 'e',
      memberID: 'Ana',
      status: 'pending',
      note: 'Avisó',
      expectedNote: '',
      noteOnly: true,
    })
    expect(next.attendance[0].status).toBe('excused')
    expect(next.attendance[0].note).toBe('Avisó')
  })
})
