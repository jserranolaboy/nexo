import { chooseAlternative, createSpace, linkCollaboration, recordAlternative } from './commands.ts'
import { DomainError } from './errors.ts'
import { emptyWorkspace, type Workspace } from './model.ts'
import { canonicalId } from './ids.ts'
import { commit, FileWorkspaceStore } from './store.ts'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const COLLABORATION = {
  spaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  spaceName: 'Espacio sintético',
  timeZone: 'Etc/UTC',
  key: 'encounter:1',
  localId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  remoteId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  localValue: 'alternativa-local',
  remoteValue: 'alternativa-remota',
  portError: 'sync port unavailable',
} as const

export interface SyncPort {
  publish(): void
}

/** A port that fails after the local file is already saved. It has no account, folder, or network. */
export function unavailableSyncPort(): SyncPort {
  return {
    publish() {
      throw new Error(COLLABORATION.portError)
    },
  }
}

/**
 * Saves a conflict, rejects an older writer, and restores with sync paused.
 * The sync port is called only after the local save.
 */
export function runCollaborationJourney(directory: string, port: SyncPort = unavailableSyncPort()): string {
  const store = new FileWorkspaceStore(directory)
  let workspace = store.initialize(emptyWorkspace())
  workspace = createSpace(workspace, {
    id: COLLABORATION.spaceId,
    name: COLLABORATION.spaceName,
    timeZone: COLLABORATION.timeZone,
  })
  workspace = linkCollaboration(workspace, COLLABORATION.spaceId)
  workspace = recordAlternative(workspace, {
    spaceId: COLLABORATION.spaceId,
    key: COLLABORATION.key,
    version: { id: COLLABORATION.localId, value: COLLABORATION.localValue },
  })
  const first = commit(store, workspace, 0, () => port.publish())
  if (first.collaborationError !== COLLABORATION.portError) throw new DomainError('sync-port-silent')
  if (!kept(store.load(), [COLLABORATION.localValue])) throw new DomainError('local-save-lost')
  workspace = recordAlternative(first.workspace, {
    spaceId: COLLABORATION.spaceId,
    key: COLLABORATION.key,
    version: { id: COLLABORATION.remoteId, value: COLLABORATION.remoteValue },
  })
  const conflict = commit(store, workspace, first.workspace.revision, () => port.publish())
  if (conflict.collaborationError !== COLLABORATION.portError) throw new DomainError('sync-port-silent')
  const both = [COLLABORATION.localValue, COLLABORATION.remoteValue]
  if (!kept(store.load(), both)) throw new DomainError('local-save-lost')
  try {
    store.save(first.workspace, first.workspace.revision)
    throw new DomainError('stale-write-applied')
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== 'stale-revision') throw error
  }
  if (!kept(store.load(), both)) throw new DomainError('alternatives-overwritten')
  const pendingBefore = store.load().collaboration[0].pendingUploads.length
  const copy = path.join(directory, 'synthetic-copy.json')
  writeFileSync(copy, readFileSync(store.primaryPath()))
  const restored = store.restore(copy)
  const link = restored.collaboration[0]
  if (!link.paused || link.pendingUploads.length !== pendingBefore) throw new DomainError('upload-enqueued')
  if (!kept(restored, both)) throw new DomainError('alternatives-overwritten')
  return first.collaborationError
}

/**
 * Keeps one alternative in the active file. While sync is paused, the upload queue stays as it was.
 * There is no sync port, account, or folder.
 */
export function resolvePausedAlternative(directory: string, versionId: string): string {
  const store = new FileWorkspaceStore(directory)
  const current = store.load()
  const chosenId = canonicalId(versionId)
  const link = current.collaboration.find((item) =>
    item.entries.some((entry) => entry.versions.some((version) => canonicalId(version.id) === chosenId)),
  )
  if (!link) throw new DomainError('missing-alternative')
  if (!link.paused) throw new DomainError('sync-not-paused')
  const entry = link.entries.find((item) => item.versions.some((version) => canonicalId(version.id) === chosenId))
  if (!entry) throw new DomainError('missing-alternative')
  const next = chooseAlternative(current, { spaceId: link.spaceId, key: entry.key, versionId: chosenId })
  const drafted = next.collaboration.find((item) => item.spaceId === link.spaceId)
  const versions = drafted?.entries.find((item) => item.key === entry.key)?.versions ?? []
  const chosen = versions[0]
  const sameQueue =
    drafted !== undefined &&
    drafted.pendingUploads.length === link.pendingUploads.length &&
    drafted.pendingUploads.every((item, index) => item === link.pendingUploads[index])
  if (!chosen || versions.length !== 1 || chosen.id !== chosenId || !sameQueue) throw new DomainError('upload-enqueued')
  const saved = store.save(next, current.revision)
  if (saved.revision !== current.revision + 1) throw new DomainError('revision-stalled')
  return chosen.value
}

export function describeCollaboration(directory: string, lang: 'es' | 'en'): string {
  const workspace = new FileWorkspaceStore(directory).load()
  const space = workspace.spaces[0]
  const link = workspace.collaboration[0]
  const paused = link?.paused === true
  const pending = link?.pendingUploads ?? []
  const versions = link?.entries.flatMap((entry) => entry.versions.map((version) => `${entry.key}: ${version.value}`)) ?? []
  if (lang === 'en') {
    return [
      `${space.name} [${space.timeZone}]`,
      `Sync: ${paused ? 'paused' : 'active'}`,
      `Pending uploads: ${pending.length === 0 ? 'none' : pending.join(', ')}`,
      `Alternatives: ${versions.join(' | ')}`,
    ].join('\n')
  }
  return [
    `${space.name} [${space.timeZone}]`,
    `Sincronización: ${paused ? 'en pausa' : 'activa'}`,
    `Subidas pendientes: ${pending.length === 0 ? 'ninguna' : pending.join(', ')}`,
    `Alternativas: ${versions.join(' | ')}`,
  ].join('\n')
}

function kept(workspace: Workspace, values: string[]): boolean {
  const found = workspace.collaboration[0]?.entries[0]?.versions.map((version) => version.value) ?? []
  return values.every((value) => found.includes(value)) && workspace.spaces.length === 1
}
