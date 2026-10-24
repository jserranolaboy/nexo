import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Source-level stacking contract; the hosted WK test verifies actual center hits.
const css = readFileSync(new URL('./nexo.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)}`, 'g'))]
  expect(matches, selector).toHaveLength(1)
  return Object.fromEntries(
    matches[0][1]
      .split(';')
      .filter((value) => value.includes(':'))
      .map((value) => {
        const [name, ...parts] = value.split(':')
        return [name.trim(), parts.join(':').trim()]
      }),
  )
}

describe('Toast and modal stacking', () => {
  it('uses actual Sheet presence, including retained exits and other open Sheets', () => {
    const scoped = rule(':root:has(.nx-sheet-layer) .nx-toast-region')
    expect(Object.keys(scoped)).toEqual(['z-index'])
    expect(Number(scoped['z-index'])).toBeLessThan(Number(rule('.nx-sheet-layer')['z-index']))
    expect(Number(rule('.nx-sheet-layer')['z-index'])).toBeLessThan(
      Number(rule('.nx-menu')['z-index']),
    )
  })

  it('preserves normal toast stacking and interactive actions without a Sheet', () => {
    expect(rule('.nx-toast-region')['z-index']).toBe('70')
    expect(rule('.nx-toast-region')['pointer-events']).toBe('none')
    expect(rule('.nx-toast')['pointer-events']).toBe('auto')
  })
})
