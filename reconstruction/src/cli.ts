import { describeCollaboration, resolvePausedAlternative, runCollaborationJourney } from './collaboration-journey.ts'
import { describeJourney, runFirstJourney } from './journey.ts'
import { describeVolunteers, runVolunteerJourney } from './volunteer-journey.ts'

const messages = {
  es: {
    usage:
      'Uso: journey | volunteers | show | volunteers-show | collaborate | collaborate-show --directory DIR [--lang es|en] | collaborate-choose --directory DIR --version ID [--lang es|en]',
    saved: 'Espacio sintético guardado. La asistencia queda en el archivo local.',
    volunteers: 'Voluntariado sintético guardado. La selección quedó en el archivo local.',
    kept: 'Guardado local conservado. El puerto de sincronización falló después.',
    chosen: 'Alternativa elegida. La otra queda fuera del archivo activo.',
  },
  en: {
    usage:
      'Usage: journey | volunteers | show | volunteers-show | collaborate | collaborate-show --directory DIR [--lang es|en] | collaborate-choose --directory DIR --version ID [--lang es|en]',
    saved: 'Synthetic space saved. Attendance remains in the local file.',
    volunteers: 'Synthetic volunteering saved. The selection remains in the local file.',
    kept: 'Local save kept. The sync port failed afterwards.',
    chosen: 'Alternative chosen. The other is out of the active file.',
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
} else {
  process.stderr.write(`${copy.usage}\n`)
  process.exitCode = 1
}

function parse(argv: string[]): { command: string; directory: string; lang: 'es' | 'en'; version: string } {
  let directory = ''
  let version = ''
  let lang: 'es' | 'en' = 'es'
  const command = argv[0] ?? ''
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--directory') directory = argv[(index += 1)] ?? ''
    else if (token === '--version') version = argv[(index += 1)] ?? ''
    else if (token === '--lang') {
      const value = argv[(index += 1)]
      if (value !== 'es' && value !== 'en') throw new Error('unsupported language')
      lang = value
    } else {
      throw new Error(`unknown argument ${token}`)
    }
  }
  return { command, directory, lang, version }
}
