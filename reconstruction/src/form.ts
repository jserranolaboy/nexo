import { existsSync } from 'node:fs'
import path from 'node:path'
import { attendanceRate } from './attendance.ts'
import {
  addComponent,
  addPeriod,
  addPerson,
  chooseVolunteer,
  createEncounter,
  createSpace,
  registerVolunteer,
  setAttendance,
  systemClock,
} from './commands.ts'
import type { AttendanceStatus } from './model.ts'
import { DocumentDraftStore, FileWorkspaceStore } from './store.ts'
import { SYNTHETIC } from './journey.ts'
import { suggestVolunteers } from './volunteers.ts'
import { emptyWorkspace, type Workspace } from './model.ts'
import { DomainError } from './errors.ts'
import {
  describeCollaboration,
  resolvePausedAlternative,
  runCollaborationJourney,
} from './collaboration-journey.ts'
import { migrateLegacyFile, revertToPreviousCopy } from './migrate.ts'
import { syntheticLegacySource } from './interface.ts'

/** Capacity is 1 so a second choice is over the quota. selectVolunteer still decides. */
const FORM_CAPACITY = 1
const CYCLE: readonly AttendanceStatus[] = ['pending', 'present', 'absent', 'excused']

const words = {
  es: {
    pending: 'por registrar',
    present: 'presente',
    absent: 'ausente',
    excused: 'excusada',
    off: 'fuera de la lista',
    empty: 'sin encuentros evaluables',
    suggestion: 'Sugerencia',
    none: 'ninguna',
    overflow: 'No cabe',
    quota: 'Rechazo de cupo',
    interested: 'interesado',
    selected: 'seleccionado',
    declined: 'declinado',
    completed: 'completado',
    noShow: 'no presentado',
  },
  en: {
    pending: 'pending',
    present: 'present',
    absent: 'absent',
    excused: 'excused',
    off: 'off the list',
    empty: 'no countable encounters',
    suggestion: 'Suggestion',
    none: 'none',
    overflow: 'Does not fit',
    quota: 'Quota refusal',
    interested: 'interested',
    selected: 'selected',
    declined: 'declined',
    completed: 'completed',
    noShow: 'no-show',
  },
} as const

export interface FormPerson {
  id: string
  name: string
  listed: boolean
  line: string
  volunteer: string
}

export interface FormAlternative {
  id: string
  value: string
}

export interface FormScreen {
  people: FormPerson[]
  encounterTitle: string
  suggestion: string
  draft: string
  warning: string
  error: string
  refusal: string
  collaboration: string
  alternatives: FormAlternative[]
}

interface FormRequest {
  op?: string
  lang?: string
  name?: string
  title?: string
  roster?: string[]
  personId?: string
  text?: string
  versionId?: string
}

export function applyForm(directory: string, payload: string): string {
  let request: FormRequest
  try {
    request = JSON.parse(payload) as FormRequest
  } catch {
    return JSON.stringify(emptyScreen('invalid-form'))
  }
  const lang = request.lang === 'en' ? 'en' : 'es'
  try {
    change(directory, request)
    const warning = request.op === 'draft' ? draftWarning(directory, request.text ?? '', lang) : ''
    const screen = describeForm(directory, lang)
    screen.warning = warning
    return JSON.stringify(screen)
  } catch (error) {
    const screen = safeDescribe(directory, lang)
    if (error instanceof DomainError && error.code === 'capacity-exceeded') {
      screen.refusal = `${words[lang].quota}: ${error.code}`
    } else {
      screen.error = error instanceof DomainError ? error.code : error instanceof Error ? error.message : String(error)
    }
    return JSON.stringify(screen)
  }
}

function change(directory: string, request: FormRequest): void {
  const store = new FileWorkspaceStore(directory)
  const workspace = ensure(store)
  if (request.op === 'open' || request.op == null) return
  if (request.op === 'add-person') {
    store.save(addPerson(workspace, { spaceId: workspace.spaces[0].id, name: request.name ?? '' }), workspace.revision)
    return
  }
  if (request.op === 'create-encounter') {
    if (workspace.encounters.length > 0) return
    const roster = Array.isArray(request.roster) ? request.roster.filter((id) => typeof id === 'string') : []
    store.save(
      createEncounter(workspace, {
        spaceId: workspace.spaces[0].id,
        title: request.title ?? '',
        startsAt: SYNTHETIC.encounterAt,
        componentId: workspace.components[0].id,
        personIds: roster,
        volunteerCapacity: FORM_CAPACITY,
      }),
      workspace.revision,
    )
    return
  }
  if (request.op === 'collaborate' || request.op === 'choose-alternative' || request.op === 'restore') {
    collaborate(directory, request)
    return
  }
  if (request.op === 'migrate') {
    migrateLegacyFile(directory, syntheticLegacySource(directory))
    return
  }
  if (request.op === 'revert') {
    revertToPreviousCopy(directory)
    return
  }
  const encounter = workspace.encounters[0]
  if (!encounter) throw new DomainError('missing-encounter')
  if (request.op === 'cycle') {
    const row = workspace.attendance.find((item) => item.encounterId === encounter.id && item.personId === request.personId && !item.voided)
    if (!row) throw new DomainError('not-on-roster')
    const next = CYCLE[(CYCLE.indexOf(row.status) + 1) % CYCLE.length]
    store.save(
      setAttendance(workspace, {
        encounterId: encounter.id,
        personId: row.personId,
        status: next,
        recordedAt: systemClock().now(),
      }),
      workspace.revision,
    )
    return
  }
  if (request.op === 'interest') {
    if (workspace.volunteers.some((item) => item.encounterId === encounter.id && item.personId === request.personId)) return
    store.save(
      registerVolunteer(workspace, {
        encounterId: encounter.id,
        personId: request.personId ?? '',
        registeredAt: systemClock().now(),
      }),
      workspace.revision,
    )
    return
  }
  if (request.op === 'choose') {
    store.save(chooseVolunteer(workspace, encounter.id, request.personId ?? ''), workspace.revision)
    return
  }
  if (request.op === 'draft') return
  throw new DomainError('unknown-form')
}

function collaborationDir(directory: string): string {
  return path.join(directory, 'colaboracion')
}

function collaborate(directory: string, request: FormRequest): void {
  const folder = collaborationDir(directory)
  const store = new FileWorkspaceStore(folder)
  if (request.op === 'collaborate') {
    if (!existsSync(store.primaryPath())) runCollaborationJourney(folder)
    return
  }
  if (request.op === 'choose-alternative') {
    resolvePausedAlternative(folder, request.versionId ?? '')
    return
  }
  const before = store.load().collaboration[0]?.pendingUploads.length ?? 0
  const restored = store.restore(path.join(folder, 'synthetic-copy.json'))
  const link = restored.collaboration[0]
  if (!link?.paused || link.pendingUploads.length !== before) throw new DomainError('upload-enqueued')
}

function ensure(store: FileWorkspaceStore): Workspace {
  if (existsSync(store.primaryPath())) return store.load()
  let workspace = createSpace(store.initialize(emptyWorkspace()), {
    name: SYNTHETIC.spaceName,
    timeZone: SYNTHETIC.timeZone,
  })
  const spaceId = workspace.spaces[0].id
  workspace = addPeriod(workspace, {
    spaceId,
    name: SYNTHETIC.periodName,
    startsAt: SYNTHETIC.periodStart,
    endsAt: SYNTHETIC.periodEnd,
  })
  workspace = addComponent(workspace, { spaceId, name: 'Componente sintético' })
  return store.save(workspace, 0)
}

function describeForm(directory: string, lang: 'es' | 'en'): FormScreen {
  const workspace = new FileWorkspaceStore(directory).load()
  const text = words[lang]
  const encounter = workspace.encounters[0]
  const listed = new Set(
    encounter ? workspace.attendance.filter((row) => row.encounterId === encounter.id && !row.voided).map((row) => row.personId) : [],
  )
  const periodId = workspace.periods[0]?.id
  const suggestions = encounter && periodId ? suggestVolunteers(workspace, encounter.id, periodId) : []
  const names = new Map(workspace.people.map((person) => [person.id, person.name]))
  const people = workspace.people.map((person) => {
    const row = encounter ? workspace.attendance.find((item) => item.encounterId === encounter.id && item.personId === person.id && !item.voided) : undefined
    const rate = attendanceRate(workspace, person.id, workspace.periods[0]?.id)
    const score = rate.ratio == null ? text.empty : `${rate.present}/${rate.counted}`
    const mark = row ? text[row.status] : text.off
    const entry = workspace.volunteers.find((item) => item.personId === person.id && item.encounterId === encounter?.id)
    return {
      id: person.id,
      name: person.name,
      listed: listed.has(person.id),
      line: `${person.name}: ${mark}; ${score}`,
      volunteer: entry ? text[entry.status] : '',
    }
  })
  const suggestionNames = suggestions.map((item) => names.get(item.personId) ?? item.personId)
  const saved = new DocumentDraftStore(directory).readDocument()
  const collaboration = collaborationView(directory, lang)
  return {
    people,
    encounterTitle: encounter?.title ?? '',
    suggestion: `${text.suggestion}: ${suggestionNames.length > 0 ? suggestionNames.join(', ') : text.none}`,
    draft: saved?.rows[0]?.note ?? '',
    warning: '',
    error: '',
    refusal: quotaLine(workspace, lang),
    collaboration: collaboration.text,
    alternatives: collaboration.alternatives,
  }
}

function quotaLine(workspace: Workspace, lang: 'es' | 'en'): string {
  const encounter = workspace.encounters[0]
  const interested = workspace.volunteers.find((item) => item.encounterId === encounter?.id && item.status === 'interested')
  if (!encounter || !interested) return ''
  try {
    chooseVolunteer(workspace, encounter.id, interested.personId)
  } catch (error) {
    if (error instanceof DomainError && error.code === 'capacity-exceeded') return `${words[lang].quota}: ${error.code}`
  }
  return ''
}

function collaborationView(directory: string, lang: 'es' | 'en'): { text: string; alternatives: FormAlternative[] } {
  const folder = collaborationDir(directory)
  const store = new FileWorkspaceStore(folder)
  if (!existsSync(store.primaryPath())) return { text: '', alternatives: [] }
  const alternatives = store.load().collaboration.flatMap((link) =>
    link.entries.flatMap((entry) => entry.versions.map((version) => ({ id: version.id, value: version.value }))),
  )
  return { text: describeCollaboration(folder, lang), alternatives }
}

function draftWarning(directory: string, note: string, lang: 'es' | 'en'): string {
  const drafts = new DocumentDraftStore(directory)
  const draft = {
    title: 'Acta sintetica',
    heading: 'Asistencia',
    footer: 'Cierre',
    page: { width: 40, height: 6 },
    rows: [{ id: 'fila', label: 'Nota', note }],
    blocks: [],
  }
  const result = drafts.exportDocument(draft)
  if (result.fits && result.draft) {
    drafts.saveDocument(result.draft)
    return ''
  }
  const full = result.problems.map((problem) => problem.text).join('\n')
  return `${words[lang].overflow}: ${full}`
}

function safeDescribe(directory: string, lang: 'es' | 'en'): FormScreen {
  try {
    if (!existsSync(new FileWorkspaceStore(directory).primaryPath())) return emptyScreen('')
    return describeForm(directory, lang)
  } catch {
    return emptyScreen('')
  }
}

function emptyScreen(error: string): FormScreen {
  return { people: [], encounterTitle: '', suggestion: '', draft: '', warning: '', error, refusal: '', collaboration: '', alternatives: [] }
}
