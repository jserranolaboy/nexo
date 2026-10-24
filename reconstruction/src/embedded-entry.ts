import { pressInterface } from './interface.ts'

const host = globalThis as typeof globalThis & {
  NEXO_DIRECTORY?: string
  nexoPress?: (action: string, lang: string) => string
}

host.nexoPress = (action: string, lang: string) => {
  try {
    const directory = host.NEXO_DIRECTORY
    if (!directory) return 'Error: missing-directory'
    return pressInterface(directory, action, lang === 'en' ? 'en' : 'es')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error: ${message}`
  }
}
