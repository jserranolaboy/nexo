import Foundation
import NexoCore

/// A local working copy, separate from the saved template and Drive journal.
public struct TemplateDraftStore {
    public let directory: URL
    public init(directory: URL) { self.directory = directory }
    public var url: URL { directory.appendingPathComponent("template-draft.json") }
    public func save(_ body: [String: Any]) throws {
        guard body["dirty"] as? Bool == true else {
            if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
            return
        }
        guard let template = body["template"], let org = body["organizationID"] as? String,
              UUID(uuidString: org) != nil else { return }
        let data = try JSONSerialization.data(withJSONObject: template)
        let parsed = try WorkspaceStore.decoder().decode(DocumentTemplate.self, from: data)
        guard parsed.organizationID.uuidString.lowercased() == org.lowercased(), data.count <= 20_000_000 else { throw WorkspaceError.invalidInput(NexoLocale.text("El borrador no es válido.")) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let dataToSave = try JSONSerialization.data(withJSONObject: body)
        #if os(iOS)
        try dataToSave.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try dataToSave.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        #endif
    }
    public func read() throws -> [String: Any]? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
    }
}
