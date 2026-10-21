import Foundation
import VRRCore

@MainActor
public final class DriveCoordinator {
    private let store: SnapshotStore
    private let transport: any DriveTransport
    public private(set) var syncing = false
    public private(set) var checkedAt: [UUID: Date] = [:]
    public private(set) var errors: [UUID: String] = [:]
    public init(store: SnapshotStore, transport: any DriveTransport) { self.store = store; self.transport = transport }
    @discardableResult
    private func update(_ action: (inout WorkspaceSnapshot) throws -> Void) throws -> WorkspaceSnapshot {
        var next = try store.load(); let revision = next.revision
        try action(&next)
        return try store.save(next, expectedRevision: revision)
    }
    private func index(_ snapshot: WorkspaceSnapshot, _ orgID: UUID) throws -> Int {
        guard let i = snapshot.driveReplicas.firstIndex(where: { $0.organizationID == orgID }) else { throw DriveSyncError.wrongWorkspace }; return i
    }
    public func activate(organizationID: UUID, folderID: String) throws {
        try update { try DriveSync.activate(&$0, organizationID: organizationID, folderID: folderID, deviceName: DeviceIdentity.name) }
    }
    public func setPaused(_ paused: Bool, organizationID: UUID) throws {
        guard !syncing else { throw GoogleDriveError.message(NexoLocale.text("Espera a que termine la sincronización.")) }
        try update { snapshot in snapshot.driveReplicas[try index(snapshot, organizationID)].isPaused = paused }
        if paused { errors.removeValue(forKey: organizationID) }
    }
    @discardableResult
    public func restoreWorkspace(_ snapshot: WorkspaceSnapshot) throws -> WorkspaceSnapshot {
        guard !syncing else { throw GoogleDriveError.message(NexoLocale.text("Espera a que termine la sincronización.")) }
        return try WorkspaceTransfer.restore(snapshot, into: store)
    }
    /// One inaccessible folder must not prevent other spaces from syncing.
    public func syncAvailable(organizationID: UUID? = nil) async throws {
        let replicas = try store.load().driveReplicas
        for replica in replicas where replica.isPaused != true && (organizationID == nil || replica.organizationID == organizationID) {
            do {
                try await sync(organizationID: replica.organizationID)
                errors.removeValue(forKey: replica.organizationID)
            } catch { errors[replica.organizationID] = error.localizedDescription }
        }
    }
    /// Joining is staged entirely in memory and saved once after all history and
    /// relationships validate. Existing associations are never replaced.
    public func join(folderID: String) async throws -> UUID {
        guard !syncing else { throw GoogleDriveError.message(NexoLocale.text("Espera a que termine la sincronización.")) }
        syncing = true; defer { syncing = false }
        let folder = try await transport.folder(folderID)
        let orgID = try organization(in: folder)
        guard !(try store.load()).organizations.contains(where: { $0.id == orgID }) else { throw DriveSyncError.alreadyLinked }
        let files = try await transport.files(in: folderID)
        guard !files.isEmpty else { throw GoogleDriveError.message(NexoLocale.text("Este espacio todavía no tiene datos en Drive. Sincronízalo desde el dispositivo que lo creó.")) }
        var batches: [DriveBatch] = [], receipts: [DriveReceipt] = []
        for file in files {
            let (batch, receipt) = try await transport.download(file)
            batches.append(batch); receipts.append(receipt)
        }
        try update { snapshot in
            guard !snapshot.organizations.contains(where: { $0.id == orgID }) else { throw DriveSyncError.alreadyLinked }
            var replica = DriveReplica(organizationID: orgID, folderID: folderID)
            replica.canEdit = folder.capabilities?.canAddChildren == true
            snapshot.driveReplicas.append(replica)
            try DriveSync.receive(batches, into: &snapshot, organizationID: orgID)
            let i = try index(snapshot, orgID)
            snapshot.driveReplicas[i].receipts = receipts
            snapshot.driveReplicas[i].lastSyncAt = .now
        }
        return orgID
    }
    public func sync(organizationID: UUID) async throws {
        guard !syncing else { return }
        syncing = true; defer { syncing = false }
        let initial = try store.load(), i = try index(initial, organizationID)
        guard initial.driveReplicas[i].isPaused != true else { return }
        let folderID = initial.driveReplicas[i].folderID
        let folder = try await transport.folder(folderID)
        guard try organization(in: folder) == organizationID else { throw DriveSyncError.wrongWorkspace }
        let canEdit = folder.capabilities?.canAddChildren == true
        if initial.driveReplicas[i].canEdit != canEdit {
            try update { $0.driveReplicas[try index($0, organizationID)].canEdit = canEdit }
        }
        let files = try await transport.files(in: folderID)
        let current = try store.load(), replica = current.driveReplicas[try index(current, organizationID)]
        let remote = Dictionary(grouping: files, by: \.id)
        guard remote.values.allSatisfy({ $0.count == 1 }) else { throw DriveSyncError.invalidHistory }
        for receipt in replica.receipts {
            guard let file = remote[receipt.fileID]?.first else { throw DriveSyncError.missingHistory }
            guard file.md5Checksum == receipt.checksum else { throw DriveSyncError.invalidHistory }
        }
        let knownFiles = Set(replica.receipts.map(\.fileID))
        var incoming: [DriveBatch] = [], receipts: [DriveReceipt] = []
        for file in files where !knownFiles.contains(file.id) {
            let (batch, receipt) = try await transport.download(file)
            if replica.seen.contains(batch.id) {
                // An imported backup may hold the same pending batch on two
                // devices. A lost acknowledgement or duplicate upload is safe
                // only when the immutable bytes match, regardless of file ID.
                if let queued = replica.outbox.first(where: { $0.id == batch.id }) {
                    guard try sameBytes(queued, batch) else { throw DriveSyncError.invalidHistory }
                } else {
                    guard replica.receipts.contains(where: { $0.batchID == batch.id && $0.checksum == receipt.checksum }) else { throw DriveSyncError.invalidHistory }
                }
            }
            incoming.append(batch); receipts.append(receipt)
        }
        if !incoming.isEmpty {
            try update { snapshot in
                try DriveSync.receive(incoming, into: &snapshot, organizationID: organizationID)
                let index = try index(snapshot, organizationID)
                snapshot.driveReplicas[index].receipts.append(contentsOf: receipts)
                let acknowledged = Set(receipts.map(\.batchID))
                snapshot.driveReplicas[index].outbox.removeAll { acknowledged.contains($0.id) }
                for id in acknowledged { snapshot.driveReplicas[index].uploadIDs.removeValue(forKey: id.uuidString) }
            }
        }
        while true {
            let latest = try store.load(), index = try index(latest, organizationID)
            guard let batch = latest.driveReplicas[index].outbox.first else { break }
            guard canEdit else { throw DriveSyncError.readOnly }
            let fileID: String
            if let reserved = latest.driveReplicas[index].uploadIDs[batch.id.uuidString] { fileID = reserved }
            else {
                fileID = try await transport.reserveID()
                try update { snapshot in snapshot.driveReplicas[try self.index(snapshot, organizationID)].uploadIDs[batch.id.uuidString] = fileID }
            }
            let receipt = try await transport.upload(batch, folder: folderID, fileID: fileID)
            guard receipt.fileID == fileID, receipt.batchID == batch.id else { throw DriveSyncError.invalidHistory }
            try update { snapshot in
                let index = try self.index(snapshot, organizationID)
                guard snapshot.driveReplicas[index].outbox.first?.id == batch.id else { throw DriveSyncError.invalidHistory }
                snapshot.driveReplicas[index].outbox.removeFirst()
                snapshot.driveReplicas[index].uploadIDs.removeValue(forKey: batch.id.uuidString)
                snapshot.driveReplicas[index].receipts.append(receipt)
            }
        }
        // This time acknowledges the changes observed/sent by this sync pass;
        // other Macs can still create later files. It is not a backup timestamp.
        let completed = try store.load(), final = completed.driveReplicas[try index(completed, organizationID)]
        checkedAt[organizationID] = .now
        if final.lastSyncAt == nil || !incoming.isEmpty || !initial.driveReplicas[i].outbox.isEmpty || Date().timeIntervalSince(final.lastSyncAt!) > 900 {
            try update { $0.driveReplicas[try index($0, organizationID)].lastSyncAt = .now }
        }
    }
    public func resolve(organizationID: UUID, key: String, versionID: UUID) throws {
        try update { try DriveSync.resolve(&$0, organizationID: organizationID, key: key, versionID: versionID, deviceName: DeviceIdentity.name) }
    }
    private func organization(in folder: GoogleDriveFile) throws -> UUID {
        guard folder.trashed != true, folder.mimeType == "application/vnd.google-apps.folder", folder.properties?["nexoFormat"] == "1", let value = folder.properties?["nexoOrg"], let id = UUID(uuidString: value) else { throw DriveSyncError.wrongWorkspace }
        return id
    }
    private func sameBytes(_ lhs: DriveBatch, _ rhs: DriveBatch) throws -> Bool {
        let encoder = ExperienceStore.encoder(); encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(lhs) == encoder.encode(rhs)
    }
}
