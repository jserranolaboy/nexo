import { t as tr } from './i18n'
import { persistTemplateDraft } from './drafts'
import { useEffect, useRef, useState } from 'react'
import { MobileStudio, useCompactStudio } from './MobileStudio'
import { sameTemplate, useTemplateHistory } from './templateHistory'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ChevronLeft,
  ChevronRight,
  Download,
  GripHorizontal,
  ImagePlus,
  Minus,
  Plus,
  Type,
  X,
  Upload,
  Eye,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  Maximize,
} from 'lucide-react'
import { canFitAttendancePage, columnLabels, fitTemplateToPage, maximumTableOffset, id } from './domain'
import type { Activity, Attendance, Column, ID, Snapshot, Template } from './domain'
import { native, nativeAvailable, useWorkspace } from './workspace'
import { Dialog, Empty, IconButton } from './ui'
const colors = ['#262629', '#007AFF', '#6E6E73', '#8B81A2', '#A85750', '#FFFFFF']
interface Background {
  image: string
  pages: { width: number; height: number }[]
}
interface FinalPDF {
  token: string
  image: string
  pageCount: number
}
export function DocumentStudio({
  s,
  orgID,
  initial,
  eventID,
  recoveredBase,
  back,
}: {
  s: Snapshot
  orgID: ID
  initial: Template
  eventID?: ID
  recoveredBase?: Template | null
  back: () => void
}) {
  const { mutate, busy, notify, demo } = useWorkspace()
  const compact = useCompactStudio()
  const [startingDraft] = useState(() =>
    structuredClone({
      ...initial,
      columnLabels: { ...columnLabels, ...initial.columnLabels },
    }),
  )
  const { draft, setDraft, resetDraft, undo, redo, canUndo, canRedo } = useTemplateHistory(startingDraft)
  const [saved, setSaved] = useState<Template | null>(() => {
    const existing = s.templates.find((template) => template.id === initial.id)
    return existing
      ? { ...existing, columnLabels: { ...columnLabels, ...existing.columnLabels } }
      : null
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [zoom, setZoom] = useState(() =>
      Math.max(0.25, Math.min(0.78, (window.innerWidth - 40) / 612)),
    ),
    [background, setBackground] = useState<Background | null>(null),
    [backgroundBusy, setBackgroundBusy] = useState(false)
  const [mode, setMode] = useState<'blank' | 'completed'>('blank'),
    [eventSelection, setEventSelection] = useState(eventID || ''),
    [view, setView] = useState<'design' | 'final'>('design')
  const [final, setFinal] = useState<FinalPDF | null>(null),
    [pageIndex, setPageIndex] = useState(0),
    [rendering, setRendering] = useState(false),
    [renderError, setRenderError] = useState(''),
    [confirmLeave, setConfirmLeave] = useState(false)
  const baseTemplate = useRef(
    recoveredBase === undefined
      ? (s.templates.find((t) => t.id === initial.id) ?? null)
      : recoveredBase,
  )
  const previewVersion = useRef(0)
  const drag = useRef<{
    kind: string
    id?: string
    x: number
    y: number
    originX: number
    originY: number
  } | null>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const paperScrollRef = useRef<HTMLDivElement>(null)
  const organization = s.organizations.find((o) => o.id === orgID)!,
    chosenEvent = s.events.find((e) => e.id === eventSelection)
  const page = background?.pages[draft.listPageIndex || 0] || { width: 612, height: 792 }
  useEffect(() => {
    const element = paperScrollRef.current
    if (!element) return
    const fit = () => {
      const inset = window.innerWidth <= 700 ? 40 : 100
      setZoom(Math.max(0.25, Math.min(0.78, (element.clientWidth - inset) / page.width)))
    }
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    return () => observer.disconnect()
  }, [page.width])
  const actualEntries = chosenEvent
    ? s.attendance.filter((a) => a.eventID === chosenEvent.id && !a.isVoided)
    : []
  const entries: Attendance[] = chosenEvent
    ? actualEntries
    : Array.from({ length: 8 }, (_, i) => ({
        id: `sample-${i}`,
        eventID: '',
        memberID: '',
        status: 'pending',
        isVoided: false,
        note: '',
        memberNameSnapshot: tr('Persona {0}', i + 1),
      }))
  const invalidate = () => {
    previewVersion.current++
    setFinal(null)
    setView('design')
    setRendering(false)
    setRenderError('')
  }
  const patch = (values: Partial<Template>) => {
    setDraft((d) => {
      const next = { ...d, ...values }
      if (values.rowHeight !== undefined || values.tableTopOffset !== undefined)
        next.tableTopOffset = Math.max(100, Math.min(next.tableTopOffset ?? 100, maximumTableOffset(page, next.rowHeight)))
      return next
    })
    invalidate()
  }
  const dirty = !saved || !sameTemplate(draft, saved)
  useEffect(() => {
    if (!nativeAvailable || demo) return
    void persistTemplateDraft({
      dirty,
      ...(dirty
        ? { template: draft, organizationID: orgID, eventID, baseTemplate: baseTemplate.current }
        : {}),
    }).catch(() =>
      notify(tr('No se pudo guardar el borrador. Guarda la plantilla antes de salir.'), true),
    )
  }, [dirty, draft, orgID, eventID, demo, notify])
  useEffect(() => {
    let cancelled = false
    if (!draft.backgroundPDFData || !nativeAvailable) {
      setBackground(null)
      return
    }
    setBackgroundBusy(true)
    void native<Background>('backgroundPage', {
      data: draft.backgroundPDFData,
      index: draft.listPageIndex || 0,
    })
      .then((result) => {
        if (!cancelled) setBackground(result)
      })
      .catch((e) => {
        if (!cancelled) notify(String(e), true)
      })
      .finally(() => {
        if (!cancelled) setBackgroundBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [draft.backgroundPDFData, draft.listPageIndex, notify])
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const x = (e.clientX - d.x) / zoom + d.originX,
        y = (e.clientY - d.y) / zoom + d.originY
      if (d.kind === 'table')
        setDraft((t) => ({
          ...t,
          tableTopOffset: Math.max(100, Math.min(maximumTableOffset(page, t.rowHeight), y)),
        }))
      if (d.kind === 'text')
        setDraft((t) => ({
          ...t,
          textBlocks: t.textBlocks?.map((b) =>
            b.id === d.id
              ? {
                  ...b,
                  x: Math.max(0, Math.min(page.width - b.width, x)),
                  y: Math.max(0, Math.min(page.height - b.fontSize * 2.5, y)),
                }
              : b,
          ),
        }))
      if (d.kind === 'image')
        setDraft((t) => ({
          ...t,
          imageBlocks: t.imageBlocks?.map((b) =>
            b.id === d.id
              ? {
                  ...b,
                  x: Math.max(0, Math.min(page.width - b.width, x)),
                  y: Math.max(0, Math.min(page.height - b.height, y)),
                }
              : b,
          ),
        }))
      invalidate()
    }
    const up = () => {
      drag.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [zoom, page.width, page.height])
  const startDrag = (
    e: React.PointerEvent,
    kind: string,
    originX: number,
    originY: number,
    blockID?: string,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    drag.current = { kind, id: blockID, x: e.clientX, y: e.clientY, originX, originY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const changePage = (index: number) => {
    const target = background?.pages[index]
    if (!target) return
    try {
      patch({ ...fitTemplateToPage(draft, target), listPageIndex: index })
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), true)
    }
  }
  const importPDF = async () => {
    try {
      const result = await native<{
        cancelled?: boolean
        data: string
        listPageIndex: number
        pages: { width: number; height: number }[]
      }>('importPDF')
      if (!result.cancelled)
        patch({
          ...fitTemplateToPage(draft, result.pages[result.listPageIndex]),
          backgroundPDFData: result.data,
          listPageIndex: result.listPageIndex,
        })
    } catch (e) {
      notify(String(e), true)
    }
  }
  const importImage = async () => {
    try {
      const result = await native<{
        cancelled?: boolean
        data: string
        width: number
        height: number
      }>('importImage')
      if (result.cancelled) return
      const scale = Math.min(160 / result.width, 180 / result.height)
      const width = Math.max(20, result.width * scale),
        height = Math.max(20, result.height * scale)
      const block = { id: id(), imageData: result.data, x: 46, y: 46, width, height }
      patch({ imageBlocks: [...(draft.imageBlocks || []), block] })
      setSelected(block.id)
      return block.id
    } catch (e) {
      notify(String(e), true)
    }
  }
  const addText = () => {
    const block = {
      id: id(),
      text: tr('Escribe aquí'),
      x: 46,
      y: 36,
      width: Math.min(220, page.width - 92),
      fontSize: 14,
    }
    patch({ textBlocks: [...(draft.textBlocks || []), block] })
    setSelected(block.id)
    return block.id
  }
  const save = async () => {
    await mutate(
      { kind: 'saveTemplate', entity: draft, expectedTemplate: baseTemplate.current },
      tr('Plantilla guardada'),
    )
    baseTemplate.current = structuredClone(draft)
    setSaved(draft)
  }
  const saveCopy = async () => {
    const copy = {
      ...structuredClone(draft),
      id: id(),
      name: draft.name + ' ' + tr('· copia') + '',
    }
    await mutate({ kind: 'saveTemplate', entity: copy }, tr('Copia guardada'))
    baseTemplate.current = structuredClone(copy)
    resetDraft((current) => ({ ...current, id: copy.id, name: current.name + ' ' + tr('· copia') }))
    setSaved(copy)
  }
  const render = async () => {
    const version = ++previewVersion.current
    setFinal(null)
    setView('final')
    setRendering(true)
    setRenderError('')
    setPageIndex(0)
    try {
      const event: Activity = chosenEvent || {
        id: id(),
        organizationID: orgID,
        title: '',
        startsAt: new Date().toISOString(),
        componentID: s.components.find((c) => c.organizationID === orgID)?.id || id(),
        countsAttendance: false,
        isCancelled: false,
      }
      const previewEntries = chosenEvent
        ? entries
        : entries.map((a) => ({ ...a, id: id(), eventID: event.id, memberID: id() }))
      const result = await native<FinalPDF>('renderPDF', {
        organization,
        event,
        entries: previewEntries,
        template: draft,
        mode,
      })
      if (version === previewVersion.current) setFinal(result)
    } catch (e) {
      if (version === previewVersion.current) {
        setFinal(null)
        setRenderError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (version === previewVersion.current) setRendering(false)
    }
  }
  const finalPage = async (index: number) => {
    if (!final) return
    const version = ++previewVersion.current
    setRendering(true)
    try {
      const result = await native<{ image: string }>('pdfPage', { token: final.token, index })
      if (version === previewVersion.current) {
        setFinal({ ...final, image: result.image })
        setPageIndex(index)
      }
    } catch (e) {
      notify(String(e), true)
    } finally {
      if (version === previewVersion.current) setRendering(false)
    }
  }
  const exportPDF = async () => {
    if (!final || rendering) return
    try {
      const r = await native<{ saved?: boolean }>('exportPDF', { token: final.token })
      if (r.saved) notify(tr('PDF guardado'))
    } catch (e) {
      notify(String(e), true)
    }
  }
  const selectedText = draft.textBlocks?.find((b) => b.id === selected),
    selectedImage = draft.imageBlocks?.find((b) => b.id === selected)
  const removeBlock = () => {
    patch({
      textBlocks: draft.textBlocks?.filter((b) => b.id !== selected),
      imageBlocks: draft.imageBlocks?.filter((b) => b.id !== selected),
    })
    setSelected(null)
  }
  const reorder = (col: Column, direction: number) => {
    const index = draft.columns.indexOf(col),
      target = index + direction
    if (index <= 0 || target <= 0 || target >= draft.columns.length) return
    const cols = [...draft.columns]
    ;[cols[index], cols[target]] = [cols[target], cols[index]]
    patch({ columns: cols })
  }
  const leaveDialog = confirmLeave && (
    <Dialog
      title={tr('Cambios sin guardar')}
      onClose={() => setConfirmLeave(false)}
      focusInput={false}
    >
      <div className="form-footer">
        <button className="button" onClick={back}>
          {tr('Salir sin guardar')}
        </button>
        <button
          className="button primary"
          disabled={busy || !draft.name.trim()}
          onClick={() =>
            void save()
              .then(back)
              .catch(() => {})
          }
        >
          {tr('Guardar y salir')}
        </button>
      </div>
    </Dialog>
  )
  if (compact)
    return (
      <>
        <MobileStudio
          draft={draft}
          patch={patch}
          dirty={dirty}
          busy={busy}
          leave={() => (dirty ? setConfirmLeave(true) : back())}
          save={save}
          saveCopy={saveCopy}
          undo={() => {
            undo()
            invalidate()
          }}
          redo={() => {
            redo()
            invalidate()
          }}
          canUndo={canUndo}
          canRedo={canRedo}
          page={page}
          background={background}
          importPDF={importPDF}
          importImage={importImage}
          addText={addText}
          changePage={changePage}
          entries={entries}
          events={s.events.filter((e) => e.organizationID === orgID)}
          eventSelection={eventSelection}
          selectEvent={(value) => {
            setEventSelection(value)
            invalidate()
          }}
          mode={mode}
          setMode={(value) => {
            setMode(value)
            invalidate()
          }}
          view={view}
          design={() => setView('design')}
          render={render}
          rendering={rendering}
          renderError={renderError}
          final={final}
          pageIndex={pageIndex}
          finalPage={finalPage}
          exportPDF={exportPDF}
          native={nativeAvailable}
        />
        {leaveDialog}
      </>
    )
  return (
    <div className={`document-studio ${toolsOpen ? 'tools-open' : ''}`}>
      <header className="studio-header">
        <button className="text-button" onClick={() => (dirty ? setConfirmLeave(true) : back())}>
          <ArrowLeft size={17} />
          {tr('Plantillas')}
        </button>
        <input
          className="document-name"
          aria-label={tr('Nombre de la plantilla')}
          value={draft.name}
          maxLength={200}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <button
          className="icon-button mobile-tools-toggle"
          aria-label={tr('Herramientas de plantilla')}
          aria-expanded={toolsOpen}
          onClick={() => setToolsOpen((v) => !v)}
        >
          <SlidersHorizontal size={20} />
        </button>
        <span className="draft-status">{dirty ? tr('Cambios sin guardar') : tr('Guardada')}</span>
        <IconButton
          label={tr('Guardar como copia')}
          disabled={busy || !draft.name.trim()}
          onClick={() => void saveCopy().catch(() => {})}
        >
          <Copy size={17} />
        </IconButton>
        <button
          className="button compact"
          disabled={busy || !draft.name.trim()}
          onClick={() => void save().catch(() => {})}
        >
          <Check size={16} />
          <span className="desktop-save-label">{tr('Guardar plantilla')}</span>
          <span className="mobile-save-label">{tr('Guardar')}</span>
        </button>
      </header>
      <div className="studio-body">
        {toolsOpen && (
          <button
            className="studio-tools-backdrop"
            aria-label={tr('Cerrar herramientas')}
            onClick={() => setToolsOpen(false)}
          />
        )}
        <aside className="studio-tools">
          <div className="studio-mode">
            <button className={view === 'design' ? 'active' : ''} onClick={() => setView('design')}>
              <Pencil size={15} />
              {tr('Diseñar')}
            </button>
            <button
              className={view === 'final' ? 'active' : ''}
              onClick={() => {
                setToolsOpen(false)
                void render()
              }}
            >
              <Eye size={15} />
              {tr('Vista final')}
            </button>
          </div>
          <label>
            {tr('Contenido')}
            <select
              value={eventSelection}
              onChange={(e) => {
                setEventSelection(e.target.value)
                invalidate()
              }}
            >
              <option value="">{tr('Muestra de diseño')}</option>
              {s.events
                .filter((e) => e.organizationID === orgID)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
            </select>
          </label>
          <div className="segmented">
            <button
              className={mode === 'blank' ? 'active' : ''}
              onClick={() => {
                setMode('blank')
                invalidate()
              }}
            >
              {tr('Para firmas')}
            </button>
            <button
              className={mode === 'completed' ? 'active' : ''}
              onClick={() => {
                setMode('completed')
                invalidate()
              }}
            >
              {tr('Registrada')}
            </button>
          </div>
          <div className="tool-section">
            <button className="tool-button" onClick={() => void importPDF()}>
              <Upload size={16} />
              {draft.backgroundPDFData ? tr('Cambiar PDF') : tr('Importar PDF')}
            </button>
            {draft.backgroundPDFData && (
              <>
                <button
                  className="text-button muted"
                  onClick={() =>
                    patch({
                      ...fitTemplateToPage(draft, { width: 612, height: 792 }),
                      backgroundPDFData: undefined,
                      listPageIndex: undefined,
                    })
                  }
                >
                  <RotateCcw size={13} />
                  {tr('Volver a hoja en blanco')}
                </button>
                {background && (
                  <label>
                    {tr('Lista sobre la página')}
                    <select
                      value={draft.listPageIndex || 0}
                      onChange={(e) => changePage(Number(e.target.value))}
                    >
                      {background.pages.map((p, i) => (
                        <option key={i} value={i} disabled={!canFitAttendancePage(p, draft.rowHeight)}>
                          {tr('Página')} {i + 1} · {Math.round(p.width)} × {Math.round(p.height)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </div>
          <div className="tool-section">
            <h3>{tr('Añadir')}</h3>
            <div className="tool-grid">
              <button onClick={addText}>
                <Type size={19} />
                {tr('Texto')}
              </button>
              <button onClick={() => void importImage()}>
                <ImagePlus size={19} />
                {tr('Imagen')}
              </button>
              <button
                onClick={() => patch({ headerTitle: draft.headerTitle == null ? '' : undefined })}
              >
                <Type size={22} />
                {tr('Título')}
              </button>
              <button
                onClick={() => patch({ footerText: draft.footerText == null ? '' : undefined })}
              >
                <MoreFooter />
                {tr('Pie')}
              </button>
            </div>
          </div>
          {selectedText || selectedImage ? (
            <div className="tool-section selection-tools">
              <h3>{tr('Selección')}</h3>
              {selectedText && (
                <label>
                  {tr('Tamaño del texto')}
                  <input
                    type="range"
                    min={8}
                    max={32}
                    value={selectedText.fontSize}
                    onChange={(e) =>
                      patch({
                        textBlocks: draft.textBlocks?.map((b) =>
                          b.id === selected
                            ? {
                                ...b,
                                fontSize: Number(e.target.value),
                                y: Math.min(b.y, page.height - Number(e.target.value) * 2.5),
                              }
                            : b,
                        ),
                      })
                    }
                  />
                </label>
              )}
              {selectedImage && (
                <label>
                  {tr('Ancho de imagen')}
                  <input
                    type="range"
                    min={30}
                    max={Math.min(400, page.width - selectedImage.x)}
                    value={selectedImage.width}
                    onChange={(e) => {
                      const width = Number(e.target.value)
                      patch({
                        imageBlocks: draft.imageBlocks?.map((b) =>
                          b.id === selected
                            ? {
                                ...b,
                                width,
                                height: Math.min(page.height - b.y, (b.height / b.width) * width),
                              }
                            : b,
                        ),
                      })
                    }}
                  />
                </label>
              )}
              <button className="text-button danger-text" onClick={removeBlock}>
                <X size={14} />
                {tr('Quitar elemento')}
              </button>
            </div>
          ) : null}
          <div className="tool-section">
            <h3>{tr('Columnas')}</h3>
            {(Object.keys(columnLabels) as Column[]).map((c) => (
              <div className="column-control" key={c}>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.columns.includes(c)}
                    disabled={c === 'participant'}
                    onChange={(e) =>
                      patch({
                        columns: e.target.checked
                          ? [...draft.columns, c]
                          : draft.columns.filter((v) => v !== c),
                      })
                    }
                  />
                  {columnLabels[c]}
                </label>
                {draft.columns.includes(c) && c !== 'participant' && (
                  <span>
                    <IconButton
                      label={tr('Mover {0} a la izquierda', columnLabels[c])}
                      onClick={() => reorder(c, -1)}
                      disabled={draft.columns.indexOf(c) === 1}
                    >
                      <ChevronLeft size={13} />
                    </IconButton>
                    <IconButton
                      label={tr('Mover {0} a la derecha', columnLabels[c])}
                      onClick={() => reorder(c, 1)}
                      disabled={draft.columns.indexOf(c) === draft.columns.length - 1}
                    >
                      <ChevronRight size={13} />
                    </IconButton>
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="tool-section">
            <h3>{tr('Formato')}</h3>
            <div className="swatches">
              {colors.map((c) => (
                <button
                  key={c}
                  style={{ background: c }}
                  className={draft.accentHex.toUpperCase() === c ? 'selected' : ''}
                  aria-label={tr('Color {0}', c)}
                  onClick={() => patch({ accentHex: c })}
                />
              ))}
            </div>
            <label className="color-custom">
              {tr('Color personalizado')}
              <input
                type="color"
                value={draft.accentHex}
                onChange={(e) => patch({ accentHex: e.target.value })}
              />
            </label>
            <label>
              {tr('Altura de fila')} <span>{draft.rowHeight} pt</span>
              <input
                type="range"
                min={18}
                max={80}
                value={draft.rowHeight}
                onChange={(e) => patch({ rowHeight: Number(e.target.value) })}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!draft.showsPageNumber}
                onChange={(e) => patch({ showsPageNumber: e.target.checked })}
              />
              {tr('Numerar páginas')}
            </label>
          </div>
        </aside>
        <section className="paper-workspace">
          <div className="paper-toolbar">
            <span>
              {view === 'design'
                ? chosenEvent
                  ? tr('{0} personas · vista de diseño', entries.length)
                  : tr('Muestra de diseño')
                : tr('Documento final')}
              {backgroundBusy && ' ' + tr('· Cargando PDF…') + ''}
            </span>
            <div>
              <IconButton
                label={tr('Ajustar papel a la pantalla')}
                onClick={() => {
                  const width =
                    document.querySelector('.paper-scroll')?.clientWidth || window.innerWidth
                  setZoom(
                    Math.max(0.25, Math.min(1.3, (width - (width < 600 ? 40 : 100)) / page.width)),
                  )
                }}
              >
                <Maximize size={16} />
              </IconButton>
              <IconButton
                label={tr('Alejar papel')}
                onClick={() => setZoom(Math.max(0.25, zoom - 0.1))}
              >
                <Minus size={16} />
              </IconButton>
              <span>{Math.round(zoom * 100)}%</span>
              <IconButton
                label={tr('Acercar papel')}
                onClick={() => setZoom(Math.min(1.3, zoom + 0.1))}
              >
                <Plus size={16} />
              </IconButton>
            </div>
          </div>
          <div className="paper-scroll" ref={paperScrollRef}>
            {view === 'design' ? (
              <div
                className="paper-size"
                style={{ width: page.width * zoom, height: page.height * zoom }}
              >
                <div
                  className="design-paper"
                  ref={paperRef}
                  style={{ width: page.width, height: page.height, transform: `scale(${zoom})` }}
                  onClick={() => setSelected(null)}
                >
                  {background && (
                    <img
                      className="pdf-background"
                      src={background.image}
                      alt={tr('Página original del PDF')}
                    />
                  )}
                  {draft.headerTitle != null && (
                    <input
                      className="paper-heading-input"
                      aria-label={tr('Título del documento')}
                      placeholder={tr('Escribe un título')}
                      value={draft.headerTitle}
                      onChange={(e) => patch({ headerTitle: e.target.value })}
                    />
                  )}
                  {draft.textBlocks?.map((b) => (
                    <div
                      className={`paper-text-block ${selected === b.id ? 'selected' : ''}`}
                      key={b.id}
                      style={{ left: b.x, top: b.y, width: b.width }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelected(b.id)
                      }}
                    >
                      <button
                        className="drag-handle"
                        aria-label={tr('Mover texto')}
                        onPointerDown={(e) => startDrag(e, 'text', b.x, b.y, b.id)}
                      >
                        <GripHorizontal size={16} />
                      </button>
                      <textarea
                        aria-label={tr('Texto sobre el papel')}
                        value={b.text}
                        style={{ fontSize: b.fontSize, minHeight: b.fontSize * 2.5 }}
                        onChange={(e) =>
                          patch({
                            textBlocks: draft.textBlocks?.map((t) =>
                              t.id === b.id ? { ...t, text: e.target.value } : t,
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                  {draft.imageBlocks?.map((b) => (
                    <div
                      className={`paper-image-block ${selected === b.id ? 'selected' : ''}`}
                      key={b.id}
                      style={{ left: b.x, top: b.y, width: b.width, height: b.height }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelected(b.id)
                      }}
                    >
                      <button
                        className="drag-handle"
                        aria-label={tr('Mover imagen')}
                        onPointerDown={(e) => startDrag(e, 'image', b.x, b.y, b.id)}
                      >
                        <GripHorizontal size={16} />
                      </button>
                      <img
                        src={`data:image/png;base64,${b.imageData}`}
                        alt={tr('Imagen añadida')}
                        draggable={false}
                      />
                    </div>
                  ))}
                  <div
                    className="paper-table-wrap"
                    style={{ top: draft.tableTopOffset ?? 100, left: 46, width: page.width - 92 }}
                  >
                    <button
                      className="table-drag"
                      onPointerDown={(e) => startDrag(e, 'table', 46, draft.tableTopOffset ?? 100)}
                      aria-label={tr('Mover lista verticalmente')}
                    >
                      <GripHorizontal size={16} />
                      <span>{tr('Mover lista')}</span>
                    </button>
                    <table
                      className="design-table"
                      style={
                        {
                          '--table-color': draft.accentHex,
                          '--table-ink': contrastInk(draft.accentHex),
                          '--row-height': `${draft.rowHeight}px`,
                        } as React.CSSProperties
                      }
                    >
                      <thead>
                        <tr>
                          {draft.columns.map((c) => (
                            <th key={c} style={{ width: c === 'participant' ? '34%' : undefined }}>
                              <input
                                aria-label={tr('Título de columna {0}', columnLabels[c])}
                                value={draft.columnLabels?.[c] ?? columnLabels[c]}
                                onChange={(e) =>
                                  patch({
                                    columnLabels: { ...draft.columnLabels, [c]: e.target.value },
                                  })
                                }
                              />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {entries
                          .slice(
                            0,
                            Math.max(
                              1,
                              Math.min(
                                10,
                                Math.floor(
                                  (page.height - (draft.tableTopOffset ?? 100) - 100) /
                                    draft.rowHeight,
                                ),
                              ),
                            ),
                          )
                          .map((a) => (
                            <tr key={a.id}>
                              {draft.columns.map((c) => (
                                <td key={c}>
                                  {c === 'participant'
                                    ? a.memberNameSnapshot
                                    : c === 'notes' && mode === 'completed'
                                      ? a.note
                                      : mode === 'completed' && a.status === c
                                        ? '✓'
                                        : ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {draft.footerText != null && (
                    <input
                      className="paper-footer-input"
                      aria-label={tr('Pie de página')}
                      placeholder={tr('Escribe el pie de página')}
                      value={draft.footerText}
                      onChange={(e) => patch({ footerText: e.target.value })}
                    />
                  )}{' '}
                  {draft.showsPageNumber && <span className="design-page-number">1</span>}
                </div>
              </div>
            ) : (
              <div className="final-preview">
                {rendering && (
                  <div className="render-indicator">
                    <span className="spinner" />
                    {tr('Preparando documento…')}
                  </div>
                )}
                {renderError ? (
                  <Empty
                    title={tr('No se pudo preparar.')}
                    detail={renderError}
                    action={tr('Volver al diseño')}
                    onAction={() => setView('design')}
                  />
                ) : final ? (
                  <img
                    src={final.image}
                    alt={tr('Vista final, página {0}', pageIndex + 1)}
                    style={{ width: page.width * zoom }}
                  />
                ) : null}
              </div>
            )}
          </div>
          <footer className="paper-bottom">
            {view === 'design' ? (
              <>
                <button
                  className="button primary"
                  onClick={() => {
                    setToolsOpen(false)
                    void render()
                  }}
                >
                  {tr('Revisar documento')}
                  <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <>
                <div className="page-navigation">
                  <IconButton
                    label={tr('Página anterior')}
                    onClick={() => void finalPage(pageIndex - 1)}
                    disabled={rendering || pageIndex <= 0}
                  >
                    <ChevronLeft size={17} />
                  </IconButton>
                  <span>{final ? `${pageIndex + 1} / ${final.pageCount}` : '—'}</span>
                  <IconButton
                    label={tr('Página siguiente')}
                    onClick={() => void finalPage(pageIndex + 1)}
                    disabled={rendering || !final || pageIndex >= final.pageCount - 1}
                  >
                    <ChevronRight size={17} />
                  </IconButton>
                </div>
                <button
                  className="button primary"
                  disabled={!final || rendering}
                  onClick={() => void exportPDF()}
                >
                  <Download size={16} />
                  {tr('Guardar PDF')}
                </button>
              </>
            )}
          </footer>
        </section>
      </div>
      {confirmLeave && (
        <Dialog title={tr('Cambios sin guardar')} onClose={() => setConfirmLeave(false)}>
          <div className="form-footer">
            <button className="button" onClick={back}>
              {tr('Salir sin guardar')}
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void save()
                  .then(back)
                  .catch(() => {})
              }
            >
              {tr('Guardar y salir')}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
function MoreFooter() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path d="M4 5h14M4 10h14M4 17h9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function contrastInk(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? '#26372e' : '#fff'
}
