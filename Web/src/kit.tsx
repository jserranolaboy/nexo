import { t as tr } from './i18n'
import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { Check, ChevronDown, X } from 'lucide-react'
import { selectionFeedback } from './platform'

/** Layout classes shared by every scene: phone (<700), tablet (700–1099), wide (≥1100). */
export type Layout = 'phone' | 'tablet' | 'wide'
const layoutFor = (w: number): Layout => (w < 700 ? 'phone' : w < 1100 ? 'tablet' : 'wide')
export function useLayout() {
  const [layout, setLayout] = useState<Layout>(() => layoutFor(window.innerWidth))
  useEffect(() => {
    const update = () => setLayout(layoutFor(window.innerWidth))
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return layout
}
export const coarsePointer = () =>
  !!window.nexoDevice || window.matchMedia('(pointer: coarse)').matches

export const spring = { type: 'spring', stiffness: 520, damping: 44, mass: 0.9 } as const

/**
 * A sheet that rises from the bottom on phones (drag down to close) and appears
 * as a centered panel elsewhere. Content stays mounted while it animates out.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  actions,
  size = 'regular',
  label,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  actions?: ReactNode
  size?: 'regular' | 'large'
  label?: string
}) {
  const layout = useLayout(),
    phone = layout === 'phone'
  const titleID = useId()
  const y = useMotionValue(0)
  const reduce = useReducedMotion()
  const panel = useRef<HTMLDivElement>(null)
  const closeFromKeyboard = useEffectEvent(onClose)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    y.set(0)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        closeFromKeyboard()
      }
    }
    window.addEventListener('keydown', key)
    const frame = requestAnimationFrame(() => {
      const field = panel.current?.querySelector<HTMLElement>('[data-autofocus]')
      if (field && !coarsePointer()) field.focus()
      else panel.current?.focus({ preventScroll: true })
    })
    document.documentElement.classList.add('nx-sheet-open')
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', key)
      document.documentElement.classList.remove('nx-sheet-open')
      previous?.focus?.({ preventScroll: true })
    }
  }, [open])
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={`nx-sheet-layer ${phone ? 'is-phone' : ''}`} key="sheet">
          <motion.div
            className="nx-scrim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.22 }}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleID : undefined}
            aria-label={title ? undefined : label}
            tabIndex={-1}
            className={`nx-sheet ${size}`}
            style={phone ? { y } : undefined}
            initial={phone ? { y: '100%' } : { scale: 0.97, y: 10 }}
            animate={phone ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={phone ? { y: '100%' } : { opacity: 0, scale: 0.98, y: 6 }}
            transition={reduce ? { duration: 0 } : spring}
          >
            {phone && (
              <motion.div
                className="nx-grabber"
                aria-hidden="true"
                onPan={(_, info) => y.set(Math.max(0, info.offset.y))}
                onPanEnd={(_, info) => {
                  if (info.offset.y > 110 || (info.offset.y > 30 && info.velocity.y > 600))
                    onClose()
                  else animate(y, 0, spring)
                }}
              >
                <span />
              </motion.div>
            )}
            {(title || actions) && (
              <header className="nx-sheet-head">
                {title && <h2 id={titleID}>{title}</h2>}
                <div className="nx-sheet-actions">
                  {actions}
                  <button className="nx-icon" aria-label={tr('Cerrar')} onClick={onClose}>
                    <X size={18} />
                  </button>
                </div>
              </header>
            )}
            <div className="nx-sheet-body">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Anchored popover for short choices. On phones it becomes a sheet. */
export function Menu({
  open,
  onClose,
  anchor,
  children,
  label,
  align = 'start',
}: {
  open: boolean
  onClose: () => void
  anchor: React.RefObject<HTMLElement | null>
  children: ReactNode
  label: string
  align?: 'start' | 'end'
}) {
  const layout = useLayout()
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!open || layout === 'phone') return
    const place = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (!r) return
      const width = ref.current?.offsetWidth || 240
      const left =
        align === 'end'
          ? Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12))
          : Math.max(12, Math.min(r.left, window.innerWidth - width - 12))
      const below = window.innerHeight - r.bottom - 16
      setPos({ top: r.bottom + 6, left, maxHeight: Math.max(160, below) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, layout])
  useEffect(() => {
    if (!open || layout === 'phone') return
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node))
        onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        anchor.current?.focus()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') || [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
        e.preventDefault()
      }
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>('[aria-checked=true], button')?.focus(),
    )
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [open, layout])
  if (layout === 'phone')
    return (
      <Sheet open={open} onClose={onClose} label={label}>
        <div className="nx-menu-list" role="menu" aria-label={label}>
          {children}
        </div>
      </Sheet>
    )
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          role="menu"
          aria-label={label}
          className="nx-menu"
          style={{ top: pos?.top ?? -999, left: pos?.left ?? -999, maxHeight: pos?.maxHeight }}
          initial={{ y: -4, scale: 0.98 }}
          animate={{ y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -2, transition: { duration: 0.12 } }}
          transition={{ duration: 0.16 }}
        >
          <div className="nx-menu-list">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
export function MenuItem({
  children,
  onClick,
  checked,
  danger,
  icon,
  detail,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  checked?: boolean
  danger?: boolean
  icon?: ReactNode
  detail?: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      className={`nx-menu-item ${danger ? 'danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="nx-menu-icon">{checked ? <Check size={16} /> : icon}</span>
      <span className="nx-menu-label">{children}</span>
      {detail && <span className="nx-menu-detail">{detail}</span>}
    </button>
  )
}
export const MenuDivider = () => <hr className="nx-menu-divider" />

/** A button that opens a Menu of options; replaces native selects. */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
  placeholder,
  footer,
  className = '',
}: {
  value: T | ''
  options: { value: T; label: string; detail?: string }[]
  onChange: (value: T) => void
  label: string
  placeholder?: string
  footer?: (close: () => void) => ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false),
    anchor = useRef<HTMLButtonElement>(null)
  const current = options.find((o) => o.value === value)
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`nx-choice ${className}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label || placeholder || ''}`}
        onClick={() => setOpen(!open)}
      >
        <span>{current?.label || placeholder}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} anchor={anchor} label={label}>
        {options.map((o) => (
          <MenuItem
            key={o.value}
            checked={o.value === value}
            detail={o.detail}
            onClick={() => {
              onChange(o.value)
              setOpen(false)
              selectionFeedback()
            }}
          >
            {o.label}
          </MenuItem>
        ))}
        {footer && (
          <>
            <MenuDivider />
            {footer(() => setOpen(false))}
          </>
        )}
      </Menu>
    </>
  )
}

/** Horizontal chips. Selecting the active chip again clears it when `clearable`. */
export function Chips({
  items,
  value,
  onChange,
  label,
  trailing,
  onLongPress,
}: {
  items: { value: string; label: string; count?: number }[]
  value: string
  onChange: (value: string) => void
  label: string
  trailing?: ReactNode
  onLongPress?: (value: string) => void
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    pressed = useRef(false)
  return (
    <div className="nx-chips" role="radiogroup" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          role="radio"
          aria-checked={value === item.value}
          className="nx-chip"
          onPointerDown={() => {
            pressed.current = false
            if (!onLongPress || !item.value) return
            timer.current = setTimeout(() => {
              pressed.current = true
              selectionFeedback()
              onLongPress(item.value)
            }, 520)
          }}
          onPointerUp={() => clearTimeout(timer.current)}
          onPointerLeave={() => clearTimeout(timer.current)}
          onContextMenu={(e) => {
            if (!onLongPress || !item.value) return
            e.preventDefault()
            onLongPress(item.value)
          }}
          onClick={() => {
            if (pressed.current) return
            onChange(item.value)
            selectionFeedback()
          }}
        >
          {item.label}
          {item.count != null && <span className="nx-chip-count">{item.count}</span>}
        </button>
      ))}
      {trailing}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
  label: string
}) {
  const id = useId()
  return (
    <div className="nx-segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => {
            onChange(o.value)
            selectionFeedback()
          }}
        >
          {o.value === value && (
            <motion.span layoutId={`seg-${id}`} className="nx-segmented-thumb" transition={spring} />
          )}
          <span className="nx-segmented-label">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="nx-toggle"
      onClick={() => {
        onChange(!checked)
        selectionFeedback()
      }}
    >
      <motion.span layout transition={spring} />
    </button>
  )
}

/** Text that turns into a field in place. Enter saves, Escape restores. */
export function InlineText({
  value,
  onSave,
  label,
  className = '',
  as: Tag = 'span',
  disabled,
}: {
  value: string
  onSave: (value: string) => Promise<unknown>
  label: string
  className?: string
  as?: 'span' | 'h1' | 'h2' | 'h3'
  disabled?: boolean
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(value),
    [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])
  useEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    }
  }, [editing])
  const commit = async () => {
    const next = draft.trim()
    if (!next || next === value) {
      setEditing(false)
      setDraft(value)
      return
    }
    setSaving(true)
    try {
      await onSave(next)
      setEditing(false)
    } catch {
      input.current?.focus()
    } finally {
      setSaving(false)
    }
  }
  if (!editing)
    return (
      <Tag className={`nx-inline ${className}`}>
        <button
          type="button"
          className="nx-inline-trigger"
          disabled={disabled}
          aria-label={`${label}: ${value}`}
          onClick={() => setEditing(true)}
        >
          {value}
        </button>
      </Tag>
    )
  return (
    <Tag className={`nx-inline is-editing ${className}`}>
      <input
        ref={input}
        value={draft}
        aria-label={label}
        maxLength={200}
        disabled={saving}
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setDraft(value)
            setEditing(false)
          }
        }}
      />
    </Tag>
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <label className="nx-field">
      <span className="nx-field-label">{label}</span>
      {children}
      {hint && <span className="nx-field-hint">{hint}</span>}
    </label>
  )
}

export function Row({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  return onClick ? (
    <button type="button" className={`nx-row ${className}`} onClick={onClick}>
      {children}
    </button>
  ) : (
    <div className={`nx-row ${className}`}>{children}</div>
  )
}
