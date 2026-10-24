export class DomainError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'DomainError'
    this.code = code
  }
}

export function assertDomain(error: unknown, code: string): void {
  if (!(error instanceof DomainError) || error.code !== code) {
    throw error
  }
}
