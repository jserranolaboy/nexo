import { emptySnapshot, id, newTemplate } from './domain'
import type { Activity, Status } from './domain'
export function makeDemo() {
  const s = emptySnapshot(),
    orgID = id(),
    now = new Date()
  const day = (offset: number, hour = 17) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour).toISOString()
  s.organizations = [
    { id: orgID, name: 'Círculo', accentHex: '#262629', timeZoneIdentifier: 'America/Puerto_Rico' },
  ]
  s.periods = [
    {
      id: id(),
      organizationID: orgID,
      name: `${now.getFullYear()} · ${now.getMonth() < 6 ? 'enero–junio' : 'julio–diciembre'}`,
      startsAt: new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1).toISOString(),
      endsAt: new Date(now.getFullYear(), now.getMonth() < 6 ? 6 : 12, 1).toISOString(),
    },
  ]
  const previousStart = new Date(now.getFullYear(), (now.getMonth() < 6 ? 0 : 6) - 6, 1)
  s.periods.push({
    id: id(),
    organizationID: orgID,
    name: `${previousStart.getFullYear()} · ${previousStart.getMonth() < 6 ? 'enero–junio' : 'julio–diciembre'}`,
    startsAt: previousStart.toISOString(),
    endsAt: s.periods[0].startsAt,
  })
  s.components = ['Servicio', 'Formación', 'Comunidad'].map((name) => ({
    id: id(),
    organizationID: orgID,
    name,
  }))
  s.categories = ['Clínicas', 'Acompañamiento'].map((name) => ({
    id: id(),
    componentID: s.components[0].id,
    name,
  }))
  s.groups = ['Equipo base', 'Nuevos integrantes'].map((name) => ({
    id: id(),
    organizationID: orgID,
    name,
  }))
  s.members = [
    'Ana Rivera',
    'Mateo Santos',
    'Lucía Torres',
    'Gabriel León',
    'Isabel Vega',
    'Diego Flores',
    'Valeria Cruz',
    'Nicolás Ríos',
    'Camila Sol',
    'Adrián Mora',
    'Elena Suárez',
    'Tomás Vidal',
    'Sofía Marín',
    'Andrés Luna',
    'Mariana Gil',
    'Pablo Fuentes',
    'Clara Ortiz',
    'Daniel Paz',
  ].map((name) => ({ id: id(), organizationID: orgID, name, isActive: true }))
  s.memberships = s.members.map((m, i) => ({
    id: id(),
    memberID: m.id,
    groupID: s.groups[i < 12 ? 0 : 1].id,
    startsAt: s.periods[1].startsAt,
  }))
  const event = (
    title: string,
    offset: number,
    component: number,
    volunteer = false,
  ): Activity => ({
    id: id(),
    organizationID: orgID,
    title,
    startsAt: day(offset),
    componentID: s.components[component].id,
    categoryID: component === 0 ? s.categories[0].id : undefined,
    countsAttendance: true,
    isCancelled: false,
    volunteerCapacity: volunteer ? 4 : undefined,
  })
  s.events = [
    event('Jornada de bienestar', 0, 0, true),
    event('Reunión de comunidad', 3, 2),
    event('Taller de formación', 7, 1),
    event('Encuentro de comunidad', 12, 2),
    event('Clínica de orientación', -7, 0, true),
    event('Primera jornada', -14, 0, true),
    ...['Jornada de servicio', 'Taller inicial', 'Clínica comunitaria'].map((title, index) => ({
      ...event(title, 0, index === 1 ? 1 : 0),
      startsAt: new Date(
        previousStart.getFullYear(),
        previousStart.getMonth() + 4,
        5 + index * 7,
        17,
      ).toISOString(),
    })),
  ]
  s.events.forEach((e, ei) =>
    s.members.slice(0, ei === 0 ? 12 : 16).forEach((m, i) => {
      if (ei > 0 && ei < 4) return
      const status: Status =
        ei === 0
          ? i < 4
            ? 'present'
            : 'pending'
          : (i + ei) % 6 === 0
            ? 'excused'
            : (i + ei) % 5 === 0
              ? 'absent'
              : 'present'
      s.attendance.push({
        id: id(),
        eventID: e.id,
        memberID: m.id,
        status,
        isVoided: false,
        note: '',
        memberNameSnapshot: m.name,
        eventDateSnapshot: e.startsAt,
        componentIDSnapshot: e.componentID,
        categoryIDSnapshot: e.categoryID,
        countsAttendanceSnapshot: true,
      })
    }),
  )
  for (let i = 0; i < 8; i++)
    s.volunteers.push({
      id: id(),
      eventID: s.events[0].id,
      memberID: s.members[i].id,
      status: i === 0 ? 'selected' : 'interested',
      registeredAt: day(-2, i + 8),
    })
  for (const ei of [4, 5])
    for (const mi of [0, 1, 3])
      s.volunteers.push({
        id: id(),
        eventID: s.events[ei].id,
        memberID: s.members[mi].id,
        status: 'completed',
        registeredAt: day(-20),
      })
  s.templates = [
    {
      ...newTemplate(orgID),
      name: 'Hoja de firmas',
      columns: ['participant', 'signature'],
      accentHex: '#262629',
      rowHeight: 36,
    },
    { ...newTemplate(orgID), name: 'Registro del encuentro', accentHex: '#6E6E73' },
  ]
  return s
}
