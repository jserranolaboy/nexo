import { describeJourney, runFirstJourney } from './journey.ts'

const messages = {
  es: {
    usage: 'Uso: journey --directory DIR [--lang es|en] | show --directory DIR [--lang es|en]',
    saved: 'Espacio sintético guardado. La asistencia queda en el archivo local.',
  },
  en: {
    usage: 'Usage: journey --directory DIR [--lang es|en] | show --directory DIR [--lang es|en]',
    saved: 'Synthetic space saved. Attendance remains in the local file.',
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
} else {
  process.stderr.write(`${copy.usage}\n`)
  process.exitCode = 1
}

function parse(argv: string[]): { command: string; directory: string; lang: 'es' | 'en' } {
  let directory = ''
  let lang: 'es' | 'en' = 'es'
  const command = argv[0] ?? ''
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--directory') directory = argv[(index += 1)] ?? ''
    else if (token === '--lang') {
      const value = argv[(index += 1)]
      if (value !== 'es' && value !== 'en') throw new Error('unsupported language')
      lang = value
    } else {
      throw new Error(`unknown argument ${token}`)
    }
  }
  return { command, directory, lang }
}
