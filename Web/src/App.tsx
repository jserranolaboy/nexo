import { t as tr, locale } from './i18n'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  FileText,
  Layers3,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Upload,
  Users,
  X,
} from 'lucide-react'
import { newTemplate } from './domain'
import type { ID, Template } from './domain'
import { native, nativeAvailable, useWorkspace } from './workspace'
import { Avatar, Mark } from './ui'
import { FirstOpening } from './Start'
import { SpaceManager } from './SpaceManager'
import { AppearanceControl } from './appearance'
import { persistTemplateDraft } from './drafts'
import { DrivePanel } from './DrivePanel'
import { driveLabel } from './drive'
import { StudioGallery } from './StudioGallery'
import { Agenda, firstRelevantEvent } from './Calendar'
import { EventView } from './EventView'
import { PeopleList, PersonPanel } from './PeopleView'
import { EventForm, SimpleForm } from './forms'
import type { EventDraft, SimpleKind } from './forms'
import { ComponentsSheet, GroupsSheet } from './Manage'
import { Menu, MenuDivider, MenuItem, Sheet, spring, useLayout } from './kit'
import { searchKey } from './attendanceModel'
import { selectionFeedback } from './platform'
const DocumentStudio = lazy(() => import('./Studio').then((m) => ({ default: m.DocumentStudio })))

type Area = 'events' | 'people' | 'documents'
const areas = [
  { id: 'events', name: tr('Encuentros'), Icon: CalendarDays },
  { id: 'people', name: tr('Personas'), Icon: Users },
  { id: 'documents', name: tr('Documentos'), Icon: FileText },
] as const

export function App() {
  const w = useWorkspace(),
    s = w.snapshot
  const layout = useLayout()
  const reduce = useReducedMotion()
  const [area, setArea] = useState<Area>('events'),
    [orgID, setOrgID] = useState<ID>(''),
    [periodID, setPeriodID] = useState<ID>(''),
    [eventID, setEventID] = useState<ID | null>(null),
    [memberID, setMemberID] = useState<ID | null>(null),
    [componentFilter, setComponentFilter] = useState<ID>(''),
    [epoch, setEpoch] = useState(0)
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null),
    [simple, setSimple] = useState<SimpleKind | null>(null),
    [editPeriod, setEditPeriod] = useState(false),
    [components, setComponents] = useState<{ focus: ID | null } | null>(null),
    [groupsOpen, setGroupsOpen] = useState(false),
    [search, setSearch] = useState(false),
    [settings, setSettings] = useState(false),
    [spaces, setSpaces] = useState<'active' | 'trash' | null>(null),
    [chooseDocument, setChooseDocument] = useState<ID | null>(null),
    [editor, setEditor] = useState<{ template: Template; eventID?: ID; baseTemplate?: Template | null } | null>(null)
  const active = s.organizations.filter((o) => !o.deletedAt)
  const organization = active.find((o) => o.id === (orgID || w.initialOrganizationID)) || active[0]
  const currentOrg = organization?.id || ''
  const periods = s.periods
    .filter((p) => p.organizationID === currentOrg)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const now = new Date()
  const period =
    periods.find((p) => p.id === periodID) ||
    periods.find((p) => new Date(p.startsAt) <= now && new Date(p.endsAt) > now) ||
    periods.at(-1)
  const event = s.events.find((e) => e.id === eventID && e.organizationID === currentOrg && (!componentFilter || e.componentID === componentFilter))
  const member = s.members.find((m) => m.id === memberID && m.organizationID === currentOrg)

  // Resolve the saved draft before any real editor can mount and overwrite its file.
  const recoveryComplete = useRef(false)
  const recoverySnapshot = useRef(s)
  recoverySnapshot.current = s
  const [draftRecovery, setDraftRecovery] = useState<'pending' | 'ready' | 'failed'>('pending'),
    [draftRecoveryError, setDraftRecoveryError] = useState(''),
    [draftRecoveryAttempt, setDraftRecoveryAttempt] = useState(0),
    [draftOrganizationID, setDraftOrganizationID] = useState<ID | null>(null),
    [restoringDraftSpace, setRestoringDraftSpace] = useState(false)
  const restoringSpace = useRef(false)
  const recoveryBlocked = nativeAvailable && !w.demo && draftRecovery !== 'ready'
  useEffect(() => {
    if (!nativeAvailable || w.loading || w.demo || w.fault || recoveryComplete.current) return
    let active = true
    setDraftRecovery('pending')
    setDraftRecoveryError('')
    setDraftOrganizationID(null)
    void native<{ template?: Template; organizationID?: ID; eventID?: ID; baseTemplate?: Template | null }>('recoverDraft')
      .then((draft) => {
        if (!active) return
        if (draft.template) {
          if (typeof draft.template.id !== 'string' || !draft.template.id ||
              !draft.organizationID || draft.template.organizationID !== draft.organizationID)
            throw new Error(tr('El borrador no es válido.'))
          const organization = recoverySnapshot.current.organizations.find((o) => o.id === draft.organizationID)
          if (!organization || organization.deletedAt) {
            setDraftOrganizationID(draft.organizationID)
            throw new Error(tr('El espacio del borrador no está disponible.'))
          }
          setOrgID(draft.organizationID)
          setEditor({ template: draft.template, eventID: draft.eventID, baseTemplate: draft.baseTemplate })
          w.notify(tr('Borrador recuperado'))
        } else if (Object.keys(draft).length) {
          throw new Error(tr('El borrador no es válido.'))
        }
        recoveryComplete.current = true
        setDraftRecovery('ready')
      })
      .catch((error) => {
        if (!active) return
        setDraftRecoveryError(error instanceof Error ? error.message : String(error))
        setDraftRecovery('failed')
      })
    return () => { active = false }
  }, [w.loading, w.demo, w.fault, w.notify, draftRecoveryAttempt])
  // A space moved to the trash closes everything that belonged to it.
  useEffect(() => {
    if (!s.organizations.some((o) => o.id === (orgID || w.initialOrganizationID) && o.deletedAt)) return
    setOrgID(s.organizations.find((o) => !o.deletedAt)?.id || '')
    resetSelection()
    setEditor(null)
  }, [s.organizations, orgID, w.initialOrganizationID])
  useEffect(() => {
    if (nativeAvailable && !w.demo && orgID) void native('activeOrganization', { id: orgID }).catch(() => {})
  }, [orgID, w.demo])
  useEffect(() => {
    const open = (e: Event) => {
      enterSpace((e as CustomEvent<string>).detail)
      setSettings(false)
    }
    window.addEventListener('nexo-open-space', open)
    return () => window.removeEventListener('nexo-open-space', open)
  }, [])
  // On wide screens an event is always in view: pick the relevant one when none is chosen.
  useEffect(() => {
    if (area !== 'events' || !currentOrg) return
    if (eventID && !event) setEventID(null)
    if (layout === 'phone' || event) return
    const list = s.events
      .filter((e) => e.organizationID === currentOrg && (!period || (new Date(e.startsAt) >= new Date(period.startsAt) && new Date(e.startsAt) < new Date(period.endsAt))) && (!componentFilter || e.componentID === componentFilter))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    const next = firstRelevantEvent(list)
    if (next) setEventID(next.id)
  }, [layout, area, event, eventID, currentOrg, period?.id, componentFilter, s.events, epoch])

  const resetSelection = () => {
    setEpoch((n) => n + 1)
    setEventID(null)
    setMemberID(null)
    setComponentFilter('')
  }
  const enterSpace = (id: ID) => {
    setOrgID(id)
    setPeriodID('')
    resetSelection()
    setArea('events')
  }
  const go = (next: Area) => {
    if (next === area && layout === 'phone') {
      setEventID(null)
      setMemberID(null)
    }
    setArea(next)
    selectionFeedback()
  }
  const openEvent = (id: ID) => {
    setArea('events')
    setComponentFilter('')
    setEventID(id)
    setSearch(false)
  }
  const openMember = (id: ID) => {
    setArea('people')
    setMemberID(id)
    setSearch(false)
  }
  const create = () => {
    if (area === 'people') setSimple('member')
    else if (area === 'documents') setEditor({ template: newTemplate(currentOrg) })
    else setEventDraft({ mode: 'new' })
  }
  // Keyboard: ⌘K search, ⌘N new, ⌘1–3 areas.
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (w.loading || recoveryBlocked || editor || !(e.metaKey || e.ctrlKey)) return
      if (document.querySelector('.nx-sheet-layer')) return
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        setSearch(true)
      } else if (k === 'n' && organization) {
        e.preventDefault()
        create()
      } else if (['1', '2', '3'].includes(k) && organization) {
        e.preventDefault()
        setArea(areas[Number(k) - 1].id)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  })
  const restore = async () => {
    try {
      const r = await native<{ restored?: boolean }>('restoreWorkspace')
      if (r.restored) {
        await w.reload()
        if (!recoveryComplete.current) setDraftRecoveryAttempt((attempt) => attempt + 1)
        setSettings(false)
        resetSelection()
        w.notify(tr('Copia recuperada'))
      }
    } catch (e) {
      w.notify(e instanceof Error ? e.message : String(e), true)
    }
  }
  const saveCopy = async () => {
    try {
      const r = await native<{ saved?: boolean }>('exportWorkspace')
      if (r.saved) w.notify(tr('Copia guardada'))
    } catch (e) {
      w.notify(e instanceof Error ? e.message : String(e), true)
    }
  }
  const draftSpace = s.organizations.find((organization) => organization.id === draftOrganizationID)
  const restoreDraftSpace = async () => {
    if (!draftSpace?.deletedAt || restoringSpace.current || w.busy || w.driveBusy) return
    restoringSpace.current = true
    setRestoringDraftSpace(true)
    try {
      await w.mutate({
        kind: 'setOrganizationDeleted', organizationID: draftSpace.id, deleted: false,
        expectedDeleted: true, expectedName: draftSpace.name,
      })
      setDraftRecoveryAttempt((attempt) => attempt + 1)
    } catch (error) {
      setDraftRecoveryError(error instanceof Error ? error.message : String(error))
    } finally {
      restoringSpace.current = false
      setRestoringDraftSpace(false)
    }
  }
  const startDemo = () => void w.startDemo().then(() => enterSpace(''))
  const status = w.demo
    ? tr('Ejemplo')
    : w.busy
      ? tr('Guardando')
      : nativeAvailable
        ? driveLabel(w.drive, w.drive.spaces.find((x) => x.organizationID === currentOrg), w.driveBusy)
        : tr('Vista previa')
  const conflicts = !w.demo && !!w.drive.spaces.find((x) => x.organizationID === currentOrg)?.conflicts.length

  if (w.loading)
    return (
      <div className="nx-boot" role="status" aria-label={tr('Abriendo Nexo')}>
        <Mark size={44} />
      </div>
    )
  if (w.fault && !w.demo)
    return (
      <main className="nx-recovery">
        <ShieldCheck size={40} />
        <h1>{tr('Recuperar datos')}</h1>
        <p>{w.fault}</p>
        <button className="nx-button primary" onClick={() => void restore()}>
          <Upload size={17} />
          {tr('Importar copia')}
        </button>
        <Toast />
      </main>
    )
  if (recoveryBlocked) {
    if (draftRecovery === 'pending')
      return (
        <div className="nx-boot" role="status" aria-label={tr('Abriendo borrador')}>
          <Mark size={44} />
        </div>
      )
    return (
      <main className="nx-recovery">
        <ShieldCheck size={40} />
        <h1>{tr('Recuperar borrador')}</h1>
        <p role="alert">{draftRecoveryError || tr('No se pudo abrir el borrador local.')}</p>
        <p>{tr('El borrador se conserva sin cambios. Puedes volver a intentar abrirlo.')}</p>
        {draftOrganizationID && <p>{tr('Restaura su espacio desde Papelera o importa una copia que lo incluya antes de reintentar.')}</p>}
        {draftSpace?.deletedAt && (
          <button
            className="nx-button primary"
            disabled={restoringDraftSpace || w.busy || w.driveBusy || w.drive.spaces.find((space) => space.organizationID === draftSpace.id)?.canEdit === false}
            onClick={() => void restoreDraftSpace()}
          >
            {tr('Restaurar {0}', draftSpace.name)}
          </button>
        )}
        {draftOrganizationID && (
          <button className="nx-button" disabled={restoringDraftSpace || w.busy || w.driveBusy} onClick={() => void restore()}>
            {tr('Importar copia')}
          </button>
        )}
        <button className="nx-button" disabled={restoringDraftSpace} onClick={() => setDraftRecoveryAttempt((attempt) => attempt + 1)}>
          {tr('Reintentar')}
        </button>
        <Toast />
      </main>
    )
  }
  if (!organization)
    return (
      <>
        <FirstOpening
          native={nativeAvailable}
          create={() => setSimple('organization')}
          demo={startDemo}
          trash={s.organizations.some((o) => o.deletedAt) ? () => setSpaces('trash') : undefined}
          restore={() => void restore()}
          connect={() => setSettings(true)}
        />
        <SimpleForm s={s} orgID="" kind={simple} close={() => setSimple(null)} created={(_, id) => enterSpace(id)} />
        {spaces && <SpaceManager initialTrash={spaces === 'trash'} close={() => setSpaces(null)} create={() => setSimple('organization')} open={enterSpace} changed={() => {}} />}
        {settings && <SettingsSheet open={settings} close={() => setSettings(false)} orgID="" saveCopy={saveCopy} restore={restore} startDemo={startDemo} />}
        <Toast />
      </>
    )
  if (editor)
    return (
      <>
        <Suspense fallback={<div className="nx-boot" role="status" aria-label={tr('Abriendo plantilla')}><span className="spinner" /></div>}>
          <DocumentStudio
            key={editor.template.id}
            s={s}
            orgID={currentOrg}
            initial={editor.template}
            eventID={editor.eventID}
            recoveredBase={editor.baseTemplate}
            back={() => {
              const close = () => setEditor(null)
              if (nativeAvailable && !w.demo)
                void persistTemplateDraft({ dirty: false }).then(close).catch(() => w.notify(tr('No se pudo cerrar el borrador.'), true))
              else close()
            }}
          />
        </Suspense>
        <Toast />
      </>
    )

  const wide = layout !== 'phone'
  const detailOpen = layout === 'phone' && ((area === 'events' && !!event) || (area === 'people' && !!member))
  const title = areas.find((a) => a.id === area)!.name
  const demoChip = w.demo && (
    <button className="nx-demo" onClick={() => void w.leaveDemo().then(() => enterSpace(''))}>
      {tr('Ejemplo')} <X size={12} />
    </button>
  )
  const spaceButton = <SpaceSwitcher key={organization.id} current={organization} enter={enterSpace} manage={() => setSpaces('active')} create={() => setSimple('organization')} />
  const periodButton = (
    <PeriodSwitcher
      periods={periods}
      current={period}
      choose={(id) => {
        setPeriodID(id)
        setEventID(null)
      }}
      create={() => {
        setEditPeriod(false)
        setSimple('period')
      }}
      edit={() => {
        setEditPeriod(true)
        setSimple('period')
      }}
    />
  )
  return (
    <div className={`nx-app layout-${layout} ${w.demo ? 'is-demo' : ''} ${detailOpen ? 'has-push' : ''}`}>
      {layout === 'wide' && (
        <aside className="nx-sidebar" aria-label={tr('Navegación')}>
          {spaceButton}
          <nav className="nx-nav">
            {areas.map(({ id, name, Icon }) => (
              <button key={id} className="nx-nav-item" aria-current={area === id ? 'page' : undefined} onClick={() => go(id)}>
                <Icon size={18} strokeWidth={1.8} />
                <span>{name}</span>
              </button>
            ))}
          </nav>
          <div className="nx-sidebar-section">
            <span className="nx-sidebar-label">{tr('Período')}</span>
            {periodButton}
          </div>
          <span className="nx-spacer" />
          <button className="nx-nav-item" onClick={() => setSearch(true)}>
            <Search size={18} strokeWidth={1.8} />
            <span>{tr('Buscar')}</span>
            <kbd>⌘K</kbd>
          </button>
          <button className={`nx-nav-item nx-status ${conflicts ? 'alert' : ''}`} onClick={() => setSettings(true)}>
            <i className={`nx-status-dot ${w.busy || w.driveBusy ? 'busy' : ''}`} />
            <span>{conflicts ? tr('Versiones por revisar') : status}</span>
            <Settings2 size={16} />
          </button>
        </aside>
      )}
      <div className="nx-main">
        {layout !== 'wide' && (
        <header className="nx-topbar">
          {spaceButton}
          <span className="nx-spacer" />
          {demoChip}
          {(
            <>
              <button className="nx-icon" aria-label={tr('Buscar')} onClick={() => setSearch(true)}>
                <Search size={19} />
              </button>
              <button className={`nx-icon nx-status-icon ${conflicts ? 'alert' : ''}`} aria-label={`${tr('Ajustes')} · ${status}`} onClick={() => setSettings(true)}>
                <Settings2 size={19} />
                <i className={`nx-status-dot ${w.busy || w.driveBusy ? 'busy' : ''}`} />
              </button>
            </>
          )}
        </header>
        )}
        {conflicts && (
          <button className="nx-banner" onClick={() => setSettings(true)}>
            {tr('Hay versiones de este espacio por revisar')}
          </button>
        )}
        <div className="nx-scene-head">
          <h1>{title}</h1>
          {layout !== 'wide' && area !== 'documents' && periodButton}
          <span className="nx-spacer" />
          {layout === 'wide' && demoChip}
          <button className="nx-add" aria-label={area === 'people' ? tr('Nueva persona') : area === 'documents' ? tr('Nueva plantilla') : tr('Nuevo encuentro')} onClick={create}>
            <Plus size={20} strokeWidth={2.2} />
            {wide && <span>{area === 'people' ? tr('Persona') : area === 'documents' ? tr('Plantilla') : tr('Encuentro')}</span>}
          </button>
        </div>
        <main className={`nx-scene area-${area}`}>
          {area === 'events' && (
            <div className={`nx-split ${wide ? 'two' : ''}`}>
              <Agenda
                s={s}
                orgID={currentOrg}
                period={period}
                layout={layout}
                selectedID={event?.id ?? null}
                select={setEventID}
                create={() => setEventDraft({ mode: 'new' })}
                manageComponent={(id) => setComponents({ focus: id })}
                componentFilter={componentFilter}
                setComponentFilter={setComponentFilter}
              />
              {wide && (
                <div className="nx-detail">
                  <AnimatePresence mode="wait">
                    {event ? (
                      <motion.div key={event.id} className="nx-detail-scroll" initial={reduce ? false : { y: 8 }} animate={{ y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                        <EventView s={s} event={event} period={period} edit={setEventDraft} document={() => setChooseDocument(event.id)} openMember={openMember} />
                      </motion.div>
                    ) : s.events.some((e) => e.organizationID === currentOrg) ? (
                      <div className="nx-empty center" key="none">
                        <h3>{tr('Elige un encuentro')}</h3>
                      </div>
                    ) : null}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
          {area === 'people' && (
            <div className={`nx-split ${layout === 'wide' && member ? 'two people' : ''}`}>
              <PeopleList s={s} orgID={currentOrg} period={period} layout={layout} selectedID={member?.id ?? null} select={setMemberID} openEvent={openEvent} manageGroups={() => setGroupsOpen(true)} />
              {layout === 'wide' && member && (
                <div className="nx-detail">
                  <div className="nx-detail-scroll">
                    <button className="nx-icon nx-detail-close" aria-label={tr('Cerrar')} onClick={() => setMemberID(null)}>
                      <X size={18} />
                    </button>
                    <PersonPanel key={member.id} s={s} member={member} period={period} openEvent={openEvent} />
                  </div>
                </div>
              )}
            </div>
          )}
          {area === 'documents' && <StudioGallery s={s} orgID={currentOrg} open={(template) => setEditor({ template })} />}
        </main>
      </div>
      {/* Phone: the selected item slides over the list and swipes back. */}
      <AnimatePresence>
        {detailOpen && (
          <motion.div
            key={area}
            className="nx-push"
            initial={reduce ? false : { x: '100%' }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: '100%' }}
            transition={spring}
            drag={reduce ? false : 'x'}
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.9 }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 110 || info.velocity.x > 700) {
                setEventID(null)
                setMemberID(null)
              }
            }}
          >
            {area === 'events' && event && (
              <EventView s={s} event={event} period={period} back={() => setEventID(null)} edit={setEventDraft} document={() => setChooseDocument(event.id)} openMember={openMember} />
            )}
            {area === 'people' && member && <PersonPanel key={member.id} s={s} member={member} period={period} openEvent={openEvent} back={() => setMemberID(null)} />}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Tablet: the person opens as a sheet over the list. */}
      {layout === 'tablet' && (
        <Sheet open={area === 'people' && !!member} onClose={() => setMemberID(null)} label={member?.name || ''} size="large">
          {member && <PersonPanel key={member.id} s={s} member={member} period={period} openEvent={openEvent} />}
        </Sheet>
      )}
      {layout !== 'wide' && !detailOpen && (
        <nav className="nx-tabbar" aria-label={tr('Áreas')}>
          {areas.map(({ id, name, Icon }) => (
            <button key={id} aria-current={area === id ? 'page' : undefined} onClick={() => go(id)}>
              <Icon size={22} strokeWidth={area === id ? 2.1 : 1.7} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
      )}

      <EventForm s={s} orgID={currentOrg} draft={eventDraft} close={() => setEventDraft(null)} saved={(id) => openEvent(id)} />
      <SimpleForm
        s={s}
        orgID={currentOrg}
        kind={simple}
        period={simple === 'period' && editPeriod ? period : null}
        close={() => setSimple(null)}
        created={(kind, id) => {
          if (kind === 'organization') enterSpace(id)
          if (kind === 'member') openMember(id)
          if (kind === 'period') setPeriodID(id)
        }}
      />
      <ComponentsSheet s={s} orgID={currentOrg} open={!!components} focus={components?.focus} close={() => setComponents(null)} />
      <GroupsSheet s={s} orgID={currentOrg} open={groupsOpen} close={() => setGroupsOpen(false)} />
      <SearchSheet open={search} close={() => setSearch(false)} orgID={currentOrg} openEvent={openEvent} openMember={openMember} openTemplate={(t) => (setSearch(false), setEditor({ template: t }))} />
      <Sheet open={!!chooseDocument} onClose={() => setChooseDocument(null)} title={tr('Documento')}>
        <div className="nx-group">
          {s.templates
            .filter((t) => t.organizationID === currentOrg)
            .map((t) => (
              <button key={t.id} className="nx-group-row link" onClick={() => (setEditor({ template: t, eventID: chooseDocument! }), setChooseDocument(null))}>
                <FileText size={17} />
                <span className="nx-grow">{t.name}</span>
              </button>
            ))}
          <button className="nx-group-row link" onClick={() => (setEditor({ template: newTemplate(currentOrg), eventID: chooseDocument! }), setChooseDocument(null))}>
            <Plus size={17} />
            <span className="nx-grow">{tr('Hoja en blanco')}</span>
          </button>
        </div>
      </Sheet>
      {spaces && (
        <SpaceManager
          initialTrash={spaces === 'trash'}
          close={() => setSpaces(null)}
          create={() => setSimple('organization')}
          open={enterSpace}
          changed={(id, deleted) => {
            if (deleted && id === currentOrg) enterSpace('')
          }}
        />
      )}
      <SettingsSheet open={settings} close={() => setSettings(false)} orgID={currentOrg} saveCopy={saveCopy} restore={restore} startDemo={startDemo} manageComponents={() => (setSettings(false), setComponents({ focus: null }))} manageGroups={() => (setSettings(false), setGroupsOpen(true))} manageSpaces={() => (setSettings(false), setSpaces('active'))} />
      <Toast />
    </div>
  )
}

function SpaceSwitcher({
  current,
  enter,
  manage,
  create,
}: {
  current: { id: ID; name: string }
  enter: (id: ID) => void
  manage: () => void
  create: () => void
}) {
  const { snapshot: s, mutate } = useWorkspace()
  const [open, setOpen] = useState(false),
    [renaming, setRenaming] = useState(false),
    [name, setName] = useState(current.name),
    [saving, setSaving] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null),
    renamingActive = useRef(false),
    submitting = useRef(false)
  const cancelRename = () => {
    if (submitting.current) return
    renamingActive.current = false
    setRenaming(false)
  }
  const rename = async () => {
    if (!renamingActive.current || submitting.current) return
    submitting.current = true
    setSaving(true)
    try {
      await mutate({ kind: 'rename', entity: 'organization', id: current.id, name }, tr('Nombre actualizado'))
      renamingActive.current = false
      setRenaming(false)
    } catch {
      input.current?.focus()
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }
  if (renaming)
    return (
      <form
        className="nx-space-rename"
        aria-busy={saving}
        onSubmit={(e) => {
          e.preventDefault()
          void rename()
        }}
      >
        <input
          ref={input} autoFocus value={name} readOnly={saving} maxLength={200}
          aria-label={tr('Nombre del espacio')}
          onChange={(e) => setName(e.target.value)}
          onBlur={cancelRename}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              cancelRename()
            }
          }}
        />
      </form>
    )
  return (
    <>
      <button ref={anchor} className="nx-space" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="nx-space-mark" aria-hidden="true">
          <Mark size={16} />
        </span>
        <span className="nx-space-name">{current.name}</span>
        <ChevronDown size={14} />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} anchor={anchor} label={tr('Espacios')}>
        {s.organizations
          .filter((o) => !o.deletedAt)
          .map((o) => (
            <MenuItem key={o.id} checked={o.id === current.id} onClick={() => (setOpen(false), enter(o.id))}>
              {o.name}
            </MenuItem>
          ))}
        <MenuDivider />
        <MenuItem icon={<Pencil size={16} />} onClick={() => {
          renamingActive.current = true
          setOpen(false)
          setName(current.name)
          setRenaming(true)
        }}>
          {tr('Renombrar')}
        </MenuItem>
        <MenuItem icon={<Plus size={16} />} onClick={() => (setOpen(false), create())}>
          {tr('Nuevo espacio')}
        </MenuItem>
        <MenuItem icon={<Layers3 size={16} />} onClick={() => (setOpen(false), manage())}>
          {tr('Espacios y papelera')}
        </MenuItem>
      </Menu>
    </>
  )
}

function PeriodSwitcher({
  periods,
  current,
  choose,
  create,
  edit,
}: {
  periods: { id: ID; name: string; startsAt: string; endsAt: string }[]
  current?: { id: ID; name: string }
  choose: (id: ID) => void
  create: () => void
  edit: () => void
}) {
  const [open, setOpen] = useState(false),
    anchor = useRef<HTMLButtonElement>(null)
  const range = (p: { startsAt: string; endsAt: string }) =>
    `${new Date(p.startsAt).toLocaleDateString(locale, { month: 'short', year: '2-digit' })} – ${new Date(new Date(p.endsAt).getTime() - 86400000).toLocaleDateString(locale, { month: 'short', year: '2-digit' })}`
  return (
    <>
      <button ref={anchor} className="nx-period" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{current?.name || tr('Todo el tiempo')}</span>
        <ChevronDown size={14} />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} anchor={anchor} label={tr('Período')}>
        {[...periods].reverse().map((p) => (
          <MenuItem key={p.id} checked={p.id === current?.id} detail={range(p)} onClick={() => (setOpen(false), choose(p.id))}>
            {p.name}
          </MenuItem>
        ))}
        {!!periods.length && <MenuDivider />}
        {current && (
          <MenuItem icon={<Pencil size={16} />} onClick={() => (setOpen(false), edit())}>
            {tr('Editar período')}
          </MenuItem>
        )}
        <MenuItem icon={<Plus size={16} />} onClick={() => (setOpen(false), create())}>
          {tr('Nuevo período')}
        </MenuItem>
      </Menu>
    </>
  )
}

function SearchSheet({
  open,
  close,
  orgID,
  openEvent,
  openMember,
  openTemplate,
}: {
  open: boolean
  close: () => void
  orgID: ID
  openEvent: (id: ID) => void
  openMember: (id: ID) => void
  openTemplate: (t: Template) => void
}) {
  const { snapshot: s } = useWorkspace()
  const [query, setQuery] = useState('')
  useEffect(() => setQuery(''), [open])
  const key = searchKey(query)
  const results = useMemo(() => {
    if (!key) return { events: [], people: [], templates: [] }
    return {
      events: s.events.filter((e) => e.organizationID === orgID && searchKey(e.title).includes(key)).sort((a, b) => b.startsAt.localeCompare(a.startsAt)).slice(0, 6),
      people: s.members.filter((m) => m.organizationID === orgID && searchKey(m.name).includes(key)).slice(0, 8),
      templates: s.templates.filter((t) => t.organizationID === orgID && searchKey(t.name).includes(key)).slice(0, 4),
    }
  }, [key, s, orgID])
  const none = key && !results.events.length && !results.people.length && !results.templates.length
  return (
    <Sheet open={open} onClose={close} label={tr('Buscar')} size="large">
      <div className="nx-search-sheet">
        <label className="nx-search big">
          <Search size={18} aria-hidden="true" />
          <input
            data-autofocus
            type="search"
            value={query}
            placeholder={tr('Personas, encuentros, plantillas')}
            aria-label={tr('Buscar')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const first = results.people[0] || results.events[0]
              if (results.people[0]) openMember(results.people[0].id)
              else if (results.events[0]) openEvent(results.events[0].id)
              if (first) close()
            }}
          />
        </label>
        {none && <p className="nx-quiet">{tr('Sin resultados para «{0}»', query)}</p>}
        {!!results.people.length && (
          <div className="nx-section">
            <h3>{tr('Personas')}</h3>
            <div className="nx-list">
              {results.people.map((m) => (
                <button key={m.id} className="nx-list-row link" onClick={() => (openMember(m.id), close())}>
                  <Avatar name={m.name} index={s.members.indexOf(m)} size={30} />
                  <span className="nx-grow">{m.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {!!results.events.length && (
          <div className="nx-section">
            <h3>{tr('Encuentros')}</h3>
            <div className="nx-list">
              {results.events.map((e) => (
                <button key={e.id} className="nx-list-row link" onClick={() => (openEvent(e.id), close())}>
                  <CalendarDays size={17} />
                  <span className="nx-grow">
                    <strong>{e.title}</strong>
                    <small>{new Date(e.startsAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {!!results.templates.length && (
          <div className="nx-section">
            <h3>{tr('Plantillas')}</h3>
            <div className="nx-list">
              {results.templates.map((t) => (
                <button key={t.id} className="nx-list-row link" onClick={() => openTemplate(t)}>
                  <FileText size={17} />
                  <span className="nx-grow">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}

function SettingsSheet({
  open,
  close,
  orgID,
  saveCopy,
  restore,
  startDemo,
  manageComponents,
  manageGroups,
  manageSpaces,
}: {
  open: boolean
  close: () => void
  orgID: ID
  saveCopy: () => Promise<void>
  restore: () => Promise<void>
  startDemo: () => void
  manageComponents?: () => void
  manageGroups?: () => void
  manageSpaces?: () => void
}) {
  const w = useWorkspace()
  return (
    <Sheet open={open} onClose={close} title={tr('Ajustes')} size="large">
      <div className="nx-settings">
        <AppearanceControl />
        {orgID && (
          <div className="nx-group">
            {manageComponents && (
              <button className="nx-group-row link" onClick={manageComponents}>
                <span className="nx-grow">{tr('Componentes y categorías')}</span>
              </button>
            )}
            {manageGroups && (
              <button className="nx-group-row link" onClick={manageGroups}>
                <span className="nx-grow">{tr('Grupos')}</span>
              </button>
            )}
            {manageSpaces && (
              <button className="nx-group-row link" onClick={manageSpaces}>
                <span className="nx-grow">{tr('Espacios y papelera')}</span>
              </button>
            )}
          </div>
        )}
        {w.demo || !nativeAvailable ? (
          <div className="nx-group">
            <button className="nx-group-row link" onClick={() => (startDemo(), close())}>
              <span className="nx-grow">{tr('Reiniciar el ejemplo')}</span>
            </button>
            {w.demo && (
              <button className="nx-group-row link" onClick={() => void w.leaveDemo().then(close)}>
                <span className="nx-grow">{tr('Salir del ejemplo')}</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="nx-group">
              <button className="nx-group-row link" onClick={() => void saveCopy()}>
                <Download size={17} />
                <span className="nx-grow">{tr('Exportar datos')}</span>
              </button>
              <button className="nx-group-row link" onClick={() => void restore()}>
                <Upload size={17} />
                <span className="nx-grow">{tr('Importar copia')}</span>
              </button>
            </div>
            <DrivePanel orgID={orgID} />
          </>
        )}
      </div>
    </Sheet>
  )
}

function Toast() {
  const w = useWorkspace()
  return (
    <div className="nx-toast-region" aria-live="polite">
      <AnimatePresence>
        {w.toast && (
          <motion.div
            className={`nx-toast ${w.toast.error ? 'error' : ''}`}
            key={w.toast.message + (w.toast.error ? '!' : '')}
            role={w.toast.error ? 'alert' : 'status'}
            initial={{ y: 16, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10 }}
            transition={spring}
          >
            {w.toast.error ? <X size={15} /> : <Check size={15} />}
            <span>{w.toast.message}</span>
            {w.toast.undo && (
              <button onClick={w.toast.undo}>{tr('Deshacer')}</button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
