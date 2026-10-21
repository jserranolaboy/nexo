import { useRef, useState } from 'react'
import type { Template } from './domain'

/** Compare document edits without re-encoding embedded PDF/image data on every frame. */
export function sameTemplate(a: Template, b: Template) {
  if (a === b) return true
  if (a.backgroundPDFData !== b.backgroundPDFData) return false
  const aImages = a.imageBlocks ?? [],
    bImages = b.imageBlocks ?? []
  if (
    aImages.length !== bImages.length ||
    aImages.some((image, i) => image.imageData !== bImages[i].imageData)
  )
    return false
  const metadata = (template: Template) => {
    const { backgroundPDFData: _pdf, imageBlocks, ...values } = template
    return {
      ...values,
      imageBlocks: imageBlocks?.map(({ imageData: _image, ...geometry }) => geometry),
    }
  }
  return JSON.stringify(metadata(a)) === JSON.stringify(metadata(b))
}

export class TemplateHistory {
  private past: Template[] = []
  private future: Template[] = []
  private lastEdit = -Infinity
  constructor(public current: Template) {}
  get canUndo() {
    return this.past.length > 0
  }
  get canRedo() {
    return this.future.length > 0
  }
  edit(next: Template, now = performance.now()) {
    if (sameTemplate(next, this.current)) return this.current
    if (now - this.lastEdit > 450 || !this.past.length) {
      this.past.push(this.current)
      if (this.past.length > 40) this.past.shift()
    }
    this.lastEdit = now
    this.future = []
    return (this.current = next)
  }
  undo() {
    const previous = this.past.pop()
    if (previous) {
      this.future.push(this.current)
      this.current = previous
    }
    this.lastEdit = -Infinity
    return this.current
  }
  redo() {
    const next = this.future.pop()
    if (next) {
      this.past.push(this.current)
      this.current = next
    }
    this.lastEdit = -Infinity
    return this.current
  }
}
export function useTemplateHistory(initial: Template) {
  const history = useRef<TemplateHistory | null>(null)
  if (!history.current) history.current = new TemplateHistory(initial)
  const [draft, publish] = useState(initial)
  return {
    draft,
    setDraft: (value: Template | ((previous: Template) => Template)) => {
      const h = history.current!
      publish(h.edit(typeof value === 'function' ? value(h.current) : value))
    },
    undo: () => publish(history.current!.undo()),
    redo: () => publish(history.current!.redo()),
    canUndo: history.current.canUndo,
    canRedo: history.current.canRedo,
  }
}
