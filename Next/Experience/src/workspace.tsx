import { t as tr } from './i18n'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { emptySnapshot, simulateAction } from './domain'
import type { Action, Snapshot } from './domain'
import { makeDemo } from './demo'
import { emptyDrive } from './drive'
import type { DriveStatus } from './drive'

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: { valentina?: { postMessage: (value: unknown) => Promise<unknown> } }
    }
  }
}
export const nativeAvailable = !!window.webkit?.messageHandlers?.valentina
export async function native<T = unknown>(
  command: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const handler = window.webkit?.messageHandlers?.valentina
  if (!handler) throw new Error(tr('Esta función está disponible en Nexo instalado.'))
  try {
    return (await handler.postMessage({ command, ...payload })) as T
  } catch (error) {
    throw new Error(tr(error instanceof Error ? error.message : String(error)))
  }
}
interface WorkspaceContext {
  snapshot: Snapshot
  initialOrganizationID: string
  drive: DriveStatus
  driveBusy: boolean
  runDrive: (command: string, values?: Record<string, unknown>) => Promise<void>
  demo: boolean
  loading: boolean
  fault: string
  busy: boolean
  toast: { message: string; error?: boolean; undo?: () => void } | null
  notify: (message: string, error?: boolean, undo?: () => void) => void
  mutate: (action: Action, message?: string) => Promise<Snapshot>
  startDemo: () => Promise<void>
  leaveDemo: () => Promise<void>
  reload: () => Promise<void>
}
const Context = createContext<WorkspaceContext | null>(null)
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [initialOrganizationID, setInitialOrganizationID] = useState('')
  const [snapshot, setSnapshot] = useState(emptySnapshot),
    [demo, setDemo] = useState(false)
  const [loading, setLoading] = useState(true),
    [fault, setFault] = useState(''),
    [busy, setBusy] = useState(false)
  const [drive, setDrive] = useState<DriveStatus>(emptyDrive),
    [driveBusy, setDriveBusy] = useState(false)
  const driveRef = useRef(drive),
    syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    autoSync = useRef<() => void>(() => {})
  const [toast, setToast] = useState<WorkspaceContext['toast']>(null)
  const latest = useRef(snapshot),
    isDemo = useRef(demo),
    queue = useRef(Promise.resolve()),
    switching = useRef(false)
  const notify = useCallback(
    (message: string, error = false, undo?: () => void) => setToast({ message, error, undo }),
    [],
  )
  const apply = (s: Snapshot) => {
    latest.current = s
    setSnapshot(s)
  }
  const reload = useCallback(async () => {
    try {
      if (nativeAvailable) {
        const result = await native<{
          snapshot: Snapshot
          drive: DriveStatus
          activeOrganizationID?: string
        }>('load')
        apply(result.snapshot)
        setInitialOrganizationID(result.activeOrganizationID || '')
        driveRef.current = result.drive
        setDrive(result.drive)
      }
      setFault('')
    } catch (e) {
      setFault(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.undo ? 8500 : 5000)
    return () => clearTimeout(timer)
  }, [toast])
  const mutate = (action: Action, message?: string): Promise<Snapshot> => {
    if (switching.current)
      return Promise.reject(new Error(tr('Espera a que el espacio termine de abrirse.')))
    const job = queue.current.then(async () => {
      setBusy(true)
      try {
        const next = isDemo.current
          ? simulateAction(latest.current, action)
          : await native<Snapshot>('mutate', { action, expectedRevision: latest.current.revision })
        apply(next)
        if (!isDemo.current) {
          try {
            const state = await native<DriveStatus>('driveStatus')
            driveRef.current = state
            setDrive(state)
          } catch (error) {
            // The edit is committed; a status read cannot turn it into a failed edit.
            const state = {
              ...driveRef.current,
              error: error instanceof Error ? error.message : String(error),
            }
            driveRef.current = state
            setDrive(state)
          }
          clearTimeout(syncTimer.current)
          syncTimer.current = setTimeout(() => autoSync.current(), 2000)
        }
        if (message) notify(message)
        return next
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        notify(error.message, true)
        throw error
      } finally {
        setBusy(false)
      }
    })
    queue.current = job.then(
      () => {},
      () => {},
    )
    return job
  }
  const runDrive = useCallback(
    (command: string, values: Record<string, unknown> = {}): Promise<void> => {
      if (switching.current || isDemo.current) return Promise.resolve()
      const job = queue.current.then(async () => {
        setDriveBusy(true)
        try {
          const result = await native<{
            snapshot: Snapshot
            drive: DriveStatus
            openedOrganizationID?: string
          }>(command, { ...values, expectedRevision: latest.current.revision })
          apply(result.snapshot)
          driveRef.current = result.drive
          setDrive(result.drive)
          if (result.openedOrganizationID)
            window.dispatchEvent(
              new CustomEvent('nexo-open-space', { detail: result.openedOrganizationID }),
            )
          if (command !== 'driveSync' && result.drive.error) notify(result.drive.error, true)
          if (command === 'driveConnect' || command === 'driveResolve') {
            clearTimeout(syncTimer.current)
            syncTimer.current = setTimeout(() => autoSync.current(), 500)
          }
        } catch (e) {
          notify(e instanceof Error ? e.message : String(e), true)
          throw e
        } finally {
          setDriveBusy(false)
        }
      })
      queue.current = job.catch(() => {})
      return job
    },
    [notify],
  )
  autoSync.current = () => {
    const editing =
      document.querySelector(
        '.document-studio, .inline-name, .person-groups-editor, dialog[open]',
      ) || document.activeElement?.matches('input, textarea, select')
    if (
      !editing &&
      !isDemo.current &&
      !switching.current &&
      driveRef.current.connected &&
      driveRef.current.spaces.some((space) => !space.paused)
    )
      void runDrive('driveSync').catch(() => {})
  }
  useEffect(() => {
    const resume = () => {
      if (!document.hidden) autoSync.current()
    }
    const restoreSession = () => {
      if (!nativeAvailable || isDemo.current) return
      void native<DriveStatus>('driveStatus')
        .then((state) => {
          if (isDemo.current) return
          driveRef.current = state
          setDrive(state)
          autoSync.current()
        })
        .catch(() => {})
    }
    const timer = setInterval(resume, 30000)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('nexo-session-restored', restoreSession)
    return () => {
      clearInterval(timer)
      clearTimeout(syncTimer.current)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('nexo-session-restored', restoreSession)
    }
  }, [])
  const startDemo = async () => {
    if (switching.current) return
    switching.current = true
    setLoading(true)
    await queue.current
    isDemo.current = true
    setDemo(true)
    apply(makeDemo())
    setFault('')
    setToast(null)
    setLoading(false)
    switching.current = false
    notify(tr('Espacio de ejemplo'))
  }
  const leaveDemo = async () => {
    if (switching.current) return
    switching.current = true
    setLoading(true)
    await queue.current
    isDemo.current = false
    setDemo(false)
    setToast(null)
    apply(emptySnapshot())
    await reload()
    switching.current = false
  }
  return (
    <Context.Provider
      value={{
        snapshot,
        initialOrganizationID,
        drive,
        driveBusy,
        runDrive,
        demo,
        loading,
        fault,
        busy,
        toast,
        notify,
        mutate,
        startDemo,
        leaveDemo,
        reload,
      }}
    >
      {children}
    </Context.Provider>
  )
}
export function useWorkspace() {
  const ctx = useContext(Context)
  if (!ctx) throw new Error('No workspace')
  return ctx
}
