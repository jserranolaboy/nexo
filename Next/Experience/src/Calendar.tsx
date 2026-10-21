import { t as tr, locale } from './i18n'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { Activity, ID, Period, Snapshot } from './domain'
import { inPeriod } from './domain'
import { attendanceCounts } from './attendanceModel'
import { Chips } from './kit'
import type { Layout } from './kit'
import { selectionFeedback } from './platform'

export const dayKey = (value: string | Date) => {
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fromKey = (key: string) => new Date(key + 'T12:00:00')
const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const shift = (x.getDay() + 6) % 7 // weeks start on Monday
  x.setDate(x.getDate() - shift)
  return x
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const time = (e: Activity) => new Date(e.startsAt).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })

export function firstRelevantEvent(events: Activity[], now = new Date()) {
  const today = dayKey(now)
  return (
    events.find((e) => !e.isCancelled && dayKey(e.startsAt) >= today) ||
    [...events].reverse().find((e) => !e.isCancelled) ||
    events[0]
  )
}

export function Agenda({
  s,
  orgID,
  period,
  layout,
  selectedID,
  select,
  create,
  manageComponent,
  componentFilter,
  setComponentFilter,
}: {
  s: Snapshot
  orgID: ID
  period?: Period
  layout: Layout
  selectedID: ID | null
  select: (id: ID) => void
  create: (day?: Date) => void
  manageComponent: (id: ID | null) => void
  componentFilter: ID
  setComponentFilter: (id: ID) => void
}) {
  const reduce = useReducedMotion()
  const components = s.components.filter((c) => c.organizationID === orgID)
  const events = useMemo(
    () =>
      s.events
        .filter(
          (e) =>
            e.organizationID === orgID &&
            inPeriod(e.startsAt, period) &&
            (!componentFilter || e.componentID === componentFilter),
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [s.events, orgID, period, componentFilter],
  )
  const days = useMemo(() => {
    const map = new Map<string, Activity[]>()
    for (const e of events) {
      const k = dayKey(e.startsAt)
      map.set(k, [...(map.get(k) || []), e])
    }
    return [...map.entries()]
  }, [events])
  const today = dayKey(new Date())
  const relevant = firstRelevantEvent(events)
  const [focusDay, setFocusDay] = useState(() => (relevant ? dayKey(relevant.startsAt) : today))
  const [month, setMonth] = useState(false)
  const scroller = useRef<HTMLDivElement>(null),
    programmatic = useRef(false)
  // One pass over all attendance, however many events the period has.
  const counts = useMemo(() => {
    type Count = ReturnType<typeof attendanceCounts> & { total: number }
    const result = new Map<ID, Count>()
    for (const e of events) result.set(e.id, { pending: 0, present: 0, absent: 0, excused: 0, total: 0 })
    for (const a of s.attendance) {
      const c = result.get(a.eventID)
      if (!c || a.isVoided) continue
      c[a.status]++
      c.total++
    }
    return result
  }, [events, s.attendance])

  const scrollToDay = (key: string, smooth = true) => {
    const box = scroller.current
    if (!box) return
    const groups = [...box.querySelectorAll<HTMLElement>('[data-day]')]
    const target = groups.find((g) => (g.dataset.day || '') >= key) || groups.at(-1)
    if (!target) return
    programmatic.current = true
    box.scrollTo({ top: target.offsetTop - 4, behavior: smooth && !reduce ? 'smooth' : 'auto' })
    window.setTimeout(() => (programmatic.current = false), smooth ? 450 : 50)
  }
  // Open on today's or the next relevant day, never on the first day of the period.
  useLayoutEffect(() => {
    scrollToDay(selectedID ? dayKey(s.events.find((e) => e.id === selectedID)?.startsAt || today) : focusDay, false)
  }, [orgID, period?.id, componentFilter])
  // The strip follows the agenda while scrolling.
  const onScroll = () => {
    if (programmatic.current) return
    const box = scroller.current
    if (!box) return
    const top = box.scrollTop + 8
    const groups = [...box.querySelectorAll<HTMLElement>('[data-day]')]
    const current = groups.filter((g) => g.offsetTop <= top).at(-1) || groups[0]
    if (current?.dataset.day && current.dataset.day !== focusDay) setFocusDay(current.dataset.day)
  }
  const choose = (key: string) => {
    setFocusDay(key)
    scrollToDay(key)
    selectionFeedback()
  }
  const week = startOfWeek(fromKey(focusDay))
  const eventDays = new Set(days.map(([k]) => k))
  const shiftWeek = (n: number) => {
    const target = dayKey(addDays(week, n * 7))
    setFocusDay(target)
    scrollToDay(target)
  }
  const header = fromKey(focusDay).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  return (
    <section className="nx-agenda" aria-label={tr('Encuentros')}>
      <div className="nx-agenda-top">
        <div className="nx-agenda-month">
          <button
            className="nx-month-label"
            aria-expanded={month}
            onClick={() => setMonth(!month)}
          >
            <CalendarDays size={16} />
            <span>{header}</span>
          </button>
          <span className="nx-spacer" />
          {focusDay !== today && (
            <button className="nx-link" onClick={() => choose(today)}>
              {tr('Hoy')}
            </button>
          )}
          <button className="nx-icon" aria-label={tr('Semana anterior')} onClick={() => shiftWeek(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button className="nx-icon" aria-label={tr('Semana siguiente')} onClick={() => shiftWeek(1)}>
            <ChevronRight size={18} />
          </button>
        </div>
        {month ? (
          <MonthGrid
            focusDay={focusDay}
            eventDays={eventDays}
            today={today}
            choose={(k) => {
              choose(k)
              setMonth(false)
            }}
            shift={(n) => {
              const d = fromKey(focusDay)
              d.setMonth(d.getMonth() + n, 1)
              setFocusDay(dayKey(d))
            }}
          />
        ) : (
          <motion.div
            className="nx-week"
            key={dayKey(week)}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.35}
            onDragEnd={(_, info) => {
              if (info.offset.x < -50 || info.velocity.x < -400) shiftWeek(1)
              else if (info.offset.x > 50 || info.velocity.x > 400) shiftWeek(-1)
            }}
            initial={reduce ? false : { opacity: 0.4 }}
            animate={{ opacity: 1 }}
          >
            {Array.from({ length: 7 }, (_, i) => addDays(week, i)).map((d) => {
              const k = dayKey(d)
              return (
                <button
                  key={k}
                  className={`nx-day ${k === today ? 'today' : ''} ${k === focusDay ? 'focus' : ''}`}
                  aria-current={k === today ? 'date' : undefined}
                  aria-pressed={k === focusDay}
                  aria-label={d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
                  onClick={() => choose(k)}
                >
                  <span>{d.toLocaleDateString(locale, { weekday: 'narrow' })}</span>
                  <b>{d.getDate()}</b>
                  <i className={eventDays.has(k) ? 'has' : ''} />
                </button>
              )
            })}
          </motion.div>
        )}
        {(components.length > 0 || componentFilter) && (
          <Chips
            label={tr('Componente')}
            value={componentFilter}
            onChange={(v) => setComponentFilter(v === componentFilter ? '' : v)}
            onLongPress={(v) => manageComponent(v)}
            items={[
              { value: '', label: tr('Todos') },
              ...components.map((c) => ({ value: c.id, label: c.name })),
            ]}
            trailing={
              <button className="nx-chip ghost" onClick={() => manageComponent(null)} aria-label={tr('Componentes')}>
                {tr('Editar')}
              </button>
            }
          />
        )}
      </div>
      <div className="nx-agenda-scroll" ref={scroller} onScroll={onScroll}>
        {!events.length ? (
          <div className="nx-empty">
            <h3>
              {componentFilter
                ? tr('Sin encuentros en este componente')
                : period
                  ? tr('Sin encuentros en {0}', period.name)
                  : tr('Sin encuentros')}
            </h3>
            <button className="nx-button primary" onClick={() => create()}>
              <Plus size={17} />
              {tr('Crear encuentro')}
            </button>
          </div>
        ) : (
          days.map(([k, list]) => (
            <div className="nx-day-group" data-day={k} key={k}>
              <h3 className={`nx-day-head ${k === today ? 'today' : k < today ? 'past' : ''}`}>
                <span>{k === today ? tr('Hoy') : fromKey(k).toLocaleDateString(locale, { weekday: 'long' })}</span>
                <span>{fromKey(k).toLocaleDateString(locale, { day: 'numeric', month: 'long' })}</span>
              </h3>
              {list.map((e) => {
                const c = counts.get(e.id)!
                const component = s.components.find((x) => x.id === e.componentID)
                const category = s.categories.find((x) => x.id === e.categoryID)
                const featured = layout === 'phone' && e.id === relevant?.id
                const done = c.total - c.pending
                return (
                  <button
                    key={e.id}
                    className={`nx-agenda-row ${selectedID === e.id ? 'selected' : ''} ${e.isCancelled ? 'cancelled' : ''} ${featured ? 'featured' : ''}`}
                    aria-current={selectedID === e.id ? 'true' : undefined}
                    onClick={() => select(e.id)}
                  >
                    <span className="nx-agenda-time">{time(e)}</span>
                    <span className="nx-agenda-main">
                      <strong>{e.title}</strong>
                      <small>
                        {[component?.name, category?.name].filter(Boolean).join(' · ')}
                        {!e.countsAttendance && ` · ${tr('No cuenta')}`}
                      </small>
                      {featured && c.total > 0 && (
                        <span className="nx-featured-bar" aria-hidden="true">
                          <i className="present" style={{ width: `${(c.present / c.total) * 100}%` }} />
                          <i className="absent" style={{ width: `${(c.absent / c.total) * 100}%` }} />
                          <i className="excused" style={{ width: `${(c.excused / c.total) * 100}%` }} />
                        </span>
                      )}
                    </span>
                    <span className="nx-agenda-state">
                      {e.isCancelled ? (
                        <span className="nx-tag danger">{tr('Cancelado')}</span>
                      ) : c.total ? (
                        <Progress done={done} total={c.total} />
                      ) : (
                        <span className="nx-muted-label">{tr('Sin lista')}</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ))
        )}
        <div className="nx-agenda-end" />
      </div>
    </section>
  )
}

function Progress({ done, total }: { done: number; total: number }) {
  const r = 9,
    c = 2 * Math.PI * r,
    ratio = total ? done / total : 0
  return (
    <span className={`nx-progress ${ratio === 1 ? 'complete' : ''}`} aria-label={tr('{0} de {1} registrados', done, total)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r={r} className="track" />
        <circle cx="12" cy="12" r={r} className="value" strokeDasharray={`${c * ratio} ${c}`} transform="rotate(-90 12 12)" />
      </svg>
      <span>
        {done}/{total}
      </span>
    </span>
  )
}

function MonthGrid({
  focusDay,
  eventDays,
  today,
  choose,
  shift,
}: {
  focusDay: string
  eventDays: Set<string>
  today: string
  choose: (key: string) => void
  shift: (n: number) => void
}) {
  const focus = fromKey(focusDay)
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1)
  const start = startOfWeek(first)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    addDays(start, i).toLocaleDateString(locale, { weekday: 'narrow' }),
  )
  return (
    <div className="nx-month">
      <div className="nx-month-nav">
        <button className="nx-icon" aria-label={tr('Mes anterior')} onClick={() => shift(-1)}>
          <ChevronLeft size={17} />
        </button>
        <span>{first.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</span>
        <button className="nx-icon" aria-label={tr('Mes siguiente')} onClick={() => shift(1)}>
          <ChevronRight size={17} />
        </button>
      </div>
      <div className="nx-month-grid" role="grid">
        {weekdays.map((w, i) => (
          <span key={i} className="nx-month-weekday">
            {w}
          </span>
        ))}
        {cells.map((d) => {
          const k = dayKey(d)
          return (
            <button
              key={k}
              className={`nx-month-day ${d.getMonth() !== first.getMonth() ? 'outside' : ''} ${k === today ? 'today' : ''} ${k === focusDay ? 'focus' : ''}`}
              onClick={() => choose(k)}
              aria-label={d.toLocaleDateString(locale, { day: 'numeric', month: 'long' })}
            >
              {d.getDate()}
              {eventDays.has(k) && <i />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
