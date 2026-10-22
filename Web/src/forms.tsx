import { t as tr, locale } from './i18n'
import { useRef, useState } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import { id, nextWholeHour } from './domain'
import type { Activity, ID, Period, Snapshot } from './domain'
import { useWorkspace } from './workspace'
import { Field, Sheet, Toggle } from './kit'

const pad = (n: number) => String(n).padStart(2, '0')
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const combine = (date: string, time: string) => new Date(`${date}T${time || '00:00'}:00`)

function useSubmit() {
  const { busy } = useWorkspace()
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const run = async (job: () => Promise<unknown>) => {
    if (submitting.current || busy) return false
    submitting.current = true
    setSaving(true)
    setError('')
    try {
      await job()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }
  return { error, saving: saving || busy, run, setError }
}

function Footer({
  saving,
  error,
  label,
  disabled,
  onCancel,
}: {
  saving: boolean
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
        <button type="button" className="nx-button" onClick={onCancel}>
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
function NewChip({ label, onCreate }: { label: string; onCreate: (name: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(''),
    [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  if (!editing)
    return (
      <button type="button" className="nx-chip add" onClick={() => setEditing(true)}>
        <Plus size={14} />
        {label}
      </button>
    )
  const save = async () => {
    if (submitting.current) return
    if (!name.trim()) return setEditing(false)
    submitting.current = true
    setSaving(true)
    try {
      if (await onCreate(name.trim())) {
        setName('')
        setEditing(false)
      }
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
        readOnly={saving}
        maxLength={200}
        aria-label={label}
        placeholder={label}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void save()
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            setEditing(false)
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
  return (
    <Sheet
      open={!!draft}
      onClose={close}
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
          key={`${draft.mode}-${draft.event?.id}`}
          s={s}
          orgID={orgID}
          draft={draft}
          close={close}
          saved={saved}
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
}: {
  s: Snapshot
  orgID: ID
  draft: EventDraft
  close: () => void
  saved: (id: ID) => void
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
  const { error, saving, run } = useSubmit()
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
      saved(entity.id)
    })
    if (ok) close()
  }
  const createComponent = async (name: string) => {
    const newID = id()
    const ok = await run(() => mutate({ kind: 'addComponent', id: newID, organizationID: orgID, name }))
    if (ok) {
      setComponentID(newID)
      setCategoryID('')
    }
    return ok
  }
  const createCategory = async (name: string) => {
    const newID = id()
    const ok = await run(() => mutate({ kind: 'addCategory', id: newID, componentID, name }))
    if (ok) setCategoryID(newID)
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
        placeholder={tr('Nombre del encuentro')}
        aria-label={tr('Nombre del encuentro')}
        autoCapitalize="sentences"
        enterKeyHint="next"
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="nx-field-pair">
        <Field label={tr('Día')}>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={tr('Hora')}>
          <input
            type="time"
            required
            step={300}
            value={time}
            onChange={(e) => setTime(e.target.value)}
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
              aria-pressed={componentID === c.id}
              onClick={() => {
                setComponentID(c.id)
                setCategoryID('')
              }}
            >
              {c.name}
            </button>
          ))}
          <NewChip
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
                aria-pressed={categoryID === c.id}
                onClick={() => setCategoryID(categoryID === c.id ? '' : c.id)}
              >
                {c.name}
              </button>
            ))}
            <NewChip label={tr('Categoría')} onCreate={createCategory} />
          </div>
        </fieldset>
      )}
      <div className="nx-group">
        <div className="nx-group-row">
          <span>{tr('Cuenta para asistencia')}</span>
          <Toggle checked={counts} onChange={setCounts} label={tr('Cuenta para asistencia')} />
        </div>
        <div className="nx-group-row">
          <span>{tr('Voluntariado')}</span>
          <Toggle checked={volunteers} onChange={setVolunteers} label={tr('Voluntariado')} />
        </div>
        {volunteers && (
          <div className="nx-group-row">
            <span>{tr('Cupos')}</span>
            <span className="nx-stepper">
              <button
                type="button"
                aria-label={tr('Menos cupos')}
                onClick={() => setCapacity(Math.max(1, capacity - 1))}
              >
                <Minus size={15} />
              </button>
              <output>{capacity}</output>
              <button
                type="button"
                aria-label={tr('Más cupos')}
                onClick={() => setCapacity(Math.min(5000, capacity + 1))}
              >
                <Plus size={15} />
              </button>
            </span>
          </div>
        )}
        {!!sourceRows.length && (
          <div className="nx-group-row">
            <span>{tr('Copiar la lista ({0})', sourceRows.length)}</span>
            <Toggle checked={copyList} onChange={setCopyList} label={tr('Copiar la lista')} />
          </div>
        )}
      </div>
      <Footer
        saving={saving}
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
  const titles: Record<SimpleKind, string> = {
    member: tr('Nueva persona'),
    group: tr('Nuevo grupo'),
    component: tr('Nuevo componente'),
    organization: tr('Nuevo espacio'),
    period: period ? tr('Editar período') : tr('Nuevo período'),
  }
  return (
    <Sheet open={!!kind} onClose={close} title={kind ? titles[kind] : ''}>
      {kind && (
        <SimpleBody
          key={kind + (period?.id || '')}
          s={s}
          orgID={orgID}
          kind={kind}
          close={close}
          created={created}
          period={period}
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
}: {
  s: Snapshot
  orgID: ID
  kind: SimpleKind
  close: () => void
  created?: (kind: SimpleKind, id: ID) => void
  period?: Period | null
}) {
  const { mutate } = useWorkspace()
  const suggestion = suggestedPeriod(s, orgID)
  const lastDay = period ? new Date(new Date(period.endsAt).getTime() - 86400000) : suggestion.end
  const [name, setName] = useState(period?.name ?? ''),
    [groups, setGroups] = useState<ID[]>([]),
    [first, setFirst] = useState(dateValue(period ? new Date(period.startsAt) : suggestion.start)),
    [last, setLast] = useState(dateValue(lastDay))
  const { error, saving, run } = useSubmit()
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
      created?.(kind, period?.id ?? newID)
    })
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
        placeholder={placeholder[kind]}
        aria-label={placeholder[kind]}
        autoComplete={kind === 'member' ? 'name' : 'off'}
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setName(e.target.value)}
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
                aria-pressed={groups.includes(g.id)}
                onClick={() =>
                  setGroups(groups.includes(g.id) ? groups.filter((x) => x !== g.id) : [...groups, g.id])
                }
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
            <input type="date" required value={first} onChange={(e) => setFirst(e.target.value)} />
          </Field>
          <Field label={tr('Último día')}>
            <input type="date" required value={last} onChange={(e) => setLast(e.target.value)} />
          </Field>
        </div>
      )}
      <Footer
        saving={saving}
        error={error}
        onCancel={close}
        disabled={!name.trim()}
        label={kind === 'member' ? tr('Añadir') : period ? tr('Guardar') : tr('Crear')}
      />
    </form>
  )
}
