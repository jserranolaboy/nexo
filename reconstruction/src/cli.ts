import { describeJourney, runFirstJourney } from './journey.ts'
import { migrateLegacyFile, revertToPreviousCopy } from './migrate.ts'

const messages = {
  es: {
    usage:
      'Uso: journey | show | migrate --source workspace-v1.json | migrate-revert --directory DIR [--lang es|en]',
    saved: 'Espacio sintético guardado. La asistencia queda en el archivo local.',
    migrated: 'Migración comprobada. Personas, encuentros y asistencias quedaron en el archivo nuevo.',
    reverted: 'Copia nueva anterior restaurada.',
  },
  en: {
    usage:
      'Usage: journey | show | migrate --source workspace-v1.json | migrate-revert --directory DIR [--lang es|en]',
    saved: 'Synthetic space saved. Attendance remains in the local file.',
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
} else {
  process.stderr.write(`${copy.usage}\n`)
  process.exitCode = 1
}

function parse(argv: string[]): { command: string; directory: string; lang: 'es' | 'en'; source: string } {
  let directory = ''
  let source = ''
  let lang: 'es' | 'en' = 'es'
  const command = argv[0] ?? ''
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--directory') directory = argv[(index += 1)] ?? ''
    else if (token === '--source') source = argv[(index += 1)] ?? ''
    else if (token === '--lang') {
      const value = argv[(index += 1)]
      if (value !== 'es' && value !== 'en') throw new Error('unsupported language')
      lang = value
    } else {
      throw new Error(`unknown argument ${token}`)
    }
  }
  return { command, directory, lang, source }
}
