import type { DocumentExport, ExportedPage, FitProblem } from './documents.ts'

const FONT_SIZE = 12
const LEADING = 16
const MARGIN = 48

/**
 * Builds a PDF 1.4 file from an already accepted page layout.
 * Helvetica with WinAnsiEncoding is not the CoreGraphics renderer.
 * A character that encoding cannot carry is returned whole and no bytes are produced.
 */
export function renderDocumentPdf(document: DocumentExport): { bytes: Buffer } | { problems: FitProblem[] } {
  const problems: FitProblem[] = []
  for (const page of document.pages) problems.push(...encodingProblems(page))
  if (problems.length > 0) return { problems }

  const bodies: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  const kids: number[] = []
  for (const page of document.pages) {
    const drawn = drawnLines(page)
    const pageId = bodies.length + 1
    const contentId = pageId + 1
    const width = pageWidth(drawn)
    const height = pageHeight(drawn.length)
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    )
    bodies.push(streamObject(contentStream(drawn, height)))
    kids.push(pageId)
  }
  bodies[1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${document.pages.length} >>`
  return { bytes: serialize(bodies) }
}

function encodingProblems(page: ExportedPage): FitProblem[] {
  const problems: FitProblem[] = []
  const consider = (id: string, text: string): void => {
    if (!canEncode(text)) problems.push({ id, text, reason: 'cannot-encode' })
  }
  consider(`title-${page.number}`, page.title)
  consider(`heading-${page.number}`, page.heading)
  consider(`footer-${page.number}`, page.footer)
  page.notes.forEach((note, index) => consider(`note-${page.number}-${index + 1}`, note))
  page.lines.forEach((line, index) => {
    const covered = page.notes.some((note) => note.split('\n').includes(line))
    if (!covered) consider(`line-${page.number}-${index + 1}`, line)
  })
  return problems
}

function drawnLines(page: ExportedPage): string[] {
  return [...split(page.title), ...split(page.heading), ...page.lines, ...split(page.footer), `Pagina ${page.number}`]
}

function split(text: string): string[] {
  if (text.length === 0) return []
  return text.split('\n')
}

function pageWidth(lines: string[]): number {
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 1)
  return MARGIN * 2 + longest * FONT_SIZE
}

function pageHeight(lineCount: number): number {
  return MARGIN * 2 + FONT_SIZE + Math.max(0, lineCount - 1) * LEADING
}

function contentStream(lines: string[], height: number): string {
  const startY = height - MARGIN - FONT_SIZE
  let stream = `BT\n/F1 ${FONT_SIZE} Tf\n${LEADING} TL\n1 0 0 1 ${MARGIN} ${startY} Tm\n`
  lines.forEach((line, index) => {
    const literal = pdfLiteral(line)
    if (literal == null) throw new Error('cannot-encode')
    stream += `${literal} Tj\n`
    if (index !== lines.length - 1) stream += 'T*\n'
  })
  stream += 'ET\n'
  return stream
}

function streamObject(stream: string): string {
  return `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`
}

function canEncode(text: string): boolean {
  return text.split('\n').every((line) => pdfLiteral(line) != null)
}

function pdfLiteral(text: string): string | null {
  let out = '('
  for (const character of text) {
    const byte = winAnsiByte(character.codePointAt(0) ?? 0)
    if (byte == null) return null
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`
    else out += String.fromCharCode(byte)
  }
  return `${out})`
}

function winAnsiByte(code: number): number | null {
  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return code
  const extras: Readonly<Record<number, number>> = {
    0x20ac: 0x80,
    0x201a: 0x82,
    0x0192: 0x83,
    0x201e: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02c6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8a,
    0x2039: 0x8b,
    0x0152: 0x8c,
    0x017d: 0x8e,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201c: 0x93,
    0x201d: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02dc: 0x98,
    0x2122: 0x99,
    0x0161: 0x9a,
    0x203a: 0x9b,
    0x0153: 0x9c,
    0x017e: 0x9e,
    0x0178: 0x9f,
  }
  return extras[code] ?? null
}

function serialize(bodies: string[]): Buffer {
  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')
  const parts: Buffer[] = [header]
  const offsets = [0]
  let cursor = header.length
  bodies.forEach((body, index) => {
    const chunk = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1')
    offsets.push(cursor)
    parts.push(chunk)
    cursor += chunk.length
  })
  let xref = `xref\n0 ${bodies.length + 1}\n`
  xref += '0000000000 65535 f \n'
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${offsets[index].toString().padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`
  parts.push(Buffer.from(xref + trailer, 'latin1'))
  return Buffer.concat(parts)
}
