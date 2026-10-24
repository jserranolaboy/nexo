import { t as tr, locale } from './i18n'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import { id, nextWholeHour } from './domain'
import type { Activity, ID, Period, Snapshot } from './domain'
import { useWorkspace } from './workspace'
import { Field, Sheet, Toggle } from './kit'

const pad = (n: number) => String(n).padStart(2, '0')
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const combine = (date: string, time: string) => new Date(`${date}T${time || '00:00'}:00`)

type FormSession = { active: boolean; pending: boolean }
// A Sheet can retain its exit body after the outer form changes context.
function useFormSession(key: string | null) {
  const session = useMemo<FormSession>(() => ({ active: !!key, pending: false }), [key])
  useLayoutEffect(() => {
    session.active = !!key
    return () => { session.active = false }
  }, [session, key])
  return session
}
function dismissForm(session: FormSession, close: () => void) {
  if (!session.active || session.pending) return false
  session.active = false
  close()
  return true
}
function useSubmit(session: FormSession) {
  const { busy } = useWorkspace()
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [committing, setCommitting] = useState(false)
  const mounted = useRef(true), primaryWrite = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    primaryWrite.current = false
    setSaving(false)
    setCommitting(false)
    setError('')
    return () => { mounted.current = false }
  }, [session])
  const isActive = () => mounted.current && session.active
  const canEdit = () => isActive() && !primaryWrite.current
  const run = async (job: () => Promise<unknown>, primary = false) => {
    if (!isActive() || session.pending || busy) return false
    session.pending = true
    // Inline classification writes share the lock without freezing newer choices.
    primaryWrite.current = primary
    setCommitting(primary)
    setSaving(true)
    setError('')
    try {
      await job()
      return isActive()
    } catch (e) {
      if (isActive()) setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      session.pending = false
      if (isActive()) {
        primaryWrite.current = false
        setCommitting(false)
        setSaving(false)
      }
    }
  }
  return { error, saving: saving || busy, committing, canEdit, isActive, run, setError }
}

function Footer({
  saving,
  pending,
  error,
  label,
  disabled,
  onCancel,
}: {
  saving: boolean
  pending: boolean
  error: string
  label: string
  disabled?: boolean
  onCancel: () => void
}) {
  return (
    <>
      {error && (
        <p className="nx-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="nx-form-footer">
        <button type="button" className="nx-button" disabled={pending} onClick={onCancel}>
          {tr('Cancelar')}
        </button>
        <button className="nx-button primary" disabled={saving || disabled}>
          {saving ? tr('Guardando…') : label}
        </button>
      </div>
    </>
  )
}

/** Inline "new item" chip used inside forms: becomes a small field when tapped. */
function NewChip({ label, onCreate, disabled }: { label: string; onCreate: (name: string) => Promise<boolean>; disabled?: boolean }) {
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(''),
    [saving, setSaving] = useState(false)
  const submitting = useRef(false),
    editingVersion = useRef(0)
  if (!editing)
    return (
      <button type="button" className="nx-chip add" disabled={disabled} onClick={() => {
        if (disabled) return
        editingVersion.current++
        setEditing(true)
      }}>
        <Plus size={14} />
        {label}
      </button>
    )
  const version = editingVersion.current
  const finishEditing = () => {
    editingVersion.current++
    setName('')
    setEditing(false)
  }
  const save = async () => {
    if (disabled || version !== editingVersion.current || submitting.current) return
    if (!name.trim()) return finishEditing()
    submitting.current = true
    setSaving(true)
    try {
      if (await onCreate(name.trim())) finishEditing()
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }
  return (
    <span className="nx-chip-input">
      <input
        autoFocus
        value={name}
        readOnly={saving || disabled}
        maxLength={200}
        aria-label={label}
        placeholder={label}
        onChange={(e) => {
          if (!disabled && version === editingVersion.current && !submitting.current) setName(e.target.value)
        }}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void save()
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            if (!disabled && version === editingVersion.current && !submitting.current) finishEditing()
          }
        }}
      />
    </span>
  )
}

export type EventDraft = { mode: 'new' | 'edit' | 'duplicate'; event?: Activity; day?: Date }

export function EventForm({
  s,
  orgID,
  draft,
  close,
  saved,
}: {
  s: Snapshot
  orgID: ID
  draft: EventDraft | null
  close: () => void
  saved: (id: ID) => void
}) {
  const key = draft ? `${orgID}:${draft.mode}:${draft.event?.id ?? ''}:${draft.day?.getTime() ?? ''}` : null
  const session = useFormSession(key)
  const dismiss = () => dismissForm(session, close)
  return (
    <Sheet
      open={!!draft}
      onClose={dismiss}
      title={
        draft?.mode === 'edit'
          ? tr('Editar encuentro')
          : draft?.mode === 'duplicate'
            ? tr('Duplicar encuentro')
            : tr('Nuevo encuentro')
      }
    >
      {draft && (
        <EventFormBody
          key={key}
          s={s}
          orgID={orgID}
          draft={draft}
          close={dismiss}
          saved={saved}
          session={session}
        />
      )}
    </Sheet>
  )
}

function EventFormBody({
  s,
  orgID,
  draft,
  close,
  saved,
  session,
}: {
  s: Snapshot
  orgID: ID
  draft: EventDraft
  close: () => void
  saved: (id: ID) => void
  session: FormSession
}) {
  const { mutate } = useWorkspace()
  const source = draft.event
  const start = (() => {
    if (draft.mode === 'edit' && source) return new Date(source.startsAt)
    if (draft.mode === 'duplicate' && source) {
      const d = new Date(source.startsAt)
      d.setDate(d.getDate() + 7)
      return d
    }
    if (draft.day) {
      const d = new Date(draft.day),
        base = nextWholeHour()
      d.setHours(base.getHours(), 0, 0, 0)
      return d
    }
    return nextWholeHour()
  })()
  const components = s.components.filter((c) => c.organizationID === orgID)
  const [title, setTitle] = useState(source?.title ?? ''),
    [date, setDate] = useState(dateValue(start)),
    [time, setTime] = useState(timeValue(start)),
    [componentID, setComponentID] = useState<ID>(source?.componentID ?? components[0]?.id ?? ''),
    [categoryID, setCategoryID] = useState<ID>(source?.categoryID ?? ''),
    [counts, setCounts] = useState(source?.countsAttendance ?? true),
    [volunteers, setVolunteers] = useState(source?.volunteerCapacity != null),
    [capacity, setCapacity] = useState(source?.volunteerCapacity ?? 4),
    [copyList, setCopyList] = useState(true)
  const { error, saving, committing, canEdit, isActive, run } = useSubmit(session)
  const classificationVersion = useRef(0)
  const categories = s.categories.filter((c) => c.componentID === componentID)
  const sourceRows =
    draft.mode === 'duplicate' && source
      ? s.attendance.filter((a) => a.eventID === source.id && !a.isVoided)
      : []
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await run(async () => {
      if (!componentID) throw new Error(tr('Elige o crea un componente.'))
      const when = combine(date, time)
      if (Number.isNaN(when.getTime())) throw new Error(tr('La fecha no es válida.'))
      const entity: Activity = {
        id: draft.mode === 'edit' && source ? source.id : id(),
        organizationID: orgID,
        title: title.trim(),
        startsAt: when.toISOString(),
        componentID,
        categoryID: categoryID || undefined,
        countsAttendance: counts,
        isCancelled: draft.mode === 'edit' ? !!source?.isCancelled : false,
        volunteerCapacity: volunteers ? Math.max(1, capacity) : undefined,
      }
      if (draft.mode === 'edit') {
        await mutate({ kind: 'updateEvent', entity }, tr('Encuentro actualizado'))
      } else {
        const people = copyList ? sourceRows
          .map((a) => a.memberID)
          .filter((m) => s.members.some((x) => x.id === m && x.organizationID === orgID && x.isActive)) : []
        await mutate({ kind: 'addEvent', entity, ...(people.length ? { memberIDs: people } : {}) }, tr('Encuentro creado'))
      }
      if (isActive()) saved(entity.id)
    }, true)
    if (ok) close()
  }
  const createComponent = async (name: string) => {
    const newID = id(), version = classificationVersion.current
    const ok = await run(() => mutate({ kind: 'addComponent', id: newID, organizationID: orgID, name }))
    if (ok && isActive() && version === classificationVersion.current) {
      setComponentID(newID)
      setCategoryID('')
    }
    return ok
  }
  const createCategory = async (name: string) => {
    const newID = id(), version = classificationVersion.current
    const ok = await run(() => mutate({ kind: 'addCategory', id: newID, componentID, name }))
    if (ok && isActive() && version === classificationVersion.current) setCategoryID(newID)
    return ok
  }
  return (
    <form className="nx-form" onSubmit={submit}>
      <input
        className="nx-title-field"
        data-autofocus
        required
        maxLength={200}
        value={title}
        readOnly={committing}
        placeholder={tr('Nombre del encuentro')}
        aria-label={tr('Nombre del encuentro')}
        autoCapitalize="sentences"
        enterKeyHint="next"
        onChange={(e) => { if (canEdit()) setTitle(e.target.value) }}
      />
      <div className="nx-field-pair">
        <Field label={tr('Día')}>
          <input type="date" required value={date} disabled={committing} onChange={(e) => { if (canEdit()) setDate(e.target.value) }} />
        </Field>
        <Field label={tr('Hora')}>
          <input
            type="time"
            required
            step={300}
            value={time}
            disabled={committing}
            onChange={(e) => { if (canEdit()) setTime(e.target.value) }}
          />
        </Field>
      </div>
      <p className="nx-form-preview" aria-live="polite">
        {(() => {
          const when = combine(date, time)
          return Number.isNaN(when.getTime())
            ? ''
            : when.toLocaleString(locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                hour: 'numeric',
                minute: '2-digit',
              })
        })()}
      </p>
      <fieldset className="nx-fieldset">
        <legend>{tr('Componente')}</legend>
        <div className="nx-chips wrap">
          {components.map((c) => (
            <button
              type="button"
              key={c.id}
              className="nx-chip"
              disabled={committing}
              aria-pressed={componentID === c.id}
              onClick={() => {
                if (!canEdit()) return
                classificationVersion.current++
                setComponentID(c.id)
                setCategoryID('')
              }}
            >
              {c.name}
            </button>
          ))}
          <NewChip
            disabled={committing}
            label={components.length ? tr('Otro') : tr('Crear componente')}
            onCreate={createComponent}
          />
        </div>
      </fieldset>
      {componentID && (
        <fieldset className="nx-fieldset">
          <legend>
            {tr('Categoría')} <span>{tr('opcional')}</span>
          </legend>
          <div className="nx-chips wrap">
            {categories.map((c) => (
              <button
                type="button"
                key={c.id}
                className="nx-chip"
                disabled={committing}
                aria-pressed={categoryID === c.id}
                onClick={() => {
                  if (!canEdit()) return
                  classificationVersion.current++
                  setCategoryID(categoryID === c.id ? '' : c.id)
                }}
              >
                {c.name}
              </button>
            ))}
            <NewChip key={componentID} disabled={committing} label={tr('Categoría')} onCreate={createCategory} />
          </div>
        </fieldset>
      )}
      <div className="nx-group">
        <div className="nx-group-row">
          <span>{tr('Cuenta para asistencia')}</span>
          <Toggle checked={counts} disabled={committing} onChange={(value) => { if (canEdit()) setCounts(value) }} label={tr('Cuenta para asistencia')} />
        </div>
        <div className="nx-group-row">
          <span>{tr('Voluntariado')}</span>
          <Toggle checked={volunteers} disabled={committing} onChange={(value) => { if (canEdit()) setVolunteers(value) }} label={tr('Voluntariado')} />
        </div>
        {volunteers && (
          <div className="nx-group-row">
            <span>{tr('Cupos')}</span>
            <span className="nx-stepper">
              <button
                type="button"
                aria-label={tr('Menos cupos')}
                disabled={committing}
                onClick={() => { if (canEdit()) setCapacity(Math.max(1, capacity - 1)) }}
              >
                <Minus size={15} />
              </button>
              <output>{capacity}</output>
              <button
                type="button"
                aria-label={tr('Más cupos')}
                disabled={committing}
                onClick={() => { if (canEdit()) setCapacity(Math.min(5000, capacity + 1)) }}
              >
                <Plus size={15} />
              </button>
            </span>
          </div>
        )}
        {!!sourceRows.length && (
          <div className="nx-group-row">
            <span>{tr('Copiar la lista ({0})', sourceRows.length)}</span>
            <Toggle checked={copyList} disabled={committing} onChange={(value) => { if (canEdit()) setCopyList(value) }} label={tr('Copiar la lista')} />
          </div>
        )}
      </div>
      <Footer
        saving={saving}
        pending={session.pending}
        error={error}
        onCancel={close}
        disabled={!title.trim()}
        label={draft.mode === 'edit' ? tr('Guardar') : tr('Crear')}
      />
    </form>
  )
}

export type SimpleKind = 'member' | 'group' | 'component' | 'organization' | 'period'

export function SimpleForm({
  s,
  orgID,
  kind,
  close,
  created,
  period,
}: {
  s: Snapshot
  orgID: ID
  kind: SimpleKind | null
  close: () => void
  created?: (kind: SimpleKind, id: ID) => void
  period?: Period | null
}) {
  const key = kind ? `${orgID}:${kind}:${period?.id ?? ''}` : null
  const session = useFormSession(key)
  const dismiss = () => dismissForm(session, close)
  const titles: Record<SimpleKind, string> = {
    member: tr('Nueva persona'),
    group: tr('Nuevo grupo'),
    component: tr('Nuevo componente'),
    organization: tr('Nuevo espacio'),
    period: period ? tr('Editar período') : tr('Nuevo período'),
  }
  return (
    <Sheet open={!!kind} onClose={dismiss} title={kind ? titles[kind] : ''}>
      {kind && (
        <SimpleBody
          key={key}
          s={s}
          orgID={orgID}
          kind={kind}
          close={dismiss}
          created={created}
          period={period}
          session={session}
        />
      )}
    </Sheet>
  )
}

function suggestedPeriod(s: Snapshot, orgID: ID) {
  const last = s.periods
    .filter((p) => p.organizationID === orgID)
    .sort((a, b) => a.endsAt.localeCompare(b.endsAt))
    .at(-1)
  const start = last ? new Date(last.endsAt) : new Date()
  if (!last) start.setDate(1)
  const end = new Date(start)
  end.setMonth(end.getMonth() + 6)
  end.setDate(end.getDate() - 1)
  return { start, end }
}

function SimpleBody({
  s,
  orgID,
  kind,
  close,
  created,
  period,
  session,
}: {
  s: Snapshot
  orgID: ID
  kind: SimpleKind
  close: () => void
  created?: (kind: SimpleKind, id: ID) => void
  period?: Period | null
  session: FormSession
}) {
  const { mutate } = useWorkspace()
  const suggestion = suggestedPeriod(s, orgID)
  const lastDay = period ? new Date(new Date(period.endsAt).getTime() - 86400000) : suggestion.end
  const [name, setName] = useState(period?.name ?? ''),
    [groups, setGroups] = useState<ID[]>([]),
    [first, setFirst] = useState(dateValue(period ? new Date(period.startsAt) : suggestion.start)),
    [last, setLast] = useState(dateValue(lastDay))
  const { error, saving, committing, canEdit, isActive, run } = useSubmit(session)
  const orgGroups = s.groups.filter((g) => g.organizationID === orgID)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const newID = id()
    const ok = await run(async () => {
      if (kind === 'organization')
        await mutate({ kind: 'createOrganization', id: newID, name }, tr('Espacio creado'))
      else if (kind === 'member')
        await mutate(
          { kind: 'addMember', id: newID, organizationID: orgID, name, groupIDs: groups },
          tr('{0} añadida', name.trim()),
        )
      else if (kind === 'group')
        await mutate({ kind: 'addGroup', id: newID, organizationID: orgID, name }, tr('Grupo creado'))
      else if (kind === 'component')
        await mutate(
          { kind: 'addComponent', id: newID, organizationID: orgID, name },
          tr('Componente creado'),
        )
      else {
        const startsAt = new Date(first + 'T00:00:00'),
          endsAt = new Date(last + 'T00:00:00')
        endsAt.setDate(endsAt.getDate() + 1)
        const entity = {
          id: period?.id ?? newID,
          organizationID: orgID,
          name: name.trim(),
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        }
        await mutate(
          { kind: period ? 'updatePeriod' : 'addPeriod', entity },
          period ? tr('Período actualizado') : tr('Período creado'),
        )
      }
      if (isActive()) created?.(kind, period?.id ?? newID)
    }, true)
    if (ok) close()
  }
  const placeholder: Record<SimpleKind, string> = {
    member: tr('Nombre completo'),
    group: tr('Nombre del grupo'),
    component: tr('Reuniones, formación…'),
    organization: tr('Nombre del espacio'),
    period: tr('Primer semestre'),
  }
  return (
    <form className="nx-form" onSubmit={submit}>
      <input
        className="nx-title-field"
        data-autofocus
        required
        maxLength={200}
        value={name}
        readOnly={committing}
        placeholder={placeholder[kind]}
        aria-label={placeholder[kind]}
        autoComplete={kind === 'member' ? 'name' : 'off'}
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => { if (canEdit()) setName(e.target.value) }}
      />
      {kind === 'member' && !!orgGroups.length && (
        <fieldset className="nx-fieldset">
          <legend>
            {tr('Grupos')} <span>{tr('opcional')}</span>
          </legend>
          <div className="nx-chips wrap">
            {orgGroups.map((g) => (
              <button
                type="button"
                key={g.id}
                className="nx-chip"
                disabled={committing}
                aria-pressed={groups.includes(g.id)}
                onClick={() => {
                  if (canEdit()) setGroups(groups.includes(g.id) ? groups.filter((x) => x !== g.id) : [...groups, g.id])
                }}
              >
                {groups.includes(g.id) && <Check size={14} />}
                {g.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {kind === 'period' && (
        <div className="nx-field-pair">
          <Field label={tr('Primer día')}>
            <input type="date" required value={first} disabled={committing} onChange={(e) => { if (canEdit()) setFirst(e.target.value) }} />
          </Field>
          <Field label={tr('Último día')}>
            <input type="date" required value={last} disabled={committing} onChange={(e) => { if (canEdit()) setLast(e.target.value) }} />
          </Field>
        </div>
      )}
      <Footer
        saving={saving}
        pending={session.pending}
        error={error}
        onCancel={close}
        disabled={!name.trim()}
        label={kind === 'member' ? tr('Añadir') : period ? tr('Guardar') : tr('Crear')}
      />
    </form>
  )
}
