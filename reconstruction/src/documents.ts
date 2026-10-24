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
  if (!Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0) {
    return false
  }
  const lines = text.split('\n')
  const widest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  return widest <= page.width && lines.length <= page.height
}
