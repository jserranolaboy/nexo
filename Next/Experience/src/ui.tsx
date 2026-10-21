import { t as tr, locale } from './i18n'
import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { X, ArrowUpRight, Plus, Info, Search } from 'lucide-react'
import { animate, motion, useMotionValue } from 'motion/react'
import { initials } from './domain'
export const palette = ['#e2e3e7', '#dbdde2', '#e9e9ec', '#d5d7dd', '#e5e6e9', '#dfe1e6']
export function Avatar({
  name,
  index = 0,
  size = 42,
  status,
}: {
  name: string
  index?: number
  size?: number
  status?: string
}) {
  return (
    <span
      className={`avatar ${status || ''}`}
      style={
        {
          '--avatar-color': palette[index % palette.length],
          width: size,
          height: size,
          fontSize: size * 0.29,
        } as CSSProperties
      }
    >
      {initials(name)}
      {status && status !== 'pending' && <i />}
    </span>
  )
}
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M8 29V11C8 6 14 5 17 9L23 19M32 11V29C32 34 26 35 23 31L17 21"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
export function IconButton({
  children,
  label,
  onClick,
  disabled,
  className = '',
}: {
  children: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
export function Dialog({
  title,
  onClose,
  children,
  wide = false,
  className = '',
  focusInput = true,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  className?: string
  focusInput?: boolean
}) {
  const titleID = useId()
  const ref = useRef<HTMLDialogElement>(null),
    previous = useRef<Element | null>(null)
  useEffect(() => {
    previous.current = document.activeElement
    ref.current?.showModal()
    if (
      focusInput &&
      !window.nexoDevice &&
      !window.matchMedia('(pointer: coarse)').matches &&
      !window.matchMedia('(max-width: 700px)').matches
    )
      ref.current?.querySelector<HTMLInputElement>('input:not([type=checkbox]), textarea')?.focus()
    else ref.current?.focus({ preventScroll: true })
    return () => {
      ref.current?.close()
      ;(previous.current as HTMLElement)?.focus?.({ preventScroll: true })
    }
  }, [])
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleID}
      className={`dialog ${wide ? 'wide' : ''} ${className}`}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="dialog-content">
        <header>
          <h2 id={titleID}>{title}</h2>
          <IconButton label={tr('Cerrar')} onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </dialog>
  )
}
export function SearchField({
  value,
  onChange,
  label,
  placeholder = label,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className={`search-field ${className}`}>
      <Search size={17} aria-hidden="true" />
      <input
        ref={input}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === 'Enter' &&
            (window.nexoDevice || window.matchMedia('(pointer: coarse)').matches)
          )
            e.currentTarget.blur()
        }}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label={tr('Limpiar búsqueda')}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('')
            input.current?.focus({ preventScroll: true })
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
export function Empty({
  title,
  detail,
  action,
  onAction,
}: {
  title: string
  detail?: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {action && (
        <button className="button primary" onClick={onAction}>
          <Plus size={16} />
          {action}
        </button>
      )}
    </div>
  )
}
export function ContextHelp({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className="icon-button context-help"
        title={title}
        aria-label={title}
        onClick={() => setOpen(true)}
      >
        <Info size={17} />
      </button>
      {open && (
        <Dialog
          title={title}
          className="context-help-dialog"
          onClose={() => setOpen(false)}
          focusInput={false}
        >
          <div className="context-help-content">{children}</div>
        </Dialog>
      )}
    </>
  )
}
export function Ring({
  value,
  total,
  size = 150,
  light = false,
}: {
  value: number
  total: number
  size?: number
  light?: boolean
}) {
  const ratio = total ? value / total : 0
  return (
    <div className={`ring ${light ? 'light' : ''}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <circle className="ring-track" cx="80" cy="80" r="68" />
        <motion.circle
          className="ring-value"
          cx="80"
          cy="80"
          r="68"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: ratio }}
          transition={{ duration: 0.65 }}
        />
      </svg>
      <div>
        <strong>
          {value}
          <small>/{total}</small>
        </strong>
        <span>{tr('registrados')}</span>
      </div>
    </div>
  )
}
export function SceneHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string
  title: string
  children?: ReactNode
}) {
  return (
    <div className="scene-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  )
}
export function ArrowLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="arrow-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={17} />
    </button>
  )
}
export const formatDate = (date: string, options?: Intl.DateTimeFormatOptions) =>
  new Date(date).toLocaleDateString(locale, options ?? { day: 'numeric', month: 'long' })
export const formatTime = (date: string) =>
  new Date(date).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
export const localInputDate = (date: Date) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return adjusted.toISOString().slice(0, 16)
}

export function ResponsivePanel({
  children,
  label,
  onClose,
}: {
  children: ReactNode
  label: string
  onClose: () => void
}) {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 700px)').matches)
  const ref = useRef<HTMLDialogElement>(null)
  const sheetY = useMotionValue(0)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)')
    const change = () => setCompact(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (!compact) return
    const dialog = ref.current,
      previous = document.activeElement as HTMLElement | null
    dialog?.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = overflow
      previous?.focus?.({ preventScroll: true })
    }
  }, [compact])
  if (!compact) return <>{children}</>
  return (
    <motion.dialog
      style={{ y: sheetY }}
      ref={ref}
      className="touch-sheet"
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <motion.div
        className="sheet-handle"
        aria-hidden="true"
        onPan={(_, info) => sheetY.set(Math.max(0, info.offset.y))}
        onPanEnd={(_, info) => {
          if (info.offset.y > 90 || (info.offset.y > 28 && info.velocity.y > 500)) onClose()
          else animate(sheetY, 0, { type: 'spring', stiffness: 500, damping: 42 })
        }}
      >
        <span />
      </motion.div>
      {children}
    </motion.dialog>
  )
}
