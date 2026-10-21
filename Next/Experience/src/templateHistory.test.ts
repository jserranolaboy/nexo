import { describe, expect, it } from 'vitest'
import { newTemplate } from './domain'
import { sameTemplate, TemplateHistory } from './templateHistory'
describe('Template edit history', () => {
  it('groups typing, restores full geometry and clears redo after a new edit', () => {
    const base = newTemplate('space'),
      history = new TemplateHistory(base)
    history.edit({ ...base, headerTitle: 'A' }, 0)
    history.edit({ ...history.current, headerTitle: 'Annual' }, 100)
    const title = history.current
    history.edit({ ...title, rowHeight: 50, columns: ['participant', 'signature'] }, 1000)
    expect(history.undo()).toEqual(title)
    expect(history.undo()).toEqual(base)
    expect(history.redo()).toEqual(title)
    history.edit({ ...title, tableTopOffset: 220 }, 2000)
    expect(history.canRedo).toBe(false)
    expect(base.headerTitle).toBeUndefined()
  })
  it('detects embedded assets and geometry without serializing their contents', () => {
    const base = {
      ...newTemplate('space'),
      backgroundPDFData: 'pdf',
      imageBlocks: [{ id: 'image', imageData: 'data', x: 1, y: 2, width: 30, height: 40 }],
    }
    expect(sameTemplate(base, structuredClone(base))).toBe(true)
    expect(sameTemplate(base, { ...base, backgroundPDFData: 'other' })).toBe(false)
    expect(
      sameTemplate(base, {
        ...base,
        imageBlocks: [{ ...base.imageBlocks[0], imageData: 'other' }],
      }),
    ).toBe(false)
    expect(sameTemplate(base, { ...base, imageBlocks: [{ ...base.imageBlocks[0], x: 2 }] })).toBe(
      false,
    )
  })
  it('does not create undo entries for unchanged drafts', () => {
    const base = newTemplate('space'),
      h = new TemplateHistory(base)
    h.edit({ ...base }, 0)
    expect(h.canUndo).toBe(false)
  })
})
