import { DomainError } from './errors.ts'

const CANONICAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** UTC instant with millisecond precision. The space timezone does not rewrite it. */
export function parseInstant(value: string): number {
  if (!CANONICAL.test(value)) throw new DomainError('invalid-instant')
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new DomainError('invalid-instant')
  }
  return parsed
}

export function containsInstant(startsAt: string, endsAt: string, instant: string): boolean {
  const start = parseInstant(startsAt)
  const end = parseInstant(endsAt)
  const point = parseInstant(instant)
  return start <= point && point < end
}

export function assertHalfOpen(startsAt: string, endsAt: string): void {
  if (parseInstant(startsAt) >= parseInstant(endsAt)) throw new DomainError('invalid-period')
}
