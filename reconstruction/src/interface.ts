import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chooseVolunteer } from './commands.ts'
import {
  COLLABORATION,
  describeCollaboration,
  resolvePausedAlternative,
  runCollaborationJourney,
} from './collaboration-journey.ts'
import type { DocumentDraft } from './documents.ts'
import { DomainError } from './errors.ts'
import { describeJourney, runFirstJourney } from './journey.ts'
import { migrateLegacyFile, revertToPreviousCopy } from './migrate.ts'
import { DocumentDraftStore, FileWorkspaceStore } from './store.ts'
import { describeVolunteers, runVolunteerJourney, VOLUNTEERS } from './volunteer-journey.ts'

/** Synthetic folders. The checks stay in the modules that already own them. */
export const INTERFACE_AREAS = {
  attendance: 'asistencia',
  documents: 'documentos',
  volunteers: 'voluntariado',
  collaboration: 'colaboracion',
  migration: 'migracion',
} as const

const FITTING_NOTE = 'Nota breve'
const OVERFLOW_NOTE = 'Linea uno\nLinea dos\nLinea tres\nLinea cuatro'

const LEGACY = {
  space: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  alfa: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  gamma: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  beta: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  component: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  encounter: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  attendance: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
} as const

const copy = {
  es: {
    attendance: 'Asistencia',
    document: 'Documento',
    draft: 'Borrador',
    pdf: 'PDF',
    overflow: 'No cabe',
    volunteers: 'Voluntariado',
    quota: 'Rechazo de cupo',
    collaboration: 'Colaboración',
    chosen: 'Alternativa elegida',
    migration: 'Migración',
    reverted: 'Copia nueva anterior restaurada.',
  },
  en: {
    attendance: 'Attendance',
    document: 'Document',
    draft: 'Draft',
    pdf: 'PDF',
    overflow: 'Does not fit',
    volunteers: 'Volunteering',
    quota: 'Quota refusal',
    collaboration: 'Collaboration',
    chosen: 'Alternative chosen',
    migration: 'Migration',
    reverted: 'Previous new copy restored.',
  },
} as const

/**
 * Writes the five synthetic journeys.
 * The conflict is described before one alternative is kept.
 */
export function runInterface(directory: string, lang: 'es' | 'en'): string {
  const text = copy[lang]
  const attendance = area(directory, INTERFACE_AREAS.attendance)
  runFirstJourney(attendance)

  const documents = area(directory, INTERFACE_AREAS.documents)
  const drafts = new DocumentDraftStore(documents)
  const fitting = draft(FITTING_NOTE)
  drafts.saveDocument(fitting)
  if (!drafts.exportDocument(fitting).fits) throw new DomainError('document-missing')

  const volunteers = area(directory, INTERFACE_AREAS.volunteers)
  runVolunteerJourney(volunteers)

  const collaboration = area(directory, INTERFACE_AREAS.collaboration)
  const portError = runCollaborationJourney(collaboration)
  if (portError.length === 0) throw new DomainError('sync-port-silent')
  const conflict = describeCollaboration(collaboration, lang)
  const chosen = resolvePausedAlternative(collaboration, COLLABORATION.localId)

  const migration = area(directory, INTERFACE_AREAS.migration)
  const first = writeLegacy(migration, 'origen', LEGACY.alfa, 'Persona Alfa', true)
  const second = writeLegacy(migration, 'otro', LEGACY.beta, 'Persona Beta', false)
  migrateLegacyFile(migration, first)
  migrateLegacyFile(migration, second)
  revertToPreviousCopy(migration)

  return [
    section(text.attendance, describeJourney(attendance, lang)),
    section(text.document, documentLines(documents, lang)),
    section(text.volunteers, `${describeVolunteers(volunteers, lang)}\n${text.quota}: ${quotaRefusal(volunteers)}`),
    section(text.collaboration, `${conflict}\n${text.chosen}: ${chosen}`),
    section(text.migration, `${text.reverted}\n${describeJourney(migration, lang)}`),
  ].join('\n\n')
}

/** Reads the same folders from another process. A refused export and a refused selection do not write. */
export function describeInterface(directory: string, lang: 'es' | 'en'): string {
  const text = copy[lang]
  return [
    section(text.attendance, describeJourney(area(directory, INTERFACE_AREAS.attendance), lang)),
    section(text.document, documentLines(area(directory, INTERFACE_AREAS.documents), lang)),
    section(
      text.volunteers,
      `${describeVolunteers(area(directory, INTERFACE_AREAS.volunteers), lang)}\n${text.quota}: ${quotaRefusal(area(directory, INTERFACE_AREAS.volunteers))}`,
    ),
    section(text.collaboration, describeCollaboration(area(directory, INTERFACE_AREAS.collaboration), lang)),
    section(text.migration, describeJourney(area(directory, INTERFACE_AREAS.migration), lang)),
  ].join('\n\n')
}

function documentLines(directory: string, lang: 'es' | 'en'): string {
  const text = copy[lang]
  const drafts = new DocumentDraftStore(directory)
  const saved = drafts.readDocument()
  if (saved?.rows[0]?.note !== FITTING_NOTE) throw new DomainError('document-missing')
  const pdf = readFileSync(drafts.pdfPath())
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new DomainError('document-missing')
  const refused = drafts.exportDocument(draft(OVERFLOW_NOTE))
  const warning = refused.problems.map((problem) => problem.text).join('\n')
  if (refused.fits || !warning.includes(OVERFLOW_NOTE) || !readFileSync(drafts.pdfPath()).equals(pdf)) {
    throw new DomainError('text-trimmed')
  }
  if (drafts.readDocument()?.rows[0]?.note !== FITTING_NOTE) throw new DomainError('document-replaced')
  return `${text.draft}: ${saved.rows[0].note}\n${text.pdf}: export.pdf\n${text.overflow}: ${warning}`
}

function quotaRefusal(directory: string): string {
  const store = new FileWorkspaceStore(directory)
  const before = readFileSync(store.primaryPath())
  const workspace = store.load()
  try {
    chooseVolunteer(workspace, VOLUNTEERS.currentEncounterId, VOLUNTEERS.tardiaId)
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== 'capacity-exceeded') throw error
    if (!readFileSync(store.primaryPath()).equals(before)) throw new DomainError('rejected-command-saved')
    return error.code
  }
  throw new DomainError('capacity-exceeded')
}

function draft(note: string): DocumentDraft {
  return {
    title: 'Acta sintetica',
    heading: 'Asistencia',
    footer: 'Cierre',
    page: { width: 40, height: 6 },
    rows: [{ id: 'fila', label: 'Persona Alfa', note }],
    blocks: [],
  }
}

function area(directory: string, name: string): string {
  const next = path.join(directory, name)
  mkdirSync(next, { recursive: true })
  return next
}

function section(title: string, body: string): string {
  return `${title}\n${body}`
}

/** Synthetic workspace-v1.json. migrate.ts accepts or rejects it; this object does not. */
function writeLegacy(directory: string, folder: string, personId: string, personName: string, includeGamma: boolean): string {
  const members = [
    { id: personId, organizationID: LEGACY.space, name: personName, isActive: true },
    ...(includeGamma ? [{ id: LEGACY.gamma, organizationID: LEGACY.space, name: 'Persona Gamma', isActive: true }] : []),
  ]
  const body = {
    schemaVersion: 1,
    revision: 3,
    organizations: [{ id: LEGACY.space, name: 'Espacio sintético', accentHex: '#315EAD', timeZoneIdentifier: 'Etc/UTC', deletedAt: null }],
    periods: [],
    members,
    groups: [],
    memberships: [],
    components: [{ id: LEGACY.component, organizationID: LEGACY.space, name: 'Componente' }],
    categories: [],
    events: [{
      id: LEGACY.encounter,
      organizationID: LEGACY.space,
      title: 'Encuentro sintético',
      startsAt: '2026-03-01T00:00:00Z',
      componentID: LEGACY.component,
      categoryID: null,
      countsAttendance: true,
      isCancelled: false,
      volunteerCapacity: null,
    }],
    attendance: [{
      id: LEGACY.attendance,
      eventID: LEGACY.encounter,
      memberID: personId,
      status: 'present',
      isVoided: false,
      note: 'nota sintética',
      recordedAt: '2026-03-01T00:05:00Z',
      eventDateSnapshot: '2026-03-01T00:00:00Z',
      componentIDSnapshot: LEGACY.component,
      categoryIDSnapshot: null,
      countsAttendanceSnapshot: true,
    }],
    volunteers: [],
    collaborators: [],
    templates: [],
    syncStates: [],
    driveReplicas: [],
    resolvedSyncConflicts: [],
  }
  const target = path.join(directory, folder)
  mkdirSync(target, { recursive: true })
  const file = path.join(target, 'workspace-v1.json')
  writeFileSync(file, JSON.stringify(body))
  return file
}
