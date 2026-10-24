import { t as tr } from './i18n'
export type ID = string
export type Status = 'pending' | 'present' | 'absent' | 'excused'
export type VolunteerStatus = 'interested' | 'selected' | 'completed' | 'declined' | 'noShow'
export interface Organization {
  id: ID
  name: string
  accentHex: string
  timeZoneIdentifier: string
  deletedAt?: string | null
}
export interface Period {
  id: ID
  organizationID: ID
  name: string
  startsAt: string
  endsAt: string
}
export interface Member {
  id: ID
  organizationID: ID
  name: string
  isActive: boolean
}
export interface Group {
  id: ID
  organizationID: ID
  name: string
}
export interface Membership {
  id: ID
  memberID: ID
  groupID: ID
  startsAt: string
  endsAt?: string
}
export interface Component {
  id: ID
  organizationID: ID
  name: string
}
export interface Category {
  id: ID
  componentID: ID
  name: string
}
export interface Activity {
  id: ID
  organizationID: ID
  title: string
  startsAt: string
  componentID: ID
  categoryID?: ID | null
  countsAttendance: boolean
  isCancelled: boolean
  volunteerCapacity?: number | null
}
export interface Attendance {
  id: ID
  eventID: ID
  memberID: ID
  status: Status
  isVoided: boolean
  note: string
  recordedAt?: string
  memberNameSnapshot?: string
  groupIDsSnapshot?: ID[]
  eventDateSnapshot?: string
  componentIDSnapshot?: ID
  categoryIDSnapshot?: ID | null
  countsAttendanceSnapshot?: boolean
}
export interface Volunteer {
  id: ID
  eventID: ID
  memberID: ID
  status: VolunteerStatus
  registeredAt: string
}
export type Column = 'participant' | 'present' | 'absent' | 'excused' | 'signature' | 'notes'
export interface TextBlock {
  id: ID
  text: string
  x: number
  y: number
  width: number
  fontSize: number
}
export interface ImageBlock {
  id: ID
  imageData: string
  x: number
  y: number
  width: number
  height: number
}
export interface Template {
  id: ID
  organizationID: ID
  name: string
  format: 'visual' | 'pdf' | 'docx'
  columns: Column[]
  accentHex: string
  rowHeight: number
  headerTitle?: string
  headerSubtitle?: string
  footerText?: string
  showsPageNumber?: boolean
  columnLabels?: Record<string, string>
  textBlocks?: TextBlock[]
  imageBlocks?: ImageBlock[]
  backgroundPDFData?: string
  listPageIndex?: number
  tableTopOffset?: number
  sourceObjectKey?: string
}
export interface Snapshot {
  schemaVersion: number
  revision: number
  organizations: Organization[]
  periods: Period[]
  members: Member[]
  groups: Group[]
  memberships: Membership[]
  components: Component[]
  categories: Category[]
  events: Activity[]
  attendance: Attendance[]
  volunteers: Volunteer[]
  templates: Template[]
  collaborators: unknown[]
  syncStates: unknown[]
  resolvedSyncConflicts: unknown[]
}
export interface Action {
  kind: string
  [key: string]: unknown
}
export const statusLabels: Record<Status, string> = {
  pending: tr('Pendiente'),
  present: tr('Presente'),
  absent: tr('Ausente'),
  excused: tr('Excusada'),
}
export const columnLabels: Record<Column, string> = {
  participant: tr('Nombre'),
  present: tr('Presente'),
  absent: tr('Ausente'),
  excused: tr('Excusada'),
  signature: tr('Firma'),
  notes: tr('Notas'),
}
export const id = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toUpperCase()
}
export const emptySnapshot = (): Snapshot => ({
  schemaVersion: 1,
  revision: 0,
  organizations: [],
  periods: [],
  members: [],
  groups: [],
  memberships: [],
  components: [],
  categories: [],
  events: [],
  attendance: [],
  volunteers: [],
  templates: [],
  collaborators: [],
  syncStates: [],
  resolvedSyncConflicts: [],
})
export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
export const inPeriod = (date: string, period?: Period) =>
  !period ||
  (new Date(date) >= new Date(period.startsAt) && new Date(date) < new Date(period.endsAt))
export interface AttendanceResult {
  rows: Attendance[]
  present: number
  absent: number
  excused: number
  pending: number
  total: number
  percentage: number | null
}
export const emptyAttendanceResult = (): AttendanceResult => ({
  rows: [],
  present: 0,
  absent: 0,
  excused: 0,
  pending: 0,
  total: 0,
  percentage: null,
})
/** One pass over a period, regardless of the number of people in the report. */
export function attendanceIndex(s: Snapshot, period?: Period, componentID?: ID, categoryID?: ID) {
  const events = new Map(s.events.map((e) => [e.id, e])),
    results = new Map<ID, AttendanceResult>()
  for (const a of s.attendance) {
    const e = events.get(a.eventID)
    if (
      !e ||
      e.isCancelled ||
      a.isVoided ||
      !(a.countsAttendanceSnapshot ?? e.countsAttendance) ||
      (period && e.organizationID !== period.organizationID) ||
      !inPeriod(a.eventDateSnapshot ?? e.startsAt, period) ||
      (componentID && (a.componentIDSnapshot ?? e.componentID) !== componentID) ||
      (categoryID && (a.categoryIDSnapshot ?? e.categoryID) !== categoryID)
    )
      continue
    const result = results.get(a.memberID) ?? emptyAttendanceResult()
    result.rows.push(a)
    result[a.status]++
    results.set(a.memberID, result)
  }
  for (const r of results.values()) {
    r.total = r.present + r.absent
    r.percentage = r.total ? Math.round((r.present / r.total) * 100) : null
  }
  return results
}
export function attendanceResult(
  s: Snapshot,
  memberID: ID,
  period?: Period,
  componentID?: ID,
  categoryID?: ID,
) {
  return (
    attendanceIndex(s, period, componentID, categoryID).get(memberID) ?? emptyAttendanceResult()
  )
}
// Compare JavaScript date instants (millisecond precision), not ISO spellings.
// Invalid registrations stay visible after dated peers; identity breaks their ties.
function compareInstants(left: string, right: string) {
  const a = Date.parse(left),
    b = Date.parse(right),
    validA = Number.isFinite(a),
    validB = Number.isFinite(b)
  if (validA !== validB) return validA ? -1 : 1
  return validA ? a - b : 0
}
export function volunteerOrder(s: Snapshot, event: Activity, period?: Period) {
  if (
    (period && period.organizationID !== event.organizationID) ||
    event.volunteerCapacity == null ||
    !Number.isFinite(Date.parse(event.startsAt)) ||
    !inPeriod(event.startsAt, period) ||
    event.isCancelled
  )
    return []
  return s.volunteers
    .filter((v) => v.eventID === event.id && v.status === 'interested')
    .flatMap((v) => {
      const member = s.members.find(
        (m) => m.id === v.memberID && m.organizationID === event.organizationID && m.isActive,
      )
      if (!member) return []
      const dates = s.volunteers
        .filter((p) => p.memberID === member.id && p.status === 'completed')
        .flatMap((p) => {
          const e = s.events.find((e) => e.id === p.eventID)
          return e &&
            e.organizationID === event.organizationID &&
            !e.isCancelled &&
            e.id !== event.id &&
            new Date(e.startsAt) < new Date(event.startsAt) &&
            inPeriod(e.startsAt, period) &&
            (event.categoryID
              ? e.categoryID === event.categoryID
              : e.componentID === event.componentID)
            ? [e.startsAt]
            : []
        })
        .sort(compareInstants)
      return [{ ...v, member, count: dates.length, last: dates.at(-1) ?? '' }]
    })
    .sort(
      (a, b) =>
        a.count - b.count ||
        (a.last && b.last ? compareInstants(a.last, b.last) : a.last ? 1 : b.last ? -1 : 0) ||
        compareInstants(a.registeredAt, b.registeredAt) ||
        a.memberID.localeCompare(b.memberID),
    )
}
export function newTemplate(orgID: ID): Template {
  return {
    id: id(),
    organizationID: orgID,
    name: tr('Registro de asistencia'),
    format: 'visual',
    columns: ['participant', 'present', 'absent', 'excused', 'signature'],
    accentHex: '#262629',
    rowHeight: 30,
    columnLabels: { ...columnLabels },
    tableTopOffset: 100,
    textBlocks: [],
    imageBlocks: [],
  }
}
const validIdentifier = (value: unknown): value is ID =>
  typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
function rosterSelection(value: unknown, optional = false): ID[] {
  if (optional && value === undefined) return []
  if (!Array.isArray(value) || value.length > 10000 || value.some((id) => !validIdentifier(id)))
    throw new Error(tr('La selección no es válida.'))
  const selected = value.map((id: string) => id.toUpperCase())
  if (new Set(selected).size !== selected.length)
    throw new Error(tr('La selección contiene registros repetidos.'))
  return selected
}
function addAttendanceMembers(s: Snapshot, event: Activity, memberIDs: ID[]) {
  if (event.isCancelled) throw new Error(tr('Este encuentro no está disponible.'))
  if (!memberIDs.length) throw new Error(tr('La selección no es válida.'))
  for (const memberID of memberIDs) {
    if (s.attendance.some((a) => a.eventID === event.id && a.memberID === memberID))
      throw new Error(tr('Esta persona ya tiene un registro.'))
    const member = s.members.find(
      (m) => m.id === memberID && m.organizationID === event.organizationID && m.isActive,
    )
    if (!member) throw new Error(tr('La persona no pertenece a este espacio.'))
    s.attendance.push({
      id: id(),
      eventID: event.id,
      memberID,
      status: 'pending',
      isVoided: false,
      note: '',
      memberNameSnapshot: member.name,
      groupIDsSnapshot: s.groups.filter((g) => g.organizationID === event.organizationID && activeMembership(s, memberID, g.id, new Date(event.startsAt))).map((g) => g.id),
      eventDateSnapshot: event.startsAt,
      componentIDSnapshot: event.componentID,
      categoryIDSnapshot: event.categoryID,
      countsAttendanceSnapshot: event.countsAttendance,
    })
  }
}
// Used only in the explicitly labelled simulation. Native edits are validated by NexoCore.
export function simulateAction(snapshot: Snapshot, action: Action): Snapshot {
  const s = structuredClone(snapshot)
  const orgID = action.organizationID as string
  const eventID = action.eventID as string
  const memberID = action.memberID as string
  const event = s.events.find((e) => e.id === eventID)
  const text = String(action.name ?? '').trim()
  const renamed =
    action.kind === 'rename'
      ? action.entity === 'organization'
        ? String(action.id)
        : action.entity === 'category'
          ? s.components.find(
              (c) => c.id === s.categories.find((x) => x.id === action.id)?.componentID,
            )?.organizationID
          : [...s.components, ...s.groups].find((x) => x.id === action.id)?.organizationID
      : undefined
  const targetOrg =
    renamed ||
    orgID ||
    (action.entity as { organizationID?: string } | undefined)?.organizationID ||
    event?.organizationID ||
    s.members.find((m) => m.id === memberID)?.organizationID ||
    s.components.find((c) => c.id === action.componentID)?.organizationID
  if (
    action.kind !== 'setOrganizationDeleted' &&
    s.organizations.some((o) => o.id === targetOrg && o.deletedAt)
  )
    throw new Error(tr('Este espacio está en Papelera. Restáuralo antes de editarlo.'))
  switch (action.kind) {
    case 'setOrganizationDeleted': {
      const org = s.organizations.find((o) => o.id === orgID)
      if (!org) throw new Error(tr('No se encontró el espacio.'))
      if (!!org.deletedAt !== action.expectedDeleted || org.name !== action.expectedName)
        throw new Error(tr('El espacio cambió. Revisa su estado antes de continuar.'))
      org.deletedAt = action.deleted ? new Date().toISOString() : null
      break
    }
    case 'createOrganization': {
      if (!text) throw new Error(tr('Escribe el nombre del espacio.'))
      const org = {
        id: String(action.id || id()),
        name: text,
        accentHex: '#262629',
        timeZoneIdentifier: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }
      s.organizations.push(org)
      break
    }
    case 'addMember': {
      if (!text) throw new Error(tr('Escribe el nombre de la persona.'))
      const member = {
        id: String(action.id || id()),
        organizationID: orgID,
        name: text,
        isActive: true,
      }
      s.members.push(member)
      for (const groupID of (action.groupIDs as string[]) || [])
        s.memberships.push({
          id: id(),
          memberID: member.id,
          groupID,
          startsAt: new Date().toISOString(),
        })
      break
    }
    case 'updateMember': {
      const m = s.members.find((m) => m.id === memberID)
      if (!m) throw new Error(tr('No se encontró a la persona.'))
      if (text) m.name = text
      if (typeof action.isActive === 'boolean') m.isActive = action.isActive
      break
    }
    case 'memberGroups': {
      const wanted = new Set(action.groupIDs as string[]),
        now = new Date().toISOString()
      for (const g of s.memberships.filter(
        (g) => g.memberID === memberID && !g.endsAt && !wanted.has(g.groupID),
      ))
        g.endsAt = now
      for (const groupID of wanted)
        if (
          !s.memberships.some((g) => g.memberID === memberID && g.groupID === groupID && !g.endsAt)
        )
          s.memberships.push({ id: id(), memberID, groupID, startsAt: now })
      break
    }
    case 'addComponent':
      if (!text) throw new Error(tr('Escribe un nombre.'))
      s.components.push({ id: String(action.id || id()), organizationID: orgID, name: text })
      break
    case 'addCategory':
      if (!text) throw new Error(tr('Escribe un nombre.'))
      s.categories.push({
        id: String(action.id || id()),
        componentID: action.componentID as string,
        name: text,
      })
      break
    case 'addGroup':
      if (!text) throw new Error(tr('Escribe un nombre.'))
      s.groups.push({ id: String(action.id || id()), organizationID: orgID, name: text })
      break
    case 'addPeriod': {
      const period = action.entity as Period
      if (new Date(period.endsAt) <= new Date(period.startsAt))
        throw new Error(tr('El último día debe ser posterior al inicio.'))
      s.periods.push(period)
      break
    }
    case 'updatePeriod': {
      const period = action.entity as Period,
        index = s.periods.findIndex((p) => p.id === period.id)
      if (index < 0) throw new Error(tr('No se encontró el período.'))
      if (!period.name.trim() || new Date(period.endsAt) <= new Date(period.startsAt))
        throw new Error(tr('Revisa el nombre y las fechas del período.'))
      s.periods[index] = period
      break
    }
    case 'addEvent': {
      const next = structuredClone(action.entity as Activity)
      if (!next || !validIdentifier(next.id) || !validIdentifier(next.organizationID) ||
          !validIdentifier(next.componentID) || (next.categoryID != null && !validIdentifier(next.categoryID)) ||
          typeof next.title !== 'string' || !next.title.trim() ||
          typeof next.startsAt !== 'string' || Number.isNaN(new Date(next.startsAt).getTime()) ||
          typeof next.countsAttendance !== 'boolean' || typeof next.isCancelled !== 'boolean' ||
          (next.volunteerCapacity != null && (!Number.isSafeInteger(next.volunteerCapacity) || next.volunteerCapacity < 0)) ||
          s.events.some((e) => e.id === next.id) ||
          !s.organizations.some((o) => o.id === next.organizationID) ||
          !s.components.some((c) => c.id === next.componentID && c.organizationID === next.organizationID) ||
          (next.categoryID != null && !s.categories.some((c) => c.id === next.categoryID && c.componentID === next.componentID)))
        throw new Error(tr('Revisa los datos: hay un nombre, fecha o relación que no es válida.'))
      const selected = rosterSelection(action.memberIDs, true)
      s.events.push(next)
      if (selected.length) addAttendanceMembers(s, next, selected)
      break
    }
    case 'updateEvent': {
      const next = action.entity as Activity,
        index = s.events.findIndex((e) => e.id === next.id)
      if (index < 0) throw new Error(tr('Este encuentro no está disponible.'))
      if (!next.title.trim()) throw new Error(tr('Escribe el nombre del encuentro.'))
      const occupied = s.volunteers.filter(
        (v) => v.eventID === next.id && ['selected', 'completed'].includes(v.status),
      ).length
      if (next.volunteerCapacity == null && s.volunteers.some((v) => v.eventID === next.id))
        throw new Error(
          tr('Este encuentro ya tiene voluntarios. Ajusta los cupos en lugar de quitarlos.'),
        )
      if (next.volunteerCapacity != null && next.volunteerCapacity < Math.max(1, occupied))
        throw new Error(tr('Hay más voluntarios seleccionados que cupos.'))
      s.events[index] = next
      for (const a of s.attendance.filter((a) => a.eventID === next.id)) {
        a.eventDateSnapshot = next.startsAt
        a.componentIDSnapshot = next.componentID
        a.categoryIDSnapshot = next.categoryID
        a.countsAttendanceSnapshot = next.countsAttendance
      }
      break
    }
    case 'rename': {
      if (!text) throw new Error(tr('Escribe un nombre.'))
      const list = {
        organization: s.organizations,
        component: s.components,
        category: s.categories,
        group: s.groups,
      }[action.entity as string] as { id: ID; name: string }[] | undefined
      const item = list?.find((x) => x.id === action.id)
      if (!item) throw new Error(tr('Esta acción no está disponible.'))
      item.name = text
      break
    }
    case 'cancelEvent':
      if (event) event.isCancelled = action.cancelled as boolean
      break
    case 'roster': {
      if (!event) throw new Error(tr('Este encuentro no está disponible.'))
      addAttendanceMembers(s, event, rosterSelection(action.memberIDs))
      break
    }
    case 'attendance': {
      const a = s.attendance.find(
        (a) => a.eventID === eventID && a.memberID === memberID && !a.isVoided,
      )
      if (!a) throw new Error(tr('Primero añade a la persona a la lista.'))
      if (typeof action.expectedStatus === 'string' && action.expectedStatus !== a.status)
        throw new Error(tr('Este registro cambió. Revisa su estado actual antes de modificarlo.'))
      if (typeof action.expectedNote === 'string' && action.expectedNote !== a.note)
        throw new Error(tr('La nota cambió. Revisa la versión actual antes de guardarla.'))
      if (!action.noteOnly) a.status = action.status as Status
      a.recordedAt = new Date().toISOString()
      if (typeof action.note === 'string') a.note = action.note
      break
    }
    case 'inclusion': {
      const a = s.attendance.find((a) => a.eventID === eventID && a.memberID === memberID)
      if (a) a.isVoided = !action.included
      break
    }
    case 'registerVolunteers': {
      for (const personID of action.memberIDs as string[]) {
        if (!s.volunteers.some((v) => v.eventID === eventID && v.memberID === personID))
          s.volunteers.push({
            id: id(),
            eventID,
            memberID: personID,
            status: 'interested',
            registeredAt: new Date().toISOString(),
          })
      }
      break
    }
    case 'volunteer': {
      const v = s.volunteers.find((v) => v.eventID === eventID && v.memberID === memberID)
      if (!v || !event || (event.isCancelled && action.status === 'selected'))
        throw new Error(tr('El voluntariado no está disponible.'))
      const next = action.status as VolunteerStatus
      const allowed: Record<VolunteerStatus, VolunteerStatus[]> = {
        interested: [],
        selected: ['interested'],
        completed: ['selected'],
        noShow: ['selected'],
        declined: ['interested', 'selected'],
      }
      if (!allowed[next].includes(v.status)) throw new Error(tr('No se puede realizar ese cambio.'))
      if (
        next === 'selected' &&
        s.volunteers.filter(
          (v) => v.eventID === eventID && ['selected', 'completed'].includes(v.status),
        ).length >= (event.volunteerCapacity ?? 0)
      )
        throw new Error(tr('Los cupos están completos.'))
      v.status = next
      break
    }
    case 'saveTemplate': {
      const t = action.entity as Template,
        index = s.templates.findIndex((t2) => t2.id === t.id)
      if (index < 0) s.templates.push(t)
      else s.templates[index] = t
      break
    }
    default:
      throw new Error(tr('Acción no disponible.'))
  }
  s.revision++
  return s
}

/** Reserve the renderer's 30-point header, 67-point footer and one complete row. */
export const maximumTableOffset = (page: { height: number }, rowHeight: number) =>
  Math.min(600, page.height - 30 - 67 - Math.max(34, rowHeight))
export const canFitAttendancePage = (page: { width: number; height: number }, rowHeight: number) =>
  Number.isFinite(page.width) && Number.isFinite(page.height) &&
  Number.isFinite(rowHeight) && rowHeight > 0 && page.width >= 260 && page.height >= 350 &&
  maximumTableOffset(page, rowHeight) >= 100

/** Width limits preserve aspect ratio and the native 20...2000-point image bounds. */
export function imageWidthBounds(image: ImageBlock, page: { width: number; height: number }) {
  if (
    ![image.width, image.height, image.x, image.y, page.width, page.height].every(Number.isFinite) ||
    image.width <= 0 || image.height <= 0 || image.x < 0 || image.y < 0
  ) return null
  const ratio = image.height / image.width,
    min = Math.max(20, 20 / ratio),
    max = Math.min(2000, page.width - image.x, Math.min(2000, page.height - image.y) / ratio)
  return min <= max ? { min, max } : null
}

export function resizeImageBlock(
  image: ImageBlock,
  requestedWidth: number,
  page: { width: number; height: number },
): ImageBlock {
  const bounds = imageWidthBounds(image, page)
  // A background page may still be loading; do not invent invalid geometry meanwhile.
  if (!bounds || !Number.isFinite(requestedWidth)) return image
  const width = Math.max(bounds.min, Math.min(bounds.max, requestedWidth))
  return {
    ...image,
    width,
    height: Math.max(20, Math.min(2000, page.height - image.y, (image.height / image.width) * width)),
  }
}

/** Keep every element when changing paper size; move it into the new bounds. */
export function fitTemplateToPage(
  template: Template,
  page: { width: number; height: number },
): Partial<Template> {
  const maximum = maximumTableOffset(page, template.rowHeight)
  if (!canFitAttendancePage(page, template.rowHeight))
    throw new Error(tr('El PDF no tiene una página donde pueda colocarse la lista.'))
  return {
    tableTopOffset: Math.max(100, Math.min(template.tableTopOffset ?? 100, maximum)),
    textBlocks: template.textBlocks?.map((b) => {
      const width = Math.max(60, Math.min(b.width, page.width)),
        fontSize = Math.min(32, b.fontSize)
      return {
        ...b,
        width,
        fontSize,
        x: Math.max(0, Math.min(b.x, page.width - width)),
        y: Math.max(0, Math.min(b.y, page.height - fontSize * 2.5)),
      }
    }),
    imageBlocks: template.imageBlocks?.map((b) => {
      const scale = Math.min(1, page.width / b.width, page.height / b.height)
      const width = Math.max(20, b.width * scale),
        height = Math.max(20, b.height * scale)
      return {
        ...b,
        width,
        height,
        x: Math.max(0, Math.min(b.x, page.width - width)),
        y: Math.max(0, Math.min(b.y, page.height - height)),
      }
    }),
  }
}

/** The next whole hour, so a new event never starts at an arbitrary minute. */
export function nextWholeHour(from = new Date()) {
  const d = new Date(from)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}
/** Same time of day on another date; used when duplicating an event. */
export function moveToDay(startsAt: string, day: Date) {
  const source = new Date(startsAt),
    d = new Date(day)
  d.setHours(source.getHours(), source.getMinutes(), 0, 0)
  return d.toISOString()
}
export const activeMembership = (s: Snapshot, memberID: ID, groupID: ID, at = new Date()) =>
  s.memberships.some(
    (g) =>
      g.memberID === memberID &&
      g.groupID === groupID &&
      new Date(g.startsAt) <= at &&
      (!g.endsAt || new Date(g.endsAt) > at),
  )
export const currentGroups = (s: Snapshot, memberID: ID) =>
  s.groups.filter((g) => s.memberships.some((m) => m.memberID === memberID && m.groupID === g.id && !m.endsAt))
