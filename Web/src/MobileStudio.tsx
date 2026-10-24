import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Copy,
  Eye,
  MoreHorizontal,
  FileText,
  ImagePlus,
  Maximize,
  LayoutTemplate,
  Plus,
  Redo2,
  Share2,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2,
  Upload,
} from 'lucide-react'
import type { Activity, Attendance, Column, Template } from './domain'
import {
  canFitAttendancePage, columnLabels, fitTemplateToPage, maximumTableOffset,
  imageWidthBounds, resizeImageBlock,
} from './domain'
import { Dialog, IconButton } from './ui'
import { t as tr } from './i18n'
import { usePaperZoom } from './usePaperZoom'

const smallScreen =
  typeof window === 'undefined'
    ? null
    : window.matchMedia(window.nexoDevice === 'iPad' ? '(max-width: 1000px)' : '(max-width: 700px)')
export function useCompactStudio() {
  return useSyncExternalStore(
    (fn) => {
      smallScreen?.addEventListener('change', fn)
      return () => smallScreen?.removeEventListener('change', fn)
    },
    () => window.nexoDevice === 'iPhone' || (smallScreen?.matches ?? false),
    () => false,
  )
}
type Panel = 'document' | 'columns' | 'elements' | 'layout'
type Props = {
  draft: Template
  patch: (values: Partial<Template>) => void
  dirty: boolean
  busy: boolean
  leave: () => void
  save: () => Promise<void>
  saveCopy: () => Promise<void>
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  page: { width: number; height: number }
  pageReady: boolean
  background: { image: string; pages: { width: number; height: number }[] } | null
  backgroundBusy: boolean
  backgroundError: string
  retryBackground: () => void
  importPDF: () => Promise<void>
  importImage: () => Promise<string | undefined>
  addText: () => string | undefined
  changePage: (index: number) => void
  entries: Attendance[]
  events: Activity[]
  eventSelection: string
  selectEvent: (id: string) => void
  mode: 'blank' | 'completed'
  setMode: (mode: 'blank' | 'completed') => void
  view: 'design' | 'final'
  design: () => void
  render: () => Promise<void>
  rendering: boolean
  renderError: string
  final: { image: string; pageCount: number } | null
  pageIndex: number
  finalPage: (index: number) => Promise<void>
  exportPDF: () => Promise<void>
  native: boolean
}
export function MobileStudio(p: Props) {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [element, setElement] = useState<string | null>(null)
  const [columnOptions, setColumnOptions] = useState<Column | null>(null)
  const [sheetStart, setSheetStart] = useState<number | null>(null)
  const paperZoom = usePaperZoom()
  const d = p.draft
  const text = d.textBlocks?.find((b) => b.id === element)
  const image = d.imageBlocks?.find((b) => b.id === element)
  const imageBounds = image ? imageWidthBounds(image, p.page) : null
  const remove = () => {
    p.patch({
      textBlocks: d.textBlocks?.filter((b) => b.id !== element),
      imageBlocks: d.imageBlocks?.filter((b) => b.id !== element),
    })
    setElement(null)
  }
  const moveColumn = (c: Column, direction: number) => {
    const index = d.columns.indexOf(c),
      target = index + direction
    if (index < 1 || target < 1 || target >= d.columns.length) return
    const columns = [...d.columns]
    ;[columns[index], columns[target]] = [columns[target], columns[index]]
    p.patch({ columns })
  }
  const updateText = (values: Partial<NonNullable<Template['textBlocks']>[number]>) =>
    p.patch({ textBlocks: d.textBlocks?.map((b) => (b.id === element ? { ...b, ...values } : b)) })
  const updateImage = (values: Partial<NonNullable<Template['imageBlocks']>[number]>) =>
    p.patch({
      imageBlocks: d.imageBlocks?.map((b) => (b.id === element ? { ...b, ...values } : b)),
    })
  const panels = [
    { id: 'document' as const, title: tr('Documento'), Icon: FileText },
    { id: 'columns' as const, title: tr('Columnas'), Icon: Columns3 },
    { id: 'elements' as const, title: tr('Elementos'), Icon: Type },
    { id: 'layout' as const, title: tr('Formato'), Icon: SlidersHorizontal },
  ]
  return (
    <div className="document-studio mobile-studio">
      <header className="mobile-studio-header">
        <IconButton label={tr('Volver a plantillas')} onClick={p.leave}>
          <ArrowLeft size={22} />
        </IconButton>
        <button
          className="mobile-document-title"
          onClick={() => setPanel('document')}
          aria-label={tr('Editar nombre de plantilla')}
        >
          <strong>{d.name || tr('Sin título')}</strong>
          <span>{p.busy ? tr('Guardando…') : p.dirty ? tr('Borrador') : tr('Guardada')}</span>
        </button>
        <button
          className="mobile-save"
          disabled={p.busy || !d.name.trim() || !p.dirty}
          onClick={() => void p.save().catch(() => {})}
        >
          {p.busy ? <span className="spinner" /> : <Check size={19} />}
          <span>{tr('Guardar')}</span>
        </button>
      </header>
      <div className="mobile-preview-controls">
        <div>
          <IconButton label={tr('Deshacer')} disabled={!p.canUndo || p.busy} onClick={p.undo}>
            <Undo2 size={20} />
          </IconButton>
          <IconButton label={tr('Rehacer')} disabled={!p.canRedo || p.busy} onClick={p.redo}>
            <Redo2 size={20} />
          </IconButton>
        </div>
        {paperZoom.zoom > 1.02 && (
          <IconButton label={tr('Ajustar papel a la pantalla')} onClick={paperZoom.reset}>
            <Maximize size={20} />
          </IconButton>
        )}
        <button
          className="mobile-preview-toggle"
          aria-pressed={p.view === 'final'}
          disabled={p.rendering}
          onClick={() => {
            if (p.view === 'final') p.design()
            else if (p.native) void p.render()
            else setPanel('document')
          }}
        >
          <Eye size={18} />
          {p.view === 'final' ? tr('Editar') : tr('Revisar PDF')}
        </button>
      </div>
      <main
        ref={paperZoom.scroll}
        className="mobile-document-scroll"
        aria-label={tr('Vista previa del documento')}
      >
        {p.view === 'design' && p.backgroundBusy && (
          <p role="status">{tr('Preparando PDF…')}</p>
        )}
        {p.view === 'design' && p.backgroundError && (
          <div className="mobile-render-error" role="alert">
            <p>{p.backgroundError}</p>
            <button className="button" onClick={p.retryBackground}>{tr('Reintentar')}</button>
          </div>
        )}
        {p.view === 'final' ? (
          <div
            className="mobile-final-preview"
            style={{ width: paperZoom.width || undefined, maxWidth: 'none' }}
            aria-busy={p.rendering}
          >
            {p.rendering && (
              <div className="mobile-render-state" role="status">
                <span className="spinner" />
                {tr('Preparando PDF…')}
              </div>
            )}
            {p.renderError ? (
              <div className="mobile-render-error" role="alert">
                <p>{p.renderError}</p>
                <button className="button" onClick={p.design}>
                  {tr('Volver al diseño')}
                </button>
              </div>
            ) : (
              p.final && (
                <img src={p.final.image} alt={tr('Vista final, página {0}', p.pageIndex + 1)} />
              )
            )}
          </div>
        ) : (
          <div
            className="mobile-paper-frame"
            style={{ width: paperZoom.width || undefined, maxWidth: 'none' }}
          >
            <div
              className="mobile-paper-fit"
              style={{ aspectRatio: `${p.page.width} / ${p.page.height}` }}
            >
              <MobilePaper
                {...p}
                onEdit={(id, destination) => {
                  setElement(id)
                  setPanel(destination)
                }}
              />
            </div>
          </div>
        )}
      </main>
      {p.view === 'final' ? (
        <footer className="mobile-studio-actions final-actions">
          <div className="mobile-page-navigation">
            <IconButton
              label={tr('Página anterior')}
              disabled={p.rendering || p.pageIndex <= 0}
              onClick={() => void p.finalPage(p.pageIndex - 1)}
            >
              <ChevronLeft size={20} />
            </IconButton>
            <span>{p.final ? `${p.pageIndex + 1} / ${p.final.pageCount}` : '—'}</span>
            <IconButton
              label={tr('Página siguiente')}
              disabled={p.rendering || !p.final || p.pageIndex >= p.final.pageCount - 1}
              onClick={() => void p.finalPage(p.pageIndex + 1)}
            >
              <ChevronRight size={20} />
            </IconButton>
          </div>
          <button
            className="button primary"
            disabled={p.rendering || !p.final}
            onClick={() => void p.exportPDF()}
          >
            <Share2 size={19} />
            {tr('Compartir PDF')}
          </button>
        </footer>
      ) : (
        <footer className="mobile-studio-actions" aria-label={tr('Editar plantilla')}>
          {panels.map(({ id, title, Icon }) => (
            <button key={id} onClick={() => setPanel(id)} aria-haspopup="dialog">
              <Icon size={22} />
              <span>{title}</span>
            </button>
          ))}
        </footer>
      )}
      {panel && (
        <Dialog
          title={panels.find((x) => x.id === panel)!.title}
          className="template-sheet"
          focusInput={false}
          onClose={() => setPanel(null)}
        >
          <button
            className="sheet-grabber"
            aria-label={tr('Cerrar herramientas')}
            onClick={() => setPanel(null)}
            onPointerDown={(e) => {
              setSheetStart(e.clientY)
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerUp={(e) => {
              if (sheetStart != null && e.clientY - sheetStart > 60) setPanel(null)
              setSheetStart(null)
            }}
          >
            <span />
          </button>
          <div
            className="template-panel-tabs"
            role="tablist"
            aria-label={tr('Herramientas de plantilla')}
          >
            {panels.map((x) => (
              <button
                key={x.id}
                id={`template-tab-${x.id}`}
                role="tab"
                aria-controls="template-panel"
                aria-selected={panel === x.id}
                tabIndex={panel === x.id ? 0 : -1}
                onClick={() => setPanel(x.id)}
              >
                {x.title}
              </button>
            ))}
          </div>
          <div
            id="template-panel"
            role="tabpanel"
            aria-labelledby={`template-tab-${panel}`}
            className="template-sheet-fields"
          >
            {panel === 'document' && (
              <>
                <label className="studio-field">
                  {tr('Nombre')}
                  <input
                    value={d.name}
                    maxLength={200}
                    onChange={(e) => p.patch({ name: e.target.value })}
                  />
                </label>
                <label className="studio-field">
                  {tr('Título')}
                  <input
                    value={d.headerTitle ?? ''}
                    placeholder={tr('Opcional')}
                    maxLength={300}
                    onChange={(e) => p.patch({ headerTitle: e.target.value || undefined })}
                  />
                </label>
                <label className="studio-field">
                  {tr('Pie de página')}
                  <textarea
                    rows={2}
                    value={d.footerText ?? ''}
                    placeholder={tr('Opcional')}
                    maxLength={1000}
                    onChange={(e) => p.patch({ footerText: e.target.value || undefined })}
                  />
                </label>
                <div className="studio-action-list">
                  <button onClick={() => void p.importPDF()}>
                    <Upload size={19} />
                    {d.backgroundPDFData ? tr('Cambiar PDF') : tr('Importar PDF')}
                    <ChevronRight size={18} />
                  </button>
                  {d.backgroundPDFData && (
                    <button
                      onClick={() =>
                        p.patch({
                          ...fitTemplateToPage(d, { width: 612, height: 792 }),
                          backgroundPDFData: undefined,
                          listPageIndex: undefined,
                        })
                      }
                    >
                      <LayoutTemplate size={19} />
                      {tr('Usar hoja en blanco')}
                    </button>
                  )}
                  <button
                    disabled={p.busy || !d.name.trim()}
                    onClick={() => void p.saveCopy().catch(() => {})}
                  >
                    <Copy size={19} />
                    {tr('Guardar como copia')}
                  </button>
                </div>
                {p.background && (
                  <label className="studio-field">
                    {tr('Página del PDF')}
                    <select
                      value={d.listPageIndex || 0}
                      onChange={(e) => p.changePage(Number(e.target.value))}
                    >
                      {p.background.pages.map((page, i) => (
                        <option key={i} value={i} disabled={!canFitAttendancePage(page, d.rowHeight)}>
                          {tr('Página {0}', i + 1)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="studio-field">
                  {tr('Contenido')}
                  <select value={p.eventSelection} onChange={(e) => p.selectEvent(e.target.value)}>
                    <option value="">{tr('Muestra de diseño')}</option>
                    {p.events.map((event) => (
                      <option value={event.id} key={event.id}>
                        {event.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div
                  className="template-mode-control"
                  role="group"
                  aria-label={tr('Tipo de listado')}
                >
                  {(['blank', 'completed'] as const).map((mode) => (
                    <button
                      key={mode}
                      aria-pressed={p.mode === mode}
                      onClick={() => p.setMode(mode)}
                    >
                      {mode === 'blank' ? tr('Para firmas') : tr('Con asistencia')}
                    </button>
                  ))}
                </div>
              </>
            )}
            {panel === 'columns' && (
              <>
                <div className="mobile-column-list">
                  {d.columns.map((c, index) => (
                    <div key={c} className="mobile-column-row">
                      <div className="column-name-edit">
                        <label className="studio-field">
                          <span>{columnLabels[c]}</span>
                          <input
                            aria-label={tr('Título de columna {0}', columnLabels[c])}
                            value={d.columnLabels?.[c] ?? columnLabels[c]}
                            maxLength={120}
                            onChange={(e) =>
                              p.patch({ columnLabels: { ...d.columnLabels, [c]: e.target.value } })
                            }
                          />
                        </label>
                        {c !== 'participant' && (
                          <IconButton
                            label={tr('Opciones de columna {0}', columnLabels[c])}
                            onClick={() => setColumnOptions(columnOptions === c ? null : c)}
                          >
                            <MoreHorizontal size={21} />
                          </IconButton>
                        )}
                      </div>
                      {c !== 'participant' && columnOptions === c && (
                        <div className="column-row-actions">
                          <IconButton
                            label={tr('Mover hacia arriba')}
                            disabled={index <= 1}
                            onClick={() => moveColumn(c, -1)}
                          >
                            <ArrowUp size={18} />
                          </IconButton>
                          <IconButton
                            label={tr('Mover hacia abajo')}
                            disabled={index === d.columns.length - 1}
                            onClick={() => moveColumn(c, 1)}
                          >
                            <ArrowDown size={18} />
                          </IconButton>
                          <IconButton
                            label={tr('Quitar columna')}
                            onClick={() => p.patch({ columns: d.columns.filter((v) => v !== c) })}
                          >
                            <Trash2 size={18} />
                          </IconButton>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {(Object.keys(columnLabels) as Column[])
                  .filter((c) => !d.columns.includes(c))
                  .map((c) => (
                    <button
                      className="mobile-add-column"
                      key={c}
                      onClick={() => p.patch({ columns: [...d.columns, c] })}
                    >
                      <Plus size={18} />
                      {columnLabels[c]}
                    </button>
                  ))}
              </>
            )}
            {panel === 'elements' && (
              <>
                <div className="mobile-element-add">
                  <button disabled={!p.pageReady} onClick={() => {
                    const id = p.addText()
                    if (id) setElement(id)
                  }}>
                    <Type size={23} />
                    {tr('Añadir texto')}
                  </button>
                  <button
                    disabled={!p.pageReady}
                    onClick={() =>
                      void p.importImage().then((id) => {
                        if (id) setElement(id)
                      })
                    }
                  >
                    <ImagePlus size={23} />
                    {tr('Añadir imagen')}
                  </button>
                </div>
                <div className="mobile-element-list">
                  {d.textBlocks?.map((b, i) => (
                    <button
                      key={b.id}
                      aria-pressed={element === b.id}
                      onClick={() => setElement(b.id)}
                    >
                      <Type size={20} />
                      <span>{b.text.trim() || tr('Texto {0}', i + 1)}</span>
                      <ChevronRight size={18} />
                    </button>
                  ))}
                  {d.imageBlocks?.map((b, i) => (
                    <button
                      key={b.id}
                      aria-pressed={element === b.id}
                      onClick={() => setElement(b.id)}
                    >
                      <img src={`data:image/png;base64,${b.imageData}`} alt="" />
                      <span>{tr('Imagen {0}', i + 1)}</span>
                      <ChevronRight size={18} />
                    </button>
                  ))}
                </div>
                {text && (
                  <div className="mobile-element-editor">
                    <label className="studio-field">
                      {tr('Texto')}
                      <textarea
                        autoFocus
                        onFocus={(e) => {
                          if (text.text === tr('Escribe aquí')) e.currentTarget.select()
                        }}
                        rows={3}
                        value={text.text}
                        maxLength={10000}
                        onChange={(e) => updateText({ text: e.target.value })}
                      />
                    </label>
                    <Range
                      label={tr('Tamaño del texto')}
                      value={text.fontSize}
                      min={8}
                      max={32}
                      disabled={!p.pageReady}
                      onChange={(fontSize) =>
                        updateText({
                          fontSize,
                          y: Math.min(text.y, p.page.height - fontSize * 2.5),
                        })
                      }
                    />
                    <Range
                      label={tr('Ancho')}
                      value={text.width}
                      min={60}
                      max={Math.min(2000, p.page.width - text.x)}
                      disabled={!p.pageReady}
                      onChange={(width) =>
                        updateText({ width: Math.max(60, Math.min(2000, p.page.width - text.x, width)) })
                      }
                    />
                    <Position
                      x={text.x}
                      y={text.y}
                      maxX={p.page.width - text.width}
                      maxY={p.page.height - text.fontSize * 2.5}
                      disabled={!p.pageReady}
                      onChange={updateText}
                    />
                    <button className="mobile-remove-element" onClick={remove}>
                      <Trash2 size={18} />
                      {tr('Quitar elemento')}
                    </button>
                  </div>
                )}
                {image && (
                  <div className="mobile-element-editor">
                    <Range
                      label={tr('Ancho de imagen')}
                      value={image.width}
                      min={imageBounds?.min ?? image.width}
                      max={imageBounds?.max ?? image.width}
                      disabled={!p.pageReady || !imageBounds}
                      onChange={(width) => updateImage(resizeImageBlock(image, width, p.page))}
                    />
                    <Position
                      x={image.x}
                      y={image.y}
                      maxX={p.page.width - image.width}
                      maxY={p.page.height - image.height}
                      disabled={!p.pageReady}
                      onChange={updateImage}
                    />
                    <button className="mobile-remove-element" onClick={remove}>
                      <Trash2 size={18} />
                      {tr('Quitar elemento')}
                    </button>
                  </div>
                )}
              </>
            )}
            {panel === 'layout' && (
              <>
                <Range
                  label={tr('Posición de la lista')}
                  value={d.tableTopOffset ?? 100}
                  min={100}
                  max={Math.max(100, maximumTableOffset(p.page, d.rowHeight))}
                  disabled={!p.pageReady}
                  onChange={(tableTopOffset) => p.patch({ tableTopOffset })}
                />
                <Range
                  label={tr('Altura de fila')}
                  value={d.rowHeight}
                  min={18}
                  max={80}
                  disabled={!p.pageReady}
                  onChange={(rowHeight) => p.patch({ rowHeight })}
                />
                <label className="studio-color-field">
                  <span>{tr('Color')}</span>
                  <input
                    type="color"
                    value={d.accentHex}
                    onChange={(e) => p.patch({ accentHex: e.target.value })}
                  />
                </label>
                <div className="mobile-swatches">
                  {['#262629', '#007AFF', '#6E6E73', '#8B81A2', '#A85750'].map((color) => (
                    <button
                      key={color}
                      style={{ '--swatch': color } as React.CSSProperties}
                      aria-label={tr('Color {0}', color)}
                      aria-pressed={d.accentHex.toUpperCase() === color}
                      onClick={() => p.patch({ accentHex: color })}
                    >
                      <span />
                      {d.accentHex.toUpperCase() === color && <Check size={17} />}
                    </button>
                  ))}
                </div>
                <label className="studio-switch-row">
                  <span>{tr('Numerar páginas')}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={!!d.showsPageNumber}
                    onChange={(e) => p.patch({ showsPageNumber: e.target.checked })}
                  />
                </label>
              </>
            )}
          </div>
        </Dialog>
      )}
    </div>
  )
}
function Range({
  label,
  value,
  min,
  max,
  onChange,
  disabled = false,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <label className="studio-range">
      <span>
        {label}
        <output>{Math.round(value)} pt</output>
      </span>
      <input
        type="range"
        min={min}
        max={Math.max(min, max)}
        value={value}
        disabled={disabled}
        onChange={(e) => { if (!disabled) onChange(Number(e.target.value)) }}
      />
    </label>
  )
}
function Position({
  x,
  y,
  maxX,
  maxY,
  onChange,
  disabled = false,
}: {
  x: number
  y: number
  maxX: number
  maxY: number
  onChange: (v: { x?: number; y?: number }) => void
  disabled?: boolean
}) {
  return (
    <div className="element-position">
      <Range
        label={tr('Horizontal')}
        value={x}
        min={0}
        max={maxX}
        disabled={disabled}
        onChange={(x) => onChange({ x })}
      />
      <Range
        label={tr('Vertical')}
        value={y}
        min={0}
        max={maxY}
        disabled={disabled}
        onChange={(y) => onChange({ y })}
      />
    </div>
  )
}
function MobilePaper(p: Props & { onEdit: (id: string | null, panel: Panel) => void }) {
  const [width, setWidth] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current!
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  const scale = width / p.page.width
  const d = p.draft
  return (
    <div ref={ref} className="mobile-paper-measure">
      <div
        className="mobile-paper"
        style={{ width: p.page.width, height: p.page.height, transform: `scale(${scale || 0.5})` }}
      >
        {p.background?.image && (
          <img
            className="mobile-paper-background"
            src={p.background.image}
            alt={tr('Página original del PDF')}
          />
        )}
        {d.headerTitle != null && (
          <button className="mobile-paper-title" onClick={() => p.onEdit(null, 'document')}>
            {d.headerTitle}
          </button>
        )}
        {d.textBlocks?.map((b) => (
          <button
            key={b.id}
            className="mobile-paper-text"
            style={{ left: b.x, top: b.y, width: b.width, fontSize: b.fontSize }}
            onClick={() => p.onEdit(b.id, 'elements')}
          >
            {b.text}
          </button>
        ))}
        {d.imageBlocks?.map((b, i) => (
          <button
            key={b.id}
            className="mobile-paper-image"
            style={{ left: b.x, top: b.y, width: b.width, height: b.height }}
            onClick={() => p.onEdit(b.id, 'elements')}
            aria-label={tr('Editar imagen {0}', i + 1)}
          >
            <img src={`data:image/png;base64,${b.imageData}`} alt="" />
          </button>
        ))}
        <button
          className="mobile-paper-table"
          style={{ top: d.tableTopOffset ?? 100, left: 46, width: p.page.width - 92 }}
          onClick={() => p.onEdit(null, 'columns')}
          aria-label={tr('Editar columnas')}
        >
          <table style={{ '--row-height': `${d.rowHeight}px` } as React.CSSProperties}>
            <thead style={{ background: d.accentHex, color: ink(d.accentHex) }}>
              <tr>
                {d.columns.map((c) => (
                  <th key={c} style={{ width: c === 'participant' ? '34%' : undefined }}>
                    {d.columnLabels?.[c] ?? columnLabels[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.entries
                .slice(
                  0,
                  Math.max(
                    1,
                    Math.min(
                      10,
                      Math.floor((p.page.height - (d.tableTopOffset ?? 100) - 100) / d.rowHeight),
                    ),
                  ),
                )
                .map((a) => (
                  <tr key={a.id}>
                    {d.columns.map((c) => (
                      <td key={c}>
                        {c === 'participant'
                          ? a.memberNameSnapshot
                          : c === 'notes' && p.mode === 'completed'
                            ? a.note
                            : p.mode === 'completed' && a.status === c
                              ? '✓'
                              : ''}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </button>
        {d.footerText != null && (
          <button className="mobile-paper-footer" onClick={() => p.onEdit(null, 'document')}>
            {d.footerText}
          </button>
        )}
        {d.showsPageNumber && <span className="mobile-paper-number">1</span>}
      </div>
    </div>
  )
}
function ink(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? '#1d1d1f' : '#fff'
}
