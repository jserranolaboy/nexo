import { native } from './workspace'

let writes: Promise<unknown> = Promise.resolve()
/** Preserve edit order even if a save or dismissal follows a pending draft. */
export function persistTemplateDraft(values: Record<string, unknown>) {
  const result = writes.then(() => native('draftState', values))
  writes = result.catch(() => {})
  return result
}
