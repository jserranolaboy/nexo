export const SCHEMA = 'nexo-reconstruction-v1' as const

export type AttendanceStatus = 'pending' | 'present' | 'absent' | 'excused'
export type VolunteerStatus = 'interested' | 'selected' | 'declined' | 'completed' | 'noShow'

export interface Space {
  id: string
  name: string
  timeZone: string
}

export interface Period {
  id: string
  spaceId: string
  name: string
  startsAt: string
  endsAt: string
}

export interface Person {
  id: string
  spaceId: string
  name: string
  active: boolean
}

export interface Group {
  id: string
  spaceId: string
  name: string
}

export interface Membership {
  id: string
  personId: string
  groupId: string
  startsAt: string
  endsAt: string | null
}

export interface Component {
  id: string
  spaceId: string
  name: string
}

export interface Encounter {
  id: string
  spaceId: string
  title: string
  startsAt: string
  componentId: string
  categoryId: string | null
  countsAttendance: boolean
  cancelled: boolean
  volunteerCapacity: number | null
}

export interface Attendance {
  id: string
  encounterId: string
  personId: string
  status: AttendanceStatus
  voided: boolean
  note: string
  recordedAt: string | null
  eventInstant: string
  componentId: string
  categoryId: string | null
  countsAttendance: boolean
}

export interface Volunteer {
  id: string
  encounterId: string
  personId: string
  status: VolunteerStatus
  registeredAt: string
}

export interface CollaborationVersion {
  id: string
  value: string
}

export interface CollaborationEntry {
  key: string
  versions: CollaborationVersion[]
}

export interface CollaborationLink {
  spaceId: string
  paused: boolean
  pendingUploads: string[]
  entries: CollaborationEntry[]
}

export interface Workspace {
  schema: typeof SCHEMA
  schemaVersion: 1
  revision: number
  spaces: Space[]
  periods: Period[]
  people: Person[]
  groups: Group[]
  memberships: Membership[]
  components: Component[]
  encounters: Encounter[]
  attendance: Attendance[]
  volunteers: Volunteer[]
  collaboration: CollaborationLink[]
}

export function emptyWorkspace(): Workspace {
  return {
    schema: SCHEMA,
    schemaVersion: 1,
    revision: 0,
    spaces: [],
    periods: [],
    people: [],
    groups: [],
    memberships: [],
    components: [],
    encounters: [],
    attendance: [],
    volunteers: [],
    collaboration: [],
  }
}
