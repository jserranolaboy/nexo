import { applyForm } from './form.ts'
import { pressInterface } from './interface.ts'

const host = globalThis as typeof globalThis & {
  NEXO_DIRECTORY?: string
  nexoPress?: (action: string, lang: string) => string
  nexoForm?: (payload: string) => string
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

host.nexoForm = (payload: string) => {
  try {
    const directory = host.NEXO_DIRECTORY
    if (!directory) return 'Error: missing-directory'
    return applyForm(directory, payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error: ${message}`
  }
}
