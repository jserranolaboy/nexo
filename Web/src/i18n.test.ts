import { describe, expect, it } from 'vitest'
import english from './locales/en.json'
import { resolveLanguage, translate } from './i18n'
describe('System language', () => {
  it('respects supported language order and regional variants', () => {
    expect(resolveLanguage(['es-PR', 'en-US'])).toBe('es')
    expect(resolveLanguage(['en-GB', 'es'])).toBe('en')
    expect(resolveLanguage(['fr-FR', 'es-MX'])).toBe('es')
    expect(resolveLanguage(['ja'])).toBe('en')
  })
  it('keeps user text literal while translating interface placeholders', () => {
    expect(translate('Continuar en {0}', 'en', 'Asociación · {1}')).toBe(
      'Continue in Asociación · {1}',
    )
    expect(translate('Continuar en {0}', 'es', 'Alpha')).toBe('Continuar en Alpha')
  })
  it('preserves every placeholder in the complete English catalog', () => {
    for (const [key, value] of Object.entries(english)) {
      expect(value.trim(), key).not.toBe('')
      expect([...value.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort(), key).toEqual(
        [...key.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort(),
      )
    }
  })
})


describe('Drive pending labels', () => {
  it.each([
    ['Conectando…', 'Connecting…'],
    ['Preparando…', 'Preparing…'],
  ])('translates %s without changing Spanish', (spanish, english) => {
    expect(translate(spanish, 'en')).toBe(english)
    expect(translate(spanish, 'es')).toBe(spanish)
  })
})


it('translates the space-removal pending state without changing Spanish', () => {
  expect(translate('Eliminando…', 'en')).toBe('Deleting…')
  expect(translate('Eliminando…', 'es')).toBe('Eliminando…')
})

it('explains how to retry an image import while PDF dimensions are unavailable', () => {
  const message = 'Espera a que se cargue el PDF y vuelve a importar la imagen.'
  expect(translate(message, 'en')).toBe('Wait for the PDF to load, then import the image again.')
  expect(translate(message, 'es')).toBe(message)
})
