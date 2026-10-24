// Keep native menus/alerts and the shared interface on the same catalog.
import { readFileSync, writeFileSync } from 'node:fs'
const dictionary = JSON.parse(readFileSync(new URL('../Web/src/locales/en.json', import.meta.url), 'utf8'))
const target = new URL('../Native/Sources/NexoKit/NexoLocale.swift', import.meta.url)
const existing = readFileSync(target, 'utf8')
const start = existing.indexOf('    private static let english: [String: String] = [')
const generated = existing.slice(0, start) + '    private static let english: [String: String] = [\n' + Object.entries(dictionary).map(([key, value]) => `        ${JSON.stringify(key)}: ${JSON.stringify(value)},`).join('\n') + '\n    ]\n}\n'
if (process.argv.includes('--check')) {
  if (existing !== generated) throw new Error('Native translation catalog is stale; run scripts/sync-locales.mjs')
} else writeFileSync(target, generated)
