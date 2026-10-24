import { describeCollaboration, resolvePausedAlternative, runCollaborationJourney } from './collaboration-journey.ts'
import { describeInterface, pressInterface, runInterface } from './interface.ts'
import { describeJourney, runFirstJourney } from './journey.ts'
import { migrateLegacyFile, revertToPreviousCopy } from './migrate.ts'
import { describeVolunteers, runVolunteerJourney } from './volunteer-journey.ts'

const messages = {
  es: {
    usage:
      'Uso: journey | show | volunteers | volunteers-show | collaborate | collaborate-show | interface | interface-show --directory DIR [--lang es|en] | interface-press --directory DIR --action ACTION [--lang es|en] | collaborate-choose --directory DIR --version ID [--lang es|en] | migrate --directory DIR --source workspace-v1.json [--lang es|en] | migrate-revert --directory DIR [--lang es|en]',
    saved: 'Espacio sintético guardado. La asistencia queda en el archivo local.',
    volunteers: 'Voluntariado sintético guardado. La selección quedó en el archivo local.',
    kept: 'Guardado local conservado. El puerto de sincronización falló después.',
    chosen: 'Alternativa elegida. La otra queda fuera del archivo activo.',
    migrated: 'Migración comprobada. Personas, encuentros y asistencias quedaron en el archivo nuevo.',
    reverted: 'Copia nueva anterior restaurada.',
  },
  en: {
    usage:
      'Usage: journey | show | volunteers | volunteers-show | collaborate | collaborate-show | interface | interface-show --directory DIR [--lang es|en] | interface-press --directory DIR --action ACTION [--lang es|en] | collaborate-choose --directory DIR --version ID [--lang es|en] | migrate --directory DIR --source workspace-v1.json [--lang es|en] | migrate-revert --directory DIR [--lang es|en]',
    saved: 'Synthetic space saved. Attendance remains in the local file.',
    volunteers: 'Synthetic volunteering saved. The selection remains in the local file.',
    kept: 'Local save kept. The sync port failed afterwards.',
    chosen: 'Alternative chosen. The other is out of the active file.',
    migrated: 'Migration checked. People, encounters, and attendance are in the new file.',
    reverted: 'Previous new copy restored.',
  },
} as const

const parsed = parse(process.argv.slice(2))
const copy = messages[parsed.lang]
if (!parsed.command || !parsed.directory) {
  process.stderr.write(`${copy.usage}\n`)
  process.exitCode = 1
} else if (parsed.command === 'journey') {
  runFirstJourney(parsed.directory)
  process.stdout.write(`${copy.saved}\n`)
} else if (parsed.command === 'show') {
  process.stdout.write(`${describeJourney(parsed.directory, parsed.lang)}\n`)
} else if (parsed.command === 'volunteers') {
  runVolunteerJourney(parsed.directory)
  process.stdout.write(`${copy.volunteers}\n`)
} else if (parsed.command === 'volunteers-show') {
  process.stdout.write(`${describeVolunteers(parsed.directory, parsed.lang)}\n`)
} else if (parsed.command === 'collaborate') {
  const portError = runCollaborationJourney(parsed.directory)
  process.stdout.write(`${copy.kept} ${portError}\n`)
} else if (parsed.command === 'collaborate-show') {
  process.stdout.write(`${describeCollaboration(parsed.directory, parsed.lang)}\n`)
} else if (parsed.command === 'collaborate-choose') {
  if (!parsed.version) {
    process.stderr.write(`${copy.usage}\n`)
    process.exitCode = 1
  } else {
    const value = resolvePausedAlternative(parsed.directory, parsed.version)
    process.stdout.write(`${copy.chosen} ${value}\n`)
  }
} else if (parsed.command === 'migrate') {
  if (!parsed.source) {
    process.stderr.write(`${copy.usage}\n`)
    process.exitCode = 1
  } else {
    const workspace = migrateLegacyFile(parsed.directory, parsed.source)
    process.stdout.write(
      `${copy.migrated} ${workspace.people.length} ${workspace.encounters.length} ${workspace.attendance.length}\n`,
    )
  }
} else if (parsed.command === 'migrate-revert') {
  revertToPreviousCopy(parsed.directory)
  process.stdout.write(`${copy.reverted}\n`)
} else if (parsed.command === 'interface') {
  process.stdout.write(`${runInterface(parsed.directory, parsed.lang)}\n`)
} else if (parsed.command === 'interface-show') {
  process.stdout.write(`${describeInterface(parsed.directory, parsed.lang)}\n`)
} else if (parsed.command === 'interface-press') {
  if (!parsed.action) {
    process.stderr.write(`${copy.usage}\n`)
    process.exitCode = 1
  } else {
    try {
      process.stdout.write(`${pressInterface(parsed.directory, parsed.action, parsed.lang)}\n`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`Error: ${message}\n`)
      process.exitCode = 1
    }
  }
} else {
  process.stderr.write(`${copy.usage}\n`)
  process.exitCode = 1
}

function parse(argv: string[]): {
  command: string
  directory: string
  lang: 'es' | 'en'
  version: string
  source: string
  action: string
} {
  let directory = ''
  let version = ''
  let source = ''
  let action = ''
  let lang: 'es' | 'en' = 'es'
  const command = argv[0] ?? ''
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--directory') directory = argv[(index += 1)] ?? ''
    else if (token === '--version') version = argv[(index += 1)] ?? ''
    else if (token === '--source') source = argv[(index += 1)] ?? ''
    else if (token === '--action') action = argv[(index += 1)] ?? ''
    else if (token === '--lang') {
      const value = argv[(index += 1)]
      if (value !== 'es' && value !== 'en') throw new Error('unsupported language')
      lang = value
    } else {
      throw new Error(`unknown argument ${token}`)
    }
  }
  return { command, directory, lang, version, source, action }
}
