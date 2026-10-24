import { t as tr, locale } from './i18n'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  UserPlus,
  X,
} from 'lucide-react'
import type { Activity, Attendance, ID, Period, Snapshot, Status } from './domain'
import { activeMembership, id, statusLabels, volunteerOrder } from './domain'
import { attendanceCounts, attendanceName, searchKey } from './attendanceModel'
import { useWorkspace } from './workspace'
import { Avatar } from './ui'
import { Menu, MenuDivider, MenuItem, Segmented, Sheet, coarsePointer, spring, useLayout } from './kit'
import type { EventDraft } from './forms'
import { selectionFeedback } from './platform'

const marks: { status: Status; label: string; short: string }[] = [
  { status: 'present', label: tr('Presente'), short: '1' },
  { status: 'absent', label: tr('Ausente'), short: '2' },
  { status: 'excused', label: tr('Excusada'), short: '3' },
]
const StatusIcon = ({ status, size = 16 }: { status: Status; size?: number }) =>
  status === 'present' ? (
    <Check size={size} strokeWidth={2.4} />
  ) : status === 'absent' ? (
    <X size={size} strokeWidth={2.4} />
  ) : status === 'excused' ? (
    <Minus size={size} strokeWidth={2.4} />
  ) : null

export const eventWhen = (e: Activity) =>
  new Date(e.startsAt).toLocaleString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  })

export function EventView({
  s,
  event,
  period,
  back,
  edit,
  document: openDocument,
  openMember,
}: {
  s: Snapshot
  event: Activity
  period?: Period
  back?: () => void
  edit: (draft: EventDraft) => void
  document: () => void
  openMember: (id: ID) => void
}) {
  const { mutate } = useWorkspace()
  const [tab, setTab] = useState<'list' | 'volunteers'>('list'),
    [menu, setMenu] = useState(false),
    [picker, setPicker] = useState<null | 'list' | 'volunteers'>(null)
  const more = useRef<HTMLButtonElement>(null)
  const component = s.components.find((c) => c.id === event.componentID),
    category = s.categories.find((c) => c.id === event.categoryID)
  useEffect(() => setTab('list'), [event.id])
  const toggleCancel = () =>
    void mutate(
      { kind: 'cancelEvent', eventID: event.id, cancelled: !event.isCancelled },
      event.isCancelled ? tr('Encuentro reactivado') : tr('Encuentro cancelado'),
    ).catch(() => {})
  return (
    <article className="nx-event" aria-label={event.title}>
      <header className="nx-event-head">
        <div className="nx-event-bar">
          {back && (
            <button className="nx-back" onClick={back}>
              <ArrowLeft size={19} />
              <span>{tr('Encuentros')}</span>
            </button>
          )}
          <span className="nx-spacer" />
          <button className="nx-button quiet" onClick={openDocument}>
            <FileText size={17} />
            <span>{tr('Documento')}</span>
          </button>
          <button
            ref={more}
            className="nx-icon"
            aria-label={tr('Opciones del encuentro')}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={20} />
          </button>
          <Menu open={menu} onClose={() => setMenu(false)} anchor={more} label={tr('Opciones del encuentro')} align="end">
            <MenuItem icon={<Pencil size={16} />} onClick={() => (setMenu(false), edit({ mode: 'edit', event }))}>
              {tr('Editar')}
            </MenuItem>
            <MenuItem icon={<Copy size={16} />} onClick={() => (setMenu(false), edit({ mode: 'duplicate', event }))}>
              {tr('Duplicar')}
            </MenuItem>
            <MenuDivider />
            <MenuItem danger={!event.isCancelled} icon={<RotateCcw size={16} />} onClick={() => (setMenu(false), toggleCancel())}>
              {event.isCancelled ? tr('Reactivar') : tr('Cancelar encuentro')}
            </MenuItem>
          </Menu>
        </div>
        <button className="nx-event-when" onClick={() => edit({ mode: 'edit', event })}>
          {eventWhen(event)}
        </button>
        <h1 className="nx-event-title">
          <button onClick={() => edit({ mode: 'edit', event })}>{event.title}</button>
        </h1>
        <div className="nx-event-tags">
          {component && <span className="nx-tag">{component.name}</span>}
          {category && <span className="nx-tag">{category.name}</span>}
          {!event.countsAttendance && <span className="nx-tag warn">{tr('No cuenta')}</span>}
          {event.isCancelled && <span className="nx-tag danger">{tr('Cancelado')}</span>}
        </div>
      </header>
      {event.volunteerCapacity != null && (
        <Segmented
          label={tr('Sección del encuentro')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'list', label: tr('Asistencia') },
            { value: 'volunteers', label: tr('Voluntariado') },
          ]}
        />
      )}
      {tab === 'list' ? (
        <Roll s={s} event={event} openMember={openMember} addPeople={() => setPicker('list')} />
      ) : (
        <Volunteers s={s} event={event} period={period} addPeople={() => setPicker('volunteers')} />
      )}
      <RosterPicker
        s={s}
        event={event}
        mode={picker}
        close={() => setPicker(null)}
      />
    </article>
  )
}

type Filter = 'all' | Status | 'excluded'

function Roll({
  s,
  event,
  openMember,
  addPeople,
}: {
  s: Snapshot
  event: Activity
  openMember: (id: ID) => void
  addPeople: () => void
}) {
  const { mutate, notify } = useWorkspace()
  const layout = useLayout()
  const [filter, setFilter] = useState<Filter>('all'),
    [query, setQuery] = useState(''),
    [record, setRecord] = useState<ID | null>(null),
    [saving, setSaving] = useState<ID | null>(null),
    [focus, setFocus] = useState(0),
    [limit, setLimit] = useState(80)
  const all = useMemo(() => s.attendance.filter((a) => a.eventID === event.id), [s.attendance, event.id])
  const rows = all.filter((a) => !a.isVoided)
  const counts = attendanceCounts(all)
  const sorted = useMemo(
    () =>
      [...all].sort((a, b) =>
        attendanceName(s, a).localeCompare(attendanceName(s, b), locale, { sensitivity: 'base' }),
      ),
    [all, s],
  )
  const key = searchKey(query)
  const visible = sorted.filter(
    (a) =>
      (filter === 'excluded' ? a.isVoided : !a.isVoided && (filter === 'all' || a.status === filter)) &&
      (!key || searchKey(attendanceName(s, a)).includes(key)),
  )
  const locked = event.isCancelled
  const set = async (row: Attendance, status: Status, toggle = true) => {
    if (locked || row.isVoided || saving) return
    const next = row.status === status ? (toggle ? 'pending' : status) : status
    if (next === row.status) return
    setSaving(row.memberID)
    selectionFeedback()
    try {
      await mutate({ kind: 'attendance', eventID: event.id, memberID: row.memberID, status: next, expectedStatus: row.status })
      notify(`${attendanceName(s, row)} · ${next === 'pending' ? tr('Por registrar') : statusLabels[next]}`, false, () =>
        void mutate({ kind: 'attendance', eventID: event.id, memberID: row.memberID, status: row.status, expectedStatus: next }).catch(() => {}),
      )
    } catch {
      /* The workspace already shows the error. */
    } finally {
      setSaving(null)
    }
  }
  // Keyboard: ↑/↓ move, 1/2/3 mark, Enter opens the record.
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (coarsePointer()) return
    const handle = (e: KeyboardEvent) => {
      if (
        document.querySelector('.nx-sheet-layer, .nx-menu, dialog[open]') ||
        (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable=true]')) ||
        e.metaKey || e.ctrlKey || e.altKey
      )
        return
      const row = visible[Math.min(focus, visible.length - 1)]
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        setFocus((f) => Math.min(visible.length - 1, f + 1))
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        setFocus((f) => Math.max(0, f - 1))
      } else if (row && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault()
        void set(row, marks[Number(e.key) - 1].status).then(() => {
          if (filter === 'pending') return
          setFocus((f) => Math.min(visible.length - 1, f + 1))
        })
      } else if (row && e.key === 'Enter') setRecord(row.memberID)
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  })
  useEffect(() => {
    listRef.current?.querySelector('.is-focused')?.scrollIntoView({ block: 'nearest' })
  }, [focus])
  const selected = all.find((a) => a.memberID === record)
  if (!all.length)
    return (
      <div className="nx-empty">
        <h3>{tr('Sin lista')}</h3>
        <button className="nx-button primary" onClick={addPeople} disabled={locked}>
          <UserPlus size={17} />
          {tr('Elegir personas')}
        </button>
      </div>
    )
  const total = rows.length || 1
  return (
    <section className="nx-roll" aria-label={tr('Asistencia')}>
      <div className="nx-tally">
        <div className="nx-tally-bar" aria-hidden="true">
          {(['present', 'absent', 'excused'] as Status[]).map((st) => (
            <motion.i key={st} className={st} animate={{ width: `${(counts[st] / total) * 100}%` }} transition={spring} />
          ))}
        </div>
        <div className="nx-tally-counts" role="radiogroup" aria-label={tr('Filtrar la lista')}>
          {(
            [
              ['all', tr('Todas'), rows.length],
              ['pending', tr('Por registrar'), counts.pending],
              ['present', tr('Presentes'), counts.present],
              ['absent', tr('Ausentes'), counts.absent],
              ['excused', tr('Excusadas'), counts.excused],
            ] as [Filter, string, number][]
          ).map(([value, label, n]) => (
            <button
              key={value}
              role="radio"
              aria-checked={filter === value}
              className={`nx-tally-count ${value}`}
              onClick={() => {
                setFilter(filter === value && value !== 'all' ? 'all' : value)
                setFocus(0)
              }}
            >
              <b>{n}</b>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="nx-roll-tools">
        {rows.length > 10 && (
          <label className="nx-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={tr('Buscar en la lista')}
              aria-label={tr('Buscar en la lista')}
              onChange={(e) => {
                setQuery(e.target.value)
                setFocus(0)
              }}
            />
          </label>
        )}
        <button className="nx-button quiet" onClick={addPeople} disabled={locked}>
          <Plus size={16} />
          {tr('Añadir')}
        </button>
      </div>
      {layout !== 'phone' && !coarsePointer() && rows.length > 0 && (
        <p className="nx-hint">{tr('↑ ↓ para moverte · 1 presente · 2 ausente · 3 excusada')}</p>
      )}
      <div className="nx-roll-list" ref={listRef} role="list">
        <AnimatePresence initial={false}>
          {visible.slice(0, limit).map((row, i) => (
            <RollRow
              key={row.id}
              row={row}
              name={attendanceName(s, row)}
              index={s.members.findIndex((m) => m.id === row.memberID)}
              focused={!coarsePointer() && i === focus}
              saving={saving === row.memberID}
              locked={locked}
              set={(st, toggle) => void set(row, st, toggle)}
              open={() => setRecord(row.memberID)}
            />
          ))}
        </AnimatePresence>
        {!visible.length && (
          <div className="nx-empty small">
            <p>{filter === 'pending' && !query ? tr('Todo registrado') : tr('Sin coincidencias')}</p>
            <button className="nx-link" onClick={() => (setFilter('all'), setQuery(''))}>
              {tr('Ver toda la lista')}
            </button>
          </div>
        )}
      </div>
      {visible.length > limit && (
        <button className="nx-button quiet wide" onClick={() => setLimit(limit + 80)}>
          {tr('Mostrar {0} más', visible.length - limit)}
        </button>
      )}
      {all.some((a) => a.isVoided) && filter !== 'excluded' && (
        <button className="nx-link subtle" onClick={() => setFilter('excluded')}>
          {tr('Fuera de la lista ({0})', all.filter((a) => a.isVoided).length)}
        </button>
      )}
      <RecordSheet
        s={s}
        event={event}
        row={selected}
        close={() => setRecord(null)}
        openMember={openMember}
      />
    </section>
  )
}

function RollRow({
  row,
  name,
  index,
  focused,
  saving,
  locked,
  set,
  open,
}: {
  row: Attendance
  name: string
  index: number
  focused: boolean
  saving: boolean
  locked: boolean
  set: (status: Status, toggle?: boolean) => void
  open: () => void
}) {
  const x = useMotionValue(0)
  const touch = coarsePointer()
  const presentOpacity = useTransform(x, [0, 80], [0, 1]),
    absentOpacity = useTransform(x, [-80, 0], [1, 0])
  const threshold = 84
  const dragged = useRef(false)
  const guard = (action: () => void) => () => {
    if (dragged.current) {
      dragged.current = false
      return
    }
    action()
  }
  return (
    <motion.div
      role="listitem"
      layout="position"
      className={`nx-roll-row state-${row.isVoided ? 'excluded' : row.status} ${focused ? 'is-focused' : ''} ${saving ? 'is-saving' : ''}`}
      initial={{ opacity: 0.4 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
    >
      {touch && !row.isVoided && !locked && (
        <>
          <motion.span className="nx-swipe-hint present" style={{ opacity: presentOpacity }}>
            <Check size={20} strokeWidth={2.5} />
            {tr('Presente')}
          </motion.span>
          <motion.span className="nx-swipe-hint absent" style={{ opacity: absentOpacity }}>
            {tr('Ausente')}
            <X size={20} strokeWidth={2.5} />
          </motion.span>
        </>
      )}
      <motion.div
        className="nx-roll-face"
        style={{ x }}
        drag={touch && !row.isVoided && !locked ? 'x' : false}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.55}
        onDragStart={() => (dragged.current = true)}
        onDragEnd={(_, info) => {
          window.setTimeout(() => (dragged.current = false), 80)
          if (info.offset.x > threshold) set('present', false)
          else if (info.offset.x < -threshold) set('absent', false)
          animate(x, 0, spring)
        }}
      >
        <button className="nx-roll-person" onClick={guard(open)} aria-label={tr('Registro de {0}', name)}>
          <Avatar name={name} index={index} size={36} />
          <span className="nx-roll-name">
            <strong>{name}</strong>
            <small>
              {row.isVoided ? tr('Fuera de la lista') : row.status === 'pending' ? tr('Por registrar') : statusLabels[row.status]}
              {row.note && <> · {row.note}</>}
            </small>
          </span>
        </button>
        {!row.isVoided && (
          <div className="nx-marks" role="group" aria-label={tr('Estado de {0}', name)}>
            {marks.map((m) => (
              <button
                key={m.status}
                className={`nx-mark ${m.status}`}
                aria-pressed={row.status === m.status}
                aria-label={`${m.label}: ${name}`}
                title={`${m.label} (${m.short})`}
                disabled={locked || saving}
                onClick={guard(() => set(m.status))}
              >
                <StatusIcon status={m.status} />
              </button>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

function RecordSheet({
  s,
  event,
  row,
  close,
  openMember,
}: {
  s: Snapshot
  event: Activity
  row?: Attendance
  close: () => void
  openMember: (id: ID) => void
}) {
  const { mutate } = useWorkspace()
  const [note, setNote] = useState(''),
    [base, setBase] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false)
  const finishing = useRef(false)
  useEffect(() => {
    setNote(row?.note ?? '')
    setBase(row?.note ?? '')
    setError('')
  }, [row?.id])
  const dirty = note !== base
  const name = row ? attendanceName(s, row) : ''
  const finish = async (after: () => void | Promise<void> = close) => {
    if (finishing.current) return
    finishing.current = true
    setSaving(true)
    setError('')
    try {
      if (row && dirty) {
        await mutate(
          { kind: 'attendance', eventID: event.id, memberID: row.memberID, status: row.status, note, expectedNote: base, noteOnly: true },
          tr('Nota guardada'),
        )
        setBase(note)
      }
      await after()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      finishing.current = false
      setSaving(false)
    }
  }
  return (
    <Sheet open={!!row} onClose={() => void finish()} title={name}>
      {row && (
        <div className="nx-record">
          {!row.isVoided ? (
            <div className="nx-record-marks">
              {[...marks, { status: 'pending' as Status, label: tr('Por registrar'), short: '0' }].map((m) => (
                <button
                  key={m.status}
                  className={`nx-record-mark ${m.status}`}
                  aria-pressed={row.status === m.status}
                  disabled={event.isCancelled || saving}
                  onClick={() =>
                    void mutate({ kind: 'attendance', eventID: event.id, memberID: row.memberID, status: m.status, expectedStatus: row.status }).catch(() => {})
                  }
                >
                  <span className="nx-record-icon">
                    <StatusIcon status={m.status} size={18} />
                  </span>
                  {m.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="nx-quiet">{tr('Fuera de la lista. No cuenta en ningún resultado.')}</p>
          )}
          {row.status === 'excused' && !row.isVoided && (
            <p className="nx-quiet">{tr('No cuenta en su porcentaje.')}</p>
          )}
          {!row.isVoided && (
            <label className="nx-field">
              <span className="nx-field-label">{tr('Nota')}</span>
              <textarea
                value={note}
                rows={3}
                maxLength={4000}
                placeholder={tr('Motivo, aviso, comentario')}
                disabled={event.isCancelled || saving}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          {error && <p className="nx-form-error" role="alert">{error}</p>}
          <div className="nx-group">
            <button
              className="nx-group-row link"
              disabled={saving}
              onClick={() => void finish(() => { close(); openMember(row.memberID) })}
            >
              <span>{tr('Historial de {0}', name)}</span>
              <ArrowUpRight size={16} />
            </button>
            <button
              className={`nx-group-row link ${row.isVoided ? '' : 'danger'}`}
              disabled={event.isCancelled || saving}
              onClick={() =>
                void finish(async () => {
                  await mutate(
                    { kind: 'inclusion', eventID: event.id, memberID: row.memberID, included: row.isVoided },
                    row.isVoided ? tr('{0} vuelve a la lista', name) : tr('{0} fuera de la lista', name),
                  )
                  close()
                })
              }
            >
              <span>{row.isVoided ? tr('Devolver a la lista') : tr('Sacar de la lista')}</span>
              <ChevronRight size={16} />
            </button>
          </div>
          {dirty && (
            <div className="nx-form-footer">
              <button className="nx-button" disabled={saving} onClick={() => (setNote(base), close())}>
                {tr('Descartar')}
              </button>
              <button className="nx-button primary" disabled={saving} onClick={() => void finish()}>
                {tr('Guardar nota')}
              </button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

function RosterPicker({
  s,
  event,
  mode,
  close,
}: {
  s: Snapshot
  event: Activity
  mode: null | 'list' | 'volunteers'
  close: () => void
}) {
  const { mutate } = useWorkspace()
  const [selected, setSelected] = useState<ID[]>([]),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false)
  const operation = useRef(false), session = useRef(0)
  useLayoutEffect(() => {
    session.current++
    operation.current = false
    setSelected([])
    setQuery('')
    setError('')
    setSaving(false)
    return () => { session.current++ }
  }, [mode, event.id])
  const version = session.current
  const isCurrent = () => version === session.current && !!mode
  const begin = () => {
    if (!isCurrent() || operation.current) return false
    operation.current = true
    setSaving(true)
    setError('')
    return true
  }
  const dismiss = () => {
    if (!isCurrent() || operation.current) return
    session.current++
    close()
  }
  // Only computed while the picker is open; closed, it costs nothing per render.
  const { available, groups } = useMemo(() => {
    if (!mode) return { available: [], groups: [] }
    const existing = new Set(
      (mode === 'volunteers' ? s.volunteers : s.attendance).filter((a) => a.eventID === event.id).map((a) => a.memberID),
    )
    const available = s.members
      .filter((m) => m.organizationID === event.organizationID && m.isActive && !existing.has(m.id))
      .sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }))
    const at = new Date(event.startsAt)
    const groups = s.groups
      .filter((g) => g.organizationID === event.organizationID)
      .map((g) => ({ ...g, people: available.filter((m) => activeMembership(s, m.id, g.id, at)).map((m) => m.id) }))
      .filter((g) => g.people.length)
    return { available, groups }
  }, [mode, s, event])
  const key = searchKey(query)
  const visible = available.filter((m) => !key || searchKey(m.name).includes(key))
  const exact = s.members.some((m) => m.organizationID === event.organizationID && searchKey(m.name) === key)
  const addNew = async () => {
    const name = query.trim()
    if (!name || exact || !begin()) return
    const memberID = id()
    try {
      await mutate({ kind: 'addMember', id: memberID, organizationID: event.organizationID, name, groupIDs: [] }, tr('{0} añadida', name))
      if (isCurrent()) {
        setSelected((list) => [...new Set([...list, memberID])])
        setQuery('')
      }
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (isCurrent()) {
        operation.current = false
        setSaving(false)
      }
    }
  }
  const toggle = (ids: ID[]) => {
    if (!isCurrent() || operation.current) return
    setSelected((list) => ids.every((i) => list.includes(i))
      ? list.filter((i) => !ids.includes(i)) : [...new Set([...list, ...ids])])
    selectionFeedback()
  }
  const submit = async () => {
    if (!selected.length || !begin()) return
    try {
      await mutate(
        { kind: mode === 'volunteers' ? 'registerVolunteers' : 'roster', eventID: event.id, memberIDs: selected },
        tr('{0} añadidas', selected.length),
      )
      if (isCurrent()) {
        session.current++
        close()
      }
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (isCurrent()) {
        operation.current = false
        setSaving(false)
      }
    }
  }
  return (
    <Sheet
      open={!!mode}
      onClose={dismiss}
      size="large"
      title={mode === 'volunteers' ? tr('Interesados') : tr('Lista de {0}', event.title)}
    >
      <div className="nx-picker">
        {!!groups.length && (
          <div className="nx-chips wrap" aria-label={tr('Añadir por grupo')}>
            {groups.map((g) => (
              <button
                key={g.id}
                className="nx-chip"
                disabled={saving}
                aria-pressed={g.people.every((i) => selected.includes(i))}
                onClick={() => toggle(g.people)}
              >
                {g.people.every((i) => selected.includes(i)) && <Check size={14} />}
                {g.name}
                <span className="nx-chip-count">{g.people.length}</span>
              </button>
            ))}
          </div>
        )}
        <label className="nx-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            readOnly={saving}
            placeholder={tr('Buscar personas')}
            aria-label={tr('Buscar personas')}
            onChange={(e) => {
              if (isCurrent() && !operation.current) setQuery(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim() && !visible.length && !exact) {
                e.preventDefault()
                void addNew()
              }
            }}
          />
        </label>
        <div className="nx-picker-list" role="listbox" aria-multiselectable="true">
          {visible.map((m) => (
            <button
              key={m.id}
              role="option"
              aria-selected={selected.includes(m.id)}
              className="nx-picker-row"
              disabled={saving}
              onClick={() => toggle([m.id])}
            >
              <Avatar name={m.name} index={s.members.indexOf(m)} size={32} />
              <span>{m.name}</span>
              <span className="nx-check">{selected.includes(m.id) && <Check size={14} strokeWidth={3} />}</span>
            </button>
          ))}
          {query.trim() && !exact && (
            <button className="nx-picker-row new" disabled={saving} onClick={() => void addNew()}>
              <span className="nx-new-avatar">
                <Plus size={16} />
              </span>
              <span>{tr('Añadir a «{0}» como persona nueva', query.trim())}</span>
            </button>
          )}
          {!visible.length && !query.trim() && (
            <p className="nx-quiet">
              {available.length || s.members.some((m) => m.organizationID === event.organizationID)
                ? tr('Todas las personas ya están en la lista.')
                : tr('Escribe un nombre para añadir la primera persona.')}
            </p>
          )}
        </div>
        {error && <p className="nx-form-error" role="alert">{error}</p>}
        <div className="nx-form-footer sticky">
          <button className="nx-button" disabled={saving} onClick={dismiss}>
            {tr('Cancelar')}
          </button>
          <button className="nx-button primary" disabled={!selected.length || saving} onClick={() => void submit()}>
            {selected.length ? tr('Añadir {0}', selected.length) : tr('Añadir')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

function Volunteers({
  s,
  event,
  period,
  addPeople,
}: {
  s: Snapshot
  event: Activity
  period?: Period
  addPeople: () => void
}) {
  const { mutate } = useWorkspace()
  const entries = s.volunteers.filter((v) => v.eventID === event.id)
  const ordered = volunteerOrder(s, event, period)
  const chosen = entries.filter((v) => v.status === 'selected')
  const history = entries.filter((v) => ['completed', 'declined', 'noShow'].includes(v.status))
  const occupied = entries.filter((v) => ['selected', 'completed'].includes(v.status)).length
  const capacity = event.volunteerCapacity ?? 0
  const name = (memberID: ID) => s.members.find((m) => m.id === memberID)?.name || tr('Persona')
  const update = (memberID: ID, status: string, message: string) =>
    void mutate({ kind: 'volunteer', eventID: event.id, memberID, status }, message).catch(() => {})
  return (
    <section className="nx-volunteers">
      <div className="nx-capacity">
        <div className="nx-capacity-dots" aria-hidden="true">
          {Array.from({ length: Math.min(capacity, 24) }, (_, i) => (
            <i key={i} className={i < occupied ? 'on' : ''} />
          ))}
        </div>
        <span>{tr('{0} de {1} cupos', occupied, capacity)}</span>
      </div>
      {!!chosen.length && (
        <div className="nx-section">
          <h3>{tr('Seleccionados')}</h3>
          <div className="nx-list">
            {chosen.map((v) => (
              <div className="nx-list-row" key={v.id}>
                <Avatar name={name(v.memberID)} size={32} index={s.members.findIndex((m) => m.id === v.memberID)} />
                <span className="nx-grow">{name(v.memberID)}</span>
                <button className="nx-button small" onClick={() => update(v.memberID, 'completed', tr('Participación registrada'))}>
                  <Check size={14} />
                  {tr('Participó')}
                </button>
                <VolunteerMore
                  onNoShow={() => update(v.memberID, 'noShow', tr('No participó'))}
                  onDecline={() => update(v.memberID, 'declined', tr('Cupo liberado'))}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="nx-section">
        <div className="nx-section-head">
          <h3>{tr('Orden sugerido')}</h3>
          <button className="nx-button quiet small" onClick={addPeople}>
            <Plus size={15} />
            {tr('Interesados')}
          </button>
        </div>
        {ordered.length ? (
          <div className="nx-list">
            {ordered.map((v, i) => (
              <div className="nx-list-row" key={v.id}>
                <span className="nx-rank">{i + 1}</span>
                <span className="nx-grow">
                  <strong>{v.member.name}</strong>
                  <small>
                    {v.count === 0
                      ? tr('Sin participaciones')
                      : v.count === 1
                        ? tr('1 participación')
                        : tr('{0} participaciones', v.count)}
                  </small>
                </span>
                <button
                  className="nx-button small"
                  disabled={occupied >= capacity}
                  onClick={() => update(v.memberID, 'selected', tr('{0} seleccionada', v.member.name))}
                >
                  {tr('Elegir')}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="nx-quiet">{tr('Añade a quienes se ofrecen y aparecerán ordenados por menor participación.')}</p>
        )}
      </div>
      {!!history.length && (
        <div className="nx-section">
          <h3>{tr('Historial')}</h3>
          <div className="nx-list">
            {history.map((v) => (
              <div className="nx-list-row" key={v.id}>
                <span className="nx-grow">{name(v.memberID)}</span>
                <span className={`nx-tag ${v.status === 'completed' ? 'ok' : ''}`}>
                  {v.status === 'completed' ? tr('Participó') : v.status === 'noShow' ? tr('No participó') : tr('Declinó')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function VolunteerMore({ onNoShow, onDecline }: { onNoShow: () => void; onDecline: () => void }) {
  const [open, setOpen] = useState(false),
    anchor = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={anchor} className="nx-icon" aria-label={tr('Más opciones')} onClick={() => setOpen(!open)}>
        <MoreHorizontal size={18} />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} anchor={anchor} label={tr('Más opciones')} align="end">
        <MenuItem onClick={() => (setOpen(false), onNoShow())}>{tr('No participó')}</MenuItem>
        <MenuItem danger onClick={() => (setOpen(false), onDecline())}>
          {tr('Retirar y liberar cupo')}
        </MenuItem>
      </Menu>
    </>
  )
}
