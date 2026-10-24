import { t as tr, locale } from './i18n'
import { useState } from 'react'
import {
  ArrowUpRight,
  Cloud,
  FolderOpen,
  LogOut,
  RefreshCw,
  Upload,
  Link2,
  ChevronDown,
  Check,
  Eye,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
} from 'lucide-react'
import { native, useWorkspace } from './workspace'
import type { ID } from './domain'
import { driveLabel } from './drive'
export function DrivePanel({ orgID }: { orgID: ID }) {
  const w = useWorkspace(),
    state = w.drive,
    space = state.spaces.find((s) => s.organizationID === orgID)
  const [available, setAvailable] = useState<{ id: string; name: string }[] | null>(null)
  const [loading, setLoading] = useState(false),
    [folderURL, setFolderURL] = useState(''),
    [details, setDetails] = useState(false)
  const busy = w.driveBusy || loading
  const error = space?.error || state.error
  const run = (command: string, values = {}) => void w.runDrive(command, values).catch(() => {})
  const findSpaces = async () => {
    setLoading(true)
    try {
      setAvailable(await native('driveSpaces'))
    } catch (e) {
      w.notify(String(e), true)
    } finally {
      setLoading(false)
    }
  }
  const join = (folderID: string) => {
    void w
      .runDrive('driveJoin', { folderID })
      .then(() => {
        setAvailable(null)
        setFolderURL('')
      })
      .catch(() => {})
  }
  const keyLabels: Record<string, string> = {
    attendance: tr('Asistencia'),
    volunteers: tr('Voluntariado'),
    memberships: tr('Grupos'),
    member: tr('Persona'),
    event: tr('Encuentro'),
    template: tr('Plantilla'),
    organization: tr('Espacio'),
    period: tr('Período'),
    category: tr('Categoría'),
    component: tr('Componente'),
    group: tr('Grupo'),
  }
  return (
    <section className="drive-panel">
      <div className="drive-heading">
        <Cloud size={21} />
        <strong>Google Drive</strong>
        {space && <span className="drive-pill">{driveLabel(state, space, w.driveBusy)}</span>}
      </div>
      {error && (
        <p className="drive-error" role="alert">
          {error}
        </p>
      )}
      {!state.connected ? (
        <>
          <p className="drive-description">
            {state.requiresKeychainAccess
              ? tr('macOS necesita permiso para recuperar tu conexión guardada.')
              : tr('Sin conectar')}
          </p>
          <div className="drive-buttons">
            <button
              className="button primary"
              disabled={busy || !state.configured}
              onClick={() => run('driveConnect')}
            >
              <Cloud size={16} />
              {w.driveBusy
                ? tr('Conectando…')
                : state.requiresKeychainAccess
                  ? tr('Autorizar llavero')
                  : tr('Conectar Google')}
            </button>
            {!state.configured && (
              <button
                className="button"
                disabled={busy}
                onClick={() => run('driveImportConfiguration')}
              >
                <Upload size={16} />
                {tr('Importar configuración')}
              </button>
            )}
          </div>
          {!state.configured && (
            <button
              className="text-button drive-another"
              disabled={busy}
              onClick={() => run('driveEnterConfiguration')}
            >
              {tr('Introducir datos de Google')}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="drive-account">
            <span>{state.account || tr('Cuenta conectada')}</span>
            <button
              className="icon-button"
              title={tr('Desconectar cuenta')}
              aria-label={tr('Desconectar cuenta')}
              disabled={busy}
              onClick={() => run('driveDisconnect')}
            >
              <LogOut size={15} />
            </button>
          </div>
          {state.error && (
            <button className="button compact" disabled={busy} onClick={() => run('driveConnect')}>
              {tr('Volver a conectar')}
            </button>
          )}
          {space ? (
            <>
              {space.lastSyncAt && (
                <p className="drive-description">
                  {tr('Actualizado')}{' '}
                  {new Date(space.lastSyncAt).toLocaleString(locale, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {!space.canEdit && ' ' + tr('· Solo lectura') + ''}
                </p>
              )}
              <div className="drive-buttons">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    run(space.paused ? 'driveResume' : 'driveSync', { organizationID: orgID })
                  }
                >
                  {space.paused ? (
                    <Play size={16} />
                  ) : (
                    <RefreshCw size={16} className={w.driveBusy ? 'spin' : ''} />
                  )}{' '}
                  {space.paused ? tr('Reanudar') : tr('Sincronizar')}
                </button>
                {!space.paused && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => run('drivePause', { organizationID: orgID })}
                  >
                    <Pause size={16} />
                    {tr('Pausar')}
                  </button>
                )}
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => run('driveOpenFolder', { organizationID: orgID })}
                >
                  <FolderOpen size={16} />
                  {tr('Abrir carpeta')}
                  <ArrowUpRight size={14} />
                </button>
              </div>
              {space.pending > 0 && (
                <p className="drive-description">
                  {space.pending}{' '}
                  {space.pending === 1 ? tr('cambio pendiente') : tr('cambios pendientes')}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="drive-buttons">
                {orgID && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => run('driveCreate', { organizationID: orgID })}
                  >
                    <Cloud size={16} />
                    {tr('Subir espacio')}
                  </button>
                )}
                <button className="button" disabled={busy} onClick={() => void findSpaces()}>
                  <FolderOpen size={16} />
                  {tr('Abrir espacio')}
                </button>
              </div>
              {orgID && (
                <p className="drive-description">
                  {tr('Incluye personas, asistencias y plantillas.')}
                </p>
              )}
            </>
          )}
          {space && (
            <button
              className="text-button drive-another"
              disabled={busy}
              onClick={() => void findSpaces()}
            >
              {tr('Otro espacio')}
            </button>
          )}
          {available && (
            <div className="drive-spaces">
              {available
                .filter((folder) => !state.spaces.some((s) => s.folderID === folder.id))
                .map((folder) => (
                  <button
                    className="drive-folder"
                    key={folder.id}
                    disabled={busy}
                    onClick={() => join(folder.id)}
                  >
                    <FolderOpen size={17} />
                    <span>{folder.name.replace(/^Nexo · /, '')}</span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              {!available.filter((folder) => !state.spaces.some((s) => s.folderID === folder.id))
                .length && <p className="drive-description">{tr('Sin otros espacios')}</p>}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const match = folderURL.match(/\/folders\/([\w-]+)/)
                  const value = match?.[1] || folderURL.trim()
                  if (/^[\w-]+$/.test(value)) join(value)
                  else w.notify(tr('Pega el enlace de una carpeta de Nexo.'), true)
                }}
              >
                <label htmlFor="drive-folder-link">{tr('Enlace de una carpeta compartida')}</label>
                <div>
                  <input
                    id="drive-folder-link"
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="go"
                    value={folderURL}
                    onChange={(e) => setFolderURL(e.target.value)}
                    placeholder="https://drive.google.com/drive/folders/…"
                  />
                  <button className="button" disabled={busy || !folderURL.trim()}>
                    <Link2 size={15} />
                    {tr('Abrir')}
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
      {!!space?.conflicts.length && (
        <div className="drive-conflicts">
          <h3>{tr('Versiones por revisar')}</h3>
          <p>{tr('Elige la versión que se usará. Ambas se conservan en el historial de Drive.')}</p>
          {space.conflicts.map((conflict) => (
            <div className="drive-conflict" key={conflict.key}>
              <h4>{keyLabels[conflict.key.split(':')[0]] || tr('Registro')}</h4>
              <div className="drive-versions">
                {conflict.versions.map((version) => (
                  <article key={version.id}>
                    <strong>{version.device}</strong>
                    <time>{new Date(version.date).toLocaleString(locale)}</time>
                    <p>{version.summary}</p>
                    {conflict.key.startsWith('template:') && (
                      <VersionPreview
                        orgID={orgID}
                        recordKey={conflict.key}
                        versionID={version.id}
                      />
                    )}
                    <button
                      className="button compact"
                      disabled={busy || !space.canEdit}
                      onClick={() =>
                        run('driveResolve', {
                          organizationID: orgID,
                          key: conflict.key,
                          versionID: version.id,
                        })
                      }
                    >
                      <Check size={15} />
                      {tr('Usar esta versión')}
                    </button>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <button className="text-button drive-details-toggle" onClick={() => setDetails(!details)}>
        {tr('Conexión y copias')}
        <ChevronDown size={14} />
      </button>
      {details && (
        <div className="drive-details">
          <p>
            {tr(
              'Nexo conserva copias locales y envía cada cambio a Drive. Sin conexión, los cambios esperan en este dispositivo. Las copias exportadas se guardan por separado.',
            )}
          </p>
          <p>
            {tr(
              'Esta conexión solicita acceso a Drive para abrir carpetas compartidas entre cuentas. Puedes revocar el acceso desde tu cuenta de Google.',
            )}
          </p>
          {state.configured && (
            <button className="text-button" disabled={busy} onClick={() => run('driveConnect')}>
              {tr('Cambiar cuenta')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function VersionPreview({
  orgID,
  recordKey,
  versionID,
}: {
  orgID: ID
  recordKey: string
  versionID: ID
}) {
  const { notify } = useWorkspace()
  const [preview, setPreview] = useState<{
    token: string
    pageCount: number
    image: string
  } | null>(null)
  const [page, setPage] = useState(0),
    [busy, setBusy] = useState(false)
  const show = async (index = 0) => {
    setBusy(true)
    try {
      if (!preview)
        setPreview(
          await native('drivePreviewTemplate', {
            organizationID: orgID,
            key: recordKey,
            versionID,
          }),
        )
      else {
        const result = await native<{ image: string }>('pdfPage', { token: preview.token, index })
        setPreview({ ...preview, image: result.image })
      }
      setPage(index)
    } catch (e) {
      setPreview(null)
      notify(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="version-preview">
      {!preview ? (
        <button className="button compact" disabled={busy} onClick={() => void show()}>
          <Eye size={15} />
          {busy ? tr('Preparando…') : tr('Ver plantilla')}
        </button>
      ) : (
        <>
          <img src={preview.image} alt={tr('Plantilla, página {0}', page + 1)} />
          {preview.pageCount > 1 && (
            <div className="drive-buttons">
              <button
                className="icon-button"
                aria-label={tr('Página anterior')}
                disabled={busy || page === 0}
                onClick={() => void show(page - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {page + 1} / {preview.pageCount}
              </span>
              <button
                className="icon-button"
                aria-label={tr('Página siguiente')}
                disabled={busy || page === preview.pageCount - 1}
                onClick={() => void show(page + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
