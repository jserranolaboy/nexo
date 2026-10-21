import { t as tr, locale } from './i18n'
import { useMemo, useState } from 'react'
import { ArrowLeft, Archive, ArrowUpRight, Check, Search } from 'lucide-react'
import type { Activity, ID, Member, Period, Snapshot, Status } from './domain'
import { attendanceIndex, attendanceResult, currentGroups, emptyAttendanceResult, inPeriod, statusLabels } from './domain'
import { searchKey } from './attendanceModel'
import { useWorkspace } from './workspace'
import { Avatar } from './ui'
import { Chips, Choice, InlineText, Segmented } from './kit'
import type { Layout } from './kit'
import { selectionFeedback } from './platform'

type Sort = 'name' | 'low' | 'high'

export function PeopleList({
  s,
  orgID,
  period,
  layout,
  selectedID,
  select,
  openEvent,
  manageGroups,
}: {
  s: Snapshot
  orgID: ID
  period?: Period
  layout: Layout
  selectedID: ID | null
  select: (id: ID) => void
  openEvent: (id: ID) => void
  manageGroups: () => void
}) {
  const [query, setQuery] = useState(''),
    [group, setGroup] = useState(''),
    [component, setComponent] = useState(''),
    [sort, setSort] = useState<Sort>('name'),
    [view, setView] = useState<'list' | 'table'>('list'),
    [archived, setArchived] = useState(false),
    [limit, setLimit] = useState(100)
  const groups = s.groups.filter((g) => g.organizationID === orgID)
  const components = s.components.filter((c) => c.organizationID === orgID)
  const results = useMemo(() => attendanceIndex(s, period, component || undefined), [s, period, component])
  const key = searchKey(query)
  const all = s.members.filter((m) => m.organizationID === orgID)
  const members = all
    .filter(
      (m) =>
        m.isActive !== archived &&
        (!key || searchKey(m.name).includes(key)) &&
        (!group || s.memberships.some((g) => g.memberID === m.id && g.groupID === group && !g.endsAt)),
    )
    .sort((a, b) => {
      if (sort !== 'name') {
        const pa = results.get(a.id)?.percentage ?? (sort === 'low' ? 101 : -1),
          pb = results.get(b.id)?.percentage ?? (sort === 'low' ? 101 : -1)
        if (pa !== pb) return sort === 'low' ? pa - pb : pb - pa
      }
      return a.name.localeCompare(b.name, locale, { sensitivity: 'base' })
    })
  const archivedCount = all.filter((m) => !m.isActive).length
  const recentEvents = useMemo(
    () =>
      s.events
        .filter((e) => e.organizationID === orgID && !e.isCancelled && inPeriod(e.startsAt, period) && (!component || e.componentID === component))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [s.events, orgID, period, component],
  )
  const cells = useMemo(
    () => new Map(s.attendance.filter((a) => !a.isVoided).map((a) => [`${a.eventID}:${a.memberID}`, a])),
    [s.attendance],
  )
  return (
    <section className="nx-people" aria-label={tr('Personas')}>
      <div className="nx-people-tools">
        <label className="nx-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={tr('Buscar')}
            aria-label={tr('Buscar personas')}
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(100)
            }}
          />
        </label>
        <Choice
          label={tr('Orden')}
          value={sort}
          onChange={setSort}
          options={[
            { value: 'name', label: tr('Nombre') },
            { value: 'low', label: tr('Menor asistencia') },
            { value: 'high', label: tr('Mayor asistencia') },
          ]}
        />
        {components.length > 0 && (
          <Choice
            label={tr('Asistencia en')}
            value={component || 'all'}
            onChange={(v) => setComponent(v === 'all' ? '' : v)}
            options={[{ value: 'all', label: tr('Todo') }, ...components.map((c) => ({ value: c.id, label: c.name }))]}
          />
        )}
        {layout !== 'phone' && (
          <Segmented
            label={tr('Vista')}
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: tr('Lista') },
              { value: 'table', label: tr('Tabla') },
            ]}
          />
        )}
      </div>
      <Chips
        label={tr('Grupo')}
        value={group}
        onChange={(v) => setGroup(v === group ? '' : v)}
        onLongPress={() => manageGroups()}
        items={[
          { value: '', label: tr('Todas'), count: all.filter((m) => m.isActive).length },
          ...groups.map((g) => ({
            value: g.id,
            label: g.name,
            count: all.filter((m) => m.isActive && s.memberships.some((x) => x.memberID === m.id && x.groupID === g.id && !x.endsAt)).length,
          })),
        ]}
        trailing={
          <button className="nx-chip ghost" onClick={manageGroups}>
            {groups.length ? tr('Editar') : tr('Crear grupo')}
          </button>
        }
      />
      {archived && (
        <button className="nx-back inline" onClick={() => setArchived(false)}>
          <ArrowLeft size={17} />
          {tr('Archivadas')}
        </button>
      )}
      {!all.length ? (
        <div className="nx-empty">
          <h3>{tr('Sin personas')}</h3>
          <p>{tr('Añade a los miembros con el botón +.')}</p>
        </div>
      ) : !members.length ? (
        <div className="nx-empty small">
          <p>{tr('Sin coincidencias')}</p>
        </div>
      ) : view === 'table' && layout !== 'phone' ? (
        <div className="nx-table-wrap">
          <table className="nx-table">
            <thead>
              <tr>
                <th className="sticky">{tr('Persona')}</th>
                <th className="pct">%</th>
                {recentEvents.map((e) => (
                  <th key={e.id}>
                    <button title={e.title} onClick={() => openEvent(e.id)}>
                      <b>{new Date(e.startsAt).getDate()}</b>
                      <small>{new Date(e.startsAt).toLocaleDateString(locale, { month: 'short' })}</small>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.slice(0, limit).map((m) => {
                const r = results.get(m.id) ?? emptyAttendanceResult()
                return (
                  <tr key={m.id} className={selectedID === m.id ? 'selected' : ''}>
                    <th className="sticky">
                      <button onClick={() => select(m.id)}>{m.name}</button>
                    </th>
                    <td className="pct">{r.percentage == null ? '—' : `${r.percentage}%`}</td>
                    {recentEvents.map((e) => {
                      const a = cells.get(`${e.id}:${m.id}`)
                      return (
                        <td key={e.id}>
                          <i
                            className={`nx-cell ${a ? a.status : 'none'} ${a && !(a.countsAttendanceSnapshot ?? e.countsAttendance) ? 'muted' : ''}`}
                            title={`${e.title}: ${a ? statusLabels[a.status] : tr('No está en la lista')}`}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="nx-people-list" role="list">
          {members.slice(0, limit).map((m) => {
            const r = results.get(m.id) ?? emptyAttendanceResult()
            const recent = r.rows
              .slice()
              .sort((a, b) => (a.eventDateSnapshot || '').localeCompare(b.eventDateSnapshot || ''))
              .slice(-8)
            return (
              <button
                role="listitem"
                key={m.id}
                className={`nx-person-row ${selectedID === m.id ? 'selected' : ''}`}
                aria-current={selectedID === m.id ? 'true' : undefined}
                onClick={() => select(m.id)}
              >
                <Avatar name={m.name} index={s.members.indexOf(m)} size={38} />
                <span className="nx-person-main">
                  <strong>{m.name}</strong>
                  <small>{currentGroups(s, m.id).map((g) => g.name).join(' · ') || (m.isActive ? '' : tr('Archivada'))}</small>
                </span>
                <span className="nx-trail" aria-hidden="true">
                  {recent.map((a) => (
                    <i key={a.id} className={a.status} />
                  ))}
                </span>
                <span className={`nx-pct ${r.percentage == null ? 'none' : r.percentage < 60 ? 'low' : ''}`}>
                  {r.percentage == null ? '—' : `${r.percentage}%`}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {members.length > limit && (
        <button className="nx-button quiet wide" onClick={() => setLimit(limit + 100)}>
          {tr('Mostrar {0} más', members.length - limit)}
        </button>
      )}
      {!archived && archivedCount > 0 && (
        <button className="nx-link subtle" onClick={() => setArchived(true)}>
          <Archive size={15} />
          {tr('Archivadas ({0})', archivedCount)}
        </button>
      )}
    </section>
  )
}

export function PersonPanel({
  s,
  member,
  period,
  openEvent,
  back,
}: {
  s: Snapshot
  member: Member
  period?: Period
  openEvent: (id: ID) => void
  back?: () => void
}) {
  const { mutate } = useWorkspace()
  const orgID = member.organizationID
  const groups = s.groups.filter((g) => g.organizationID === orgID)
  const mine = currentGroups(s, member.id).map((g) => g.id)
  const result = attendanceResult(s, member.id, period)
  const components = s.components.filter((c) => c.organizationID === orgID)
  const byComponent = components
    .map((c) => ({ c, r: attendanceResult(s, member.id, period, c.id) }))
    .filter((x) => x.r.rows.length)
  const history = result.rows
    .slice()
    .sort((a, b) => (b.eventDateSnapshot || '').localeCompare(a.eventDateSnapshot || ''))
  const eventOf = (eventID: ID) => s.events.find((e) => e.id === eventID) as Activity
  const toggleGroup = (groupID: ID) => {
    const next = mine.includes(groupID) ? mine.filter((x) => x !== groupID) : [...mine, groupID]
    selectionFeedback()
    void mutate({ kind: 'memberGroups', memberID: member.id, groupIDs: next, expectedGroupIDs: mine }, tr('Grupos actualizados')).catch(() => {})
  }
  return (
    <article className="nx-person" aria-label={member.name}>
      {back && (
        <button className="nx-back" onClick={back}>
          <ArrowLeft size={19} />
          <span>{tr('Personas')}</span>
        </button>
      )}
      <header className="nx-person-head">
        <Avatar name={member.name} index={s.members.indexOf(member)} size={64} />
        <InlineText
          as="h1"
          value={member.name}
          label={tr('Nombre')}
          onSave={(name) => mutate({ kind: 'updateMember', memberID: member.id, name, expectedName: member.name }, tr('Nombre actualizado'))}
        />
        {!member.isActive && <span className="nx-tag">{tr('Archivada')}</span>}
      </header>
      {!!groups.length && (
        <div className="nx-chips wrap" aria-label={tr('Grupos de {0}', member.name)}>
          {groups.map((g) => (
            <button key={g.id} className="nx-chip" aria-pressed={mine.includes(g.id)} onClick={() => toggleGroup(g.id)}>
              {mine.includes(g.id) && <Check size={14} />}
              {g.name}
            </button>
          ))}
        </div>
      )}
      <section className="nx-score">
        <div className="nx-score-main">
          <b>{result.percentage ?? '—'}</b>
          {result.percentage != null && <span>%</span>}
        </div>
        <p>
          {result.total
            ? tr('{0} de {1} encuentros', result.present, result.total)
            : tr('Sin encuentros evaluables')}
          {period && ` · ${period.name}`}
        </p>
        <div className="nx-score-counts">
          {(['present', 'absent', 'excused', 'pending'] as Status[]).map((st) =>
            result[st] ? (
              <span key={st} className={st}>
                <i />
                {result[st]} {statusLabels[st].toLocaleLowerCase(locale)}
              </span>
            ) : null,
          )}
        </div>
        {byComponent.length > 1 && (
          <div className="nx-breakdown">
            {byComponent.map(({ c, r }) => (
              <div key={c.id}>
                <span>{c.name}</span>
                <span className="nx-breakdown-bar">
                  <i style={{ width: `${r.percentage ?? 0}%` }} />
                </span>
                <b>{r.percentage == null ? '—' : `${r.percentage}%`}</b>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="nx-section">
        <h3>{tr('Encuentros')}</h3>
        {history.length ? (
          <div className="nx-list">
            {history.map((a) => {
              const e = eventOf(a.eventID)
              return (
                <button key={a.id} className="nx-list-row link" onClick={() => openEvent(a.eventID)}>
                  <i className={`nx-dot ${a.status}`} />
                  <span className="nx-grow">
                    <strong>{e?.title}</strong>
                    <small>
                      {new Date(a.eventDateSnapshot || e?.startsAt || '').toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ·{' '}
                      {statusLabels[a.status]}
                      {a.note && ` · ${a.note}`}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              )
            })}
          </div>
        ) : (
          <p className="nx-quiet">{tr('Aparecerá aquí cuando esté en la lista de un encuentro.')}</p>
        )}
      </section>
      <button
        className="nx-link subtle"
        onClick={() =>
          void mutate(
            { kind: 'updateMember', memberID: member.id, isActive: !member.isActive },
            member.isActive ? tr('{0} archivada · conserva su historial', member.name) : tr('{0} reactivada', member.name),
          ).catch(() => {})
        }
      >
        <Archive size={15} />
        {member.isActive ? tr('Archivar') : tr('Reactivar')}
      </button>
    </article>
  )
}
