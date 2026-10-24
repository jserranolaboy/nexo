import { randomUUID } from 'node:crypto'
import { DomainError } from './errors.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function newId(): string {
  return randomUUID()
}

export function canonicalId(value: string): string {
  const id = value.toLowerCase()
  if (!UUID.test(id)) throw new DomainError('invalid-id')
  return id
}
