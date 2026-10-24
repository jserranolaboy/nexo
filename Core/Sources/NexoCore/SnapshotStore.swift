import Foundation
import Darwin

public enum SnapshotStoreError: Error, Equatable, Sendable {
    case missingPrimary
    case alreadyInitialized
    case unsupportedSchema
    case corruptPrimary
    case staleRevision
    case revisionExhausted
    case writeLockUnavailable
}

/// A local, recoverable copy. The shared service remains authoritative when
/// collaboration is enabled; this store never treats sync as a backup.
public final class SnapshotStore {
    public let directory: URL
    private let fileManager: FileManager

    public init(directory: URL, fileManager: FileManager = .default) {
        self.directory = directory
        self.fileManager = fileManager
    }

    public var primaryURL: URL { directory.appendingPathComponent("workspace-v1.json") }
    public var backupsURL: URL { directory.appendingPathComponent("Backups", isDirectory: true) }

    public func initialize(_ snapshot: WorkspaceSnapshot = WorkspaceSnapshot()) throws {
        try withWriteLock { try initializeLocked(snapshot) }
    }
    private func initializeLocked(_ snapshot: WorkspaceSnapshot) throws {
        guard !fileManager.fileExists(atPath: primaryURL.path) else { throw SnapshotStoreError.alreadyInitialized }
        guard try availableBackups().isEmpty else { throw SnapshotStoreError.missingPrimary }
        try WorkspaceRules.validate(snapshot)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        try encode(snapshot).write(to: primaryURL, options: .atomic)
    }

    public func load() throws -> WorkspaceSnapshot {
        guard fileManager.fileExists(atPath: primaryURL.path) else { throw SnapshotStoreError.missingPrimary }
        guard let data = try? Data(contentsOf: primaryURL),
              let snapshot = try? decoder().decode(WorkspaceSnapshot.self, from: data)
        else { throw SnapshotStoreError.corruptPrimary }
        guard snapshot.schemaVersion == WorkspaceSnapshot.currentSchemaVersion else {
            throw SnapshotStoreError.unsupportedSchema
        }
        do { try WorkspaceRules.validate(snapshot) }
        catch { throw SnapshotStoreError.corruptPrimary }
        return snapshot
    }

    /// Requires the revision the caller read, preventing stale local writes.
    /// An independent copy of the old version is made before each replacement.
    @discardableResult
    public func save(_ proposed: WorkspaceSnapshot, expectedRevision: UInt64) throws -> WorkspaceSnapshot {
        try withWriteLock { try saveLocked(proposed, expectedRevision: expectedRevision) }
    }
    private func saveLocked(_ proposed: WorkspaceSnapshot, expectedRevision: UInt64) throws -> WorkspaceSnapshot {
        let current = try load()
        guard current.revision == expectedRevision else { throw SnapshotStoreError.staleRevision }
        guard current.revision < UInt64.max else { throw SnapshotStoreError.revisionExhausted }
        var next = proposed
        next.schemaVersion = WorkspaceSnapshot.currentSchemaVersion
        next.revision = current.revision + 1
        try WorkspaceRules.validate(next)

        try fileManager.createDirectory(at: backupsURL, withIntermediateDirectories: true)
        let previousBackup = backupsURL.appendingPathComponent("revision-\(current.revision)-\(UUID().uuidString).json")
        let nextBackup = backupsURL.appendingPathComponent("revision-\(next.revision)-\(UUID().uuidString).json")
        let newData = try encode(next)
        try fileManager.copyItem(at: primaryURL, to: previousBackup)
        // Preserve the exact new bytes before replacing the primary file. A
        // damaged primary can then be restored without losing this save.
        try newData.write(to: nextBackup, options: .atomic)
        try newData.write(to: primaryURL, options: .atomic)
        // Thinning never touches the primary file or the newest copies; a failure
        // here leaves extra copies behind, never fewer.
        try? compactBackups()
        return next
    }

    /// Keeps every copy of the most recent revisions and progressively fewer older
    /// ones: one per hour for two days, one per day for sixty days, one per week after.
    @discardableResult
    public func compactBackups(keepingRecent recent: Int = 60, now: Date = .now) throws -> Int {
        let all = try availableBackups()
        guard all.count > recent else { return 0 }
        let older = all.dropLast(recent)
        var seen = Set<String>(), removed = 0
        // Newest first, so the latest copy inside each bucket is the one kept.
        for url in older.reversed() {
            let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? now
            let age = now.timeIntervalSince(date)
            let bucket: String
            if age < 2 * 86400 { bucket = "h\(Int(date.timeIntervalSince1970 / 3600))" }
            else if age < 60 * 86400 { bucket = "d\(Int(date.timeIntervalSince1970 / 86400))" }
            else { bucket = "w\(Int(date.timeIntervalSince1970 / (7 * 86400)))" }
            if seen.insert(bucket).inserted { continue }
            try fileManager.removeItem(at: url)
            removed += 1
        }
        return removed
    }

    public func availableBackups() throws -> [URL] {
        guard fileManager.fileExists(atPath: backupsURL.path) else { return [] }
        return try fileManager.contentsOfDirectory(at: backupsURL, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .sorted {
                let left = backupRevision(at: $0)
                let right = backupRevision(at: $1)
                if left == nil && right != nil { return true }
                if left != nil && right == nil { return false }
                return left == right ? $0.lastPathComponent < $1.lastPathComponent : (left ?? 0) < (right ?? 0)
            }
    }

    private func backupRevision(at url: URL) -> UInt64? {
        guard url.lastPathComponent.hasPrefix("revision-") else { return nil }
        return UInt64(url.deletingPathExtension().lastPathComponent.split(separator: "-").dropFirst().first ?? "")
    }

    public func inspectBackup(at url: URL) throws -> WorkspaceSnapshot {
        let data = try Data(contentsOf: url)
        let snapshot = try decoder().decode(WorkspaceSnapshot.self, from: data)
        guard snapshot.schemaVersion == WorkspaceSnapshot.currentSchemaVersion else {
            throw SnapshotStoreError.unsupportedSchema
        }
        try WorkspaceRules.validate(snapshot)
        return snapshot
    }

    /// Explicit recovery preserves the current file, including damaged bytes,
    /// for later inspection. No recovery happens silently on launch.
    public func restoreBackup(at url: URL) throws -> WorkspaceSnapshot {
        try withWriteLock { try restoreLocked(at: url) }
    }
    private func restoreLocked(at url: URL) throws -> WorkspaceSnapshot {
        var recovered = try inspectBackup(at: url)
        // A restore starts a new revision, so pre-restore writers never become current again.
        let latestBackupRevision = try availableBackups().compactMap { backupRevision(at: $0) }.max() ?? 0
        let highestRevision = max(recovered.revision, max((try? load())?.revision ?? 0, latestBackupRevision))
        guard highestRevision < UInt64.max else { throw SnapshotStoreError.revisionExhausted }
        recovered.revision = highestRevision + 1
        let data = try encode(recovered)
        if fileManager.fileExists(atPath: primaryURL.path) {
            let quarantine = directory.appendingPathComponent("pre-restore-\(UUID().uuidString).json")
            try fileManager.copyItem(at: primaryURL, to: quarantine)
        }
        try fileManager.createDirectory(at: backupsURL, withIntermediateDirectories: true)
        let backup = backupsURL.appendingPathComponent("revision-\(recovered.revision)-\(UUID().uuidString).json")
        try data.write(to: backup, options: .atomic)
        try data.write(to: primaryURL, options: .atomic)
        return recovered
    }

    /// Serializes writers across processes as well as separate store instances.
    private func withWriteLock<T>(_ action: () throws -> T) throws -> T {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let descriptor = open(directory.appendingPathComponent(".workspace-write.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw SnapshotStoreError.writeLockUnavailable }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { throw SnapshotStoreError.writeLockUnavailable }
        defer { flock(descriptor, LOCK_UN) }
        return try action()
    }
    private func encode(_ snapshot: WorkspaceSnapshot) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(snapshot)
        // The persisted date format can collapse valid subsecond intervals.
        // Refuse unreadable candidates before replacing any saved payload.
        try WorkspaceRules.validate(try decoder().decode(WorkspaceSnapshot.self, from: data))
        return data
    }

    private func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
