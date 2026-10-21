import Foundation
import CryptoKit
import VRRCore

/// The same portable JSON contract is used by all three device families.
/// PDF and image bytes live inside templates; no platform-local file paths
/// or credentials are required to reconstruct the workspace.
public enum WorkspaceTransfer {
    public static func export(_ snapshot: WorkspaceSnapshot) throws -> Data {
        guard snapshot.schemaVersion == WorkspaceSnapshot.currentSchemaVersion else { throw SnapshotStoreError.unsupportedSchema }
        try WorkspaceRules.validate(snapshot)
        let encoder = ExperienceStore.encoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        var document = try JSONSerialization.jsonObject(with: encoder.encode(snapshot)) as! [String: Any]
        document["nexoArchive"] = ["version": 1, "sha256": try checksum(document)]
        // Metadata is an extra root key, so older Nexo versions can still read
        // the unchanged workspace schema. New versions verify it before import.
        let data = try JSONSerialization.data(withJSONObject: document, options: [.prettyPrinted, .sortedKeys])
        _ = try inspect(data)
        return data
    }
    public static func inspect(_ data: Data) throws -> WorkspaceSnapshot {
        if var document = try JSONSerialization.jsonObject(with: data) as? [String: Any], let raw = document.removeValue(forKey: "nexoArchive") {
            guard let integrity = raw as? [String: Any], integrity["version"] as? Int == 1,
                  let expected = integrity["sha256"] as? String, expected == (try checksum(document)) else {
                throw ExperienceError.invalidInput(NexoLocale.text("La copia está dañada o fue modificada. Elige otra copia; tus datos actuales se conservan."))
            }
        }
        let snapshot = try ExperienceStore.decoder().decode(WorkspaceSnapshot.self, from: data)
        guard snapshot.schemaVersion == WorkspaceSnapshot.currentSchemaVersion else { throw SnapshotStoreError.unsupportedSchema }
        try WorkspaceRules.validate(snapshot)
        return snapshot
    }
    public static func inspect(at url: URL) throws -> WorkspaceSnapshot {
        try inspect(Data(contentsOf: url))
    }
    private static func checksum(_ document: [String: Any]) throws -> String {
        let canonical = try JSONSerialization.data(withJSONObject: document, options: [.sortedKeys])
        return SHA256.hash(data: canonical).map { String(format: "%02x", $0) }.joined()
    }
    /// Keep pending changes, conflict alternatives and receipts intact. Merely
    /// opening a backup on another device is not consent to upload its contents.
    @discardableResult
    public static func restore(_ snapshot: WorkspaceSnapshot, into store: SnapshotStore) throws -> WorkspaceSnapshot {
        var local = snapshot
        for i in local.driveReplicas.indices { local.driveReplicas[i].isPaused = true }
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("nexo-transfer-\(UUID()).json")
        defer { try? FileManager.default.removeItem(at: temporary) }
        try export(local).write(to: temporary, options: .atomic)
        return try store.restoreBackup(at: temporary)
    }
}
