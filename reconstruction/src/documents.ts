import { DomainError } from './errors.ts'

export interface TextBlock {
  id: string
  text: string
}

export interface PageBox {
  width: number
  height: number
}

export interface FitProblem {
  id: string
  text: string
  reason: 'does-not-fit'
}

export interface FitReport {
  fits: boolean
  blocks: TextBlock[]
  problems: FitProblem[]
}

export interface DocumentRow {
  id: string
  label: string
  note: string
}

/** A working document. It is stored apart from the workspace file and its revision copies. */
export interface DocumentDraft {
  title: string
  heading: string
  footer: string
  page: PageBox
  rows: DocumentRow[]
  blocks: TextBlock[]
}

export interface ExportedPage {
  number: number
  title: string
  heading: string
  footer: string
  lines: string[]
  notes: string[]
}

/** Page record produced by this package. It is not an Apple PDF. */
export interface DocumentExport {
  pages: ExportedPage[]
}

export interface ExportResult {
  fits: boolean
  problems: FitProblem[]
  draft: DocumentDraft
  document: DocumentExport | null
}

/**
 * Reconstruction preflight. It is not the Apple PDF renderer.
 * Text that does not fit is returned whole; nothing is trimmed.
 */
export function preflightText(blocks: TextBlock[], page: PageBox): FitReport {
  const problems: FitProblem[] = []
  for (const block of blocks) {
    if (!fits(block.text, page)) {
      problems.push({ id: block.id, text: block.text, reason: 'does-not-fit' })
    }
  }
  return { fits: problems.length === 0, blocks: blocks.map((block) => ({ ...block })), problems }
}

function fits(text: string, page: PageBox): boolean {
  return !overflows(textLines(text), page.width, page.height)
}

function textLines(text: string): string[] {
  if (text.length === 0) return []
  return text.split('\n')
}

function overflows(lines: string[], width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return true
  if (lines.length > height) return true
  return lines.some((line) => line.length > width)
}

function mustString(value: string): string {
  if (typeof value !== 'string') throw new DomainError('invalid-draft')
  return value
}

/** Copies a draft without changing its text. An ill-shaped draft is rejected before any file is written. */
export function copyDraft(draft: DocumentDraft): DocumentDraft {
  const title = mustString(draft.title)
  const heading = mustString(draft.heading)
  const footer = mustString(draft.footer)
  const width = draft.page?.width
  const height = draft.page?.height
  if (typeof width !== 'number' || typeof height !== 'number') throw new DomainError('invalid-draft')
  if (!Array.isArray(draft.rows) || !Array.isArray(draft.blocks)) throw new DomainError('invalid-draft')
  const rows = draft.rows.map((row) => ({
    id: mustString(row.id),
    label: mustString(row.label),
    note: mustString(row.note),
  }))
  const blocks = draft.blocks.map((block) => ({ id: mustString(block.id), text: mustString(block.text) }))
  const ids = [...rows.map((row) => row.id), ...blocks.map((block) => block.id)]
  if (ids.some((id) => id.length === 0) || new Set(ids).size !== ids.length) throw new DomainError('invalid-draft')
  return { title, heading, footer, page: { width, height }, rows, blocks }
}

function rowText(row: DocumentRow): string {
  return `${row.label}\n${row.note}`
}

function objectOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('invalid-draft')
  return value as Record<string, unknown>
}

function stringField(value: unknown): string {
  if (typeof value !== 'string') throw new DomainError('invalid-draft')
  return value
}

function numberField(value: unknown): number {
  if (typeof value !== 'number') throw new DomainError('invalid-draft')
  return value
}

export function draftFromUnknown(value: unknown): DocumentDraft {
  const record = objectOf(value)
  const page = objectOf(record.page)
  if (!Array.isArray(record.rows) || !Array.isArray(record.blocks)) throw new DomainError('invalid-draft')
  return copyDraft({
    title: stringField(record.title),
    heading: stringField(record.heading),
    footer: stringField(record.footer),
    page: { width: numberField(page.width), height: numberField(page.height) },
    rows: record.rows.map((item) => {
      const row = objectOf(item)
      return { id: stringField(row.id), label: stringField(row.label), note: stringField(row.note) }
    }),
    blocks: record.blocks.map((item) => {
      const block = objectOf(item)
      return { id: stringField(block.id), text: stringField(block.text) }
    }),
  })
}

/**
 * Lays pages out on a character grid. This is not the Apple PDF renderer.
 * A title, heading, footer, row, or block that cannot fit on one page is reported whole.
 * No page is emitted in that case, and no text is trimmed.
 */
export function layoutDocument(draft: DocumentDraft): ExportResult {
  const saved = copyDraft(draft)
  const problems: FitProblem[] = []
  const titleLines = textLines(saved.title)
  const headingLines = textLines(saved.heading)
  const footerLines = textLines(saved.footer)
  const chrome = [...titleLines, ...headingLines, ...footerLines]
  const page = saved.page
  const reportChrome = (id: 'title' | 'heading' | 'footer', text: string): void => {
    problems.push({ id, text, reason: 'does-not-fit' })
  }
  const pageOpen = Number.isFinite(page.width) && Number.isFinite(page.height) && page.width > 0 && page.height > 0
  if (!pageOpen || chrome.length > page.height) {
    reportChrome('title', saved.title)
    reportChrome('heading', saved.heading)
    reportChrome('footer', saved.footer)
  } else {
    if (overflows(titleLines, page.width, page.height)) reportChrome('title', saved.title)
    if (overflows(headingLines, page.width, page.height)) reportChrome('heading', saved.heading)
    if (overflows(footerLines, page.width, page.height)) reportChrome('footer', saved.footer)
  }
  const capacity = pageOpen ? page.height - chrome.length : 0
  const items: { lines: string[]; notes: string[] }[] = []
  for (const row of saved.rows) {
    const lines = [row.label, ...textLines(row.note)]
    if (overflows(lines, page.width, capacity)) problems.push({ id: row.id, text: rowText(row), reason: 'does-not-fit' })
    else items.push({ lines, notes: [row.note] })
  }
  for (const block of saved.blocks) {
    const lines = textLines(block.text)
    if (overflows(lines, page.width, capacity)) problems.push({ id: block.id, text: block.text, reason: 'does-not-fit' })
    else if (lines.length > 0) items.push({ lines, notes: [] })
  }
  if (problems.length > 0) return { fits: false, problems, draft: saved, document: null }

  const pages: ExportedPage[] = []
  let lines: string[] = []
  let notes: string[] = []
  const flush = (): void => {
    pages.push({
      number: pages.length + 1,
      title: saved.title,
      heading: saved.heading,
      footer: saved.footer,
      lines: [...lines],
      notes: [...notes],
    })
    lines = []
    notes = []
  }
  if (items.length === 0) {
    flush()
  } else {
    for (const item of items) {
      if (lines.length > 0 && lines.length + item.lines.length > capacity) flush()
      lines.push(...item.lines)
      notes.push(...item.notes)
    }
    flush()
  }
  return { fits: true, problems: [], draft: saved, document: { pages } }
}
