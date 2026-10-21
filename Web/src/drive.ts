import { t as tr } from './i18n'
import { deviceName } from './platform'
import type { ID } from './domain'
export interface DriveStatus {
  configured: boolean
  connected: boolean
  requiresKeychainAccess?: boolean
  account: string
  error: string
  spaces: DriveSpace[]
}
export interface DriveSpace {
  organizationID: ID
  folderID: string
  pending: number
  canEdit: boolean
  paused?: boolean
  error?: string
  lastSyncAt?: string
  conflicts: {
    key: string
    versions: { id: ID; device: string; date: string; summary: string }[]
  }[]
}
export const emptyDrive: DriveStatus = {
  configured: false,
  connected: false,
  account: '',
  error: '',
  spaces: [],
}
export function driveLabel(state: DriveStatus, space: DriveSpace | undefined, busy: boolean) {
  if (busy) return tr('Sincronizando')
  if (!space) return tr('En este {0}', deviceName)
  if (space.paused) return tr('Drive en pausa')
  if (space.error) return tr('Revisar Drive')
  if (space.conflicts.length) return tr('{0} por revisar', space.conflicts.length)
  if (state.error) return tr('Revisar Drive')
  if (!state.connected) return tr('Drive desconectado')
  if (space.pending) return tr('{0} por enviar', space.pending)
  return space.lastSyncAt ? tr('En Drive') : tr('Por sincronizar')
}
