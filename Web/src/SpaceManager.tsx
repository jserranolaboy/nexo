import { t as tr } from './i18n'
import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Cloud, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { ID, Organization } from './domain'
import { Dialog } from './ui'
import { useWorkspace } from './workspace'
import { DrivePanel } from './DrivePanel'

export function SpaceManager({
  close,
  open,
  create,
  changed,
  initialTrash = false,
}: {
  close: () => void
  open: (id: ID) => void
  create: () => void
  changed: (id: ID, deleted: boolean) => void
  initialTrash?: boolean
}) {
  const w = useWorkspace()
  const [trash, setTrash] = useState(initialTrash)
  const [driveID, setDriveID] = useState<ID | null>(null)
  const [confirmID, setConfirmID] = useState<ID | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const lock = useRef(false)
  const organizations = w.snapshot.organizations
  const removed = organizations.filter((o) => o.deletedAt)
  const rows = trash ? removed : organizations.filter((o) => !o.deletedAt)
  const selected = organizations.find((o) => o.id === confirmID)
  const link = (id: ID) =>
    w.demo ? undefined : w.drive.spaces.find((space) => space.organizationID === id)
  const counts = (id: ID) => {
    const people = w.snapshot.members.filter((m) => m.organizationID === id).length
    const events = w.snapshot.events.filter((e) => e.organizationID === id).length
    return `${people} ${people === 1 ? tr('persona') : tr('personas')} · ${events} ${events === 1 ? tr('encuentro') : tr('encuentros')}`
  }
  const change = async (org: Organization, deleted: boolean) => {
    if (lock.current || w.busy || w.driveBusy) return
    lock.current = true
    setSaving(true)
    setError('')
    try {
      await w.mutate({
        kind: 'setOrganizationDeleted',
        organizationID: org.id,
        deleted,
        expectedDeleted: !!org.deletedAt,
        expectedName: org.name,
      })
      setConfirmID(null)
      changed(org.id, deleted)
      w.notify(
        deleted ? tr('Espacio en Papelera') : tr('Espacio restaurado'),
        false,
        deleted
          ? () => {
              void w
                .mutate(
                  {
                    kind: 'setOrganizationDeleted',
                    organizationID: org.id,
                    deleted: false,
                    expectedDeleted: true,
                    expectedName: org.name,
                  },
                  tr('Espacio restaurado'),
                )
                .catch(() => {})
            }
          : undefined,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      lock.current = false
      setSaving(false)
    }
  }
  const disabled = saving || w.busy || w.driveBusy
  return (
    <Dialog
      title={
        driveID
          ? organizations.find((o) => o.id === driveID)?.name || 'Drive'
          : selected
            ? tr('Eliminar espacio')
            : trash
              ? tr('Papelera')
              : tr('Espacios')
      }
      className="spaces-dialog"
      focusInput={false}
      onClose={() => {
        if (!lock.current) close()
      }}
    >
      {driveID ? (
        <>
          <button className="text-button spaces-back" onClick={() => setDriveID(null)}>
            <ArrowLeft size={15} />
            {trash ? tr('Papelera') : tr('Espacios')}
          </button>
          <DrivePanel orgID={driveID} />
        </>
      ) : selected ? (
        <div className="space-confirm">
          <div className="space-removal-icon" aria-hidden="true">
            <Trash2 size={25} />
          </div>
          <h3>{selected.name}</h3>
          <p className="space-counts">{counts(selected.id)}</p>
          <p>{tr('El espacio y sus registros se moverán a Papelera. Podrás restaurarlos.')}</p>
          {link(selected.id) && (
            <p className="space-shared-warning">
              <Cloud size={17} />
              <span>
                {tr(
                  'Este cambio también se aplicará a quienes comparten el espacio al sincronizar.',
                )}
              </span>
            </p>
          )}
          <div className="space-confirm-actions">
            <button
              className="button"
              disabled={disabled}
              onClick={() => {
                setConfirmID(null)
                setError('')
              }}
            >
              {tr('Cancelar')}
            </button>
            <button
              className="button danger-fill"
              disabled={disabled || !!selected.deletedAt || link(selected.id)?.canEdit === false}
              onClick={() => void change(selected, true)}
            >
              {saving ? tr('Eliminando…') : tr('Mover a Papelera')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {trash && (
            <button
              className="text-button spaces-back"
              onClick={() => {
                setTrash(false)
                setError('')
              }}
            >
              <ArrowLeft size={15} />
              {tr('Espacios')}
            </button>
          )}
          <div className="managed-spaces">
            {rows.map((org) => (
              <div className="managed-space" key={org.id}>
                <span className="space-monogram" aria-hidden="true">
                  {org.name.trim().slice(0, 2).toLocaleUpperCase()}
                </span>
                {trash ? (
                  <div className="managed-space-name">
                    <strong>{org.name}</strong>
                    <small>{counts(org.id)}</small>
                  </div>
                ) : (
                  <button
                    className="managed-space-name"
                    aria-label={tr('Abrir {0}', org.name)}
                    disabled={disabled}
                    onClick={() => {
                      open(org.id)
                      close()
                    }}
                  >
                    <strong>{org.name}</strong>
                    <small>{counts(org.id)}</small>
                  </button>
                )}
                {link(org.id) && (
                  <button
                    className="icon-button"
                    aria-label={tr('Drive de {0}', org.name)}
                    onClick={() => setDriveID(org.id)}
                  >
                    <Cloud size={17} />
                  </button>
                )}
                {trash ? (
                  <button
                    className="button compact"
                    aria-label={tr('Restaurar {0}', org.name)}
                    disabled={disabled || link(org.id)?.canEdit === false}
                    onClick={() => void change(org, false)}
                  >
                    <RotateCcw size={16} />
                    <span>{tr('Restaurar')}</span>
                  </button>
                ) : (
                  <>
                    <button
                      className="icon-button space-delete"
                      aria-label={tr('Eliminar {0}', org.name)}
                      title={
                        link(org.id)?.canEdit === false
                          ? tr('Solo lectura')
                          : tr('Eliminar espacio')
                      }
                      disabled={disabled || link(org.id)?.canEdit === false}
                      onClick={() => {
                        setConfirmID(org.id)
                        setError('')
                      }}
                    >
                      <Trash2 size={17} />
                    </button>
                  </>
                )}
              </div>
            ))}
            {!rows.length && (
              <p className="spaces-empty">{trash ? tr('Papelera vacía') : tr('Sin espacios')}</p>
            )}
          </div>
          <div className="space-manager-actions">
            {!trash && (
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => {
                  close()
                  create()
                }}
              >
                <Plus size={17} />
                {tr('Crear espacio')}
              </button>
            )}
            {!trash && !!removed.length && (
              <button
                className="text-button"
                onClick={() => {
                  setTrash(true)
                  setError('')
                }}
              >
                <Trash2 size={16} />
                {tr('Papelera')} <span>{removed.length}</span>
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
