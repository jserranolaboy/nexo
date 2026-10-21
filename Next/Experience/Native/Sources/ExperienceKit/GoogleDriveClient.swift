import Foundation
import CryptoKit
import VRRCore

public struct GoogleDriveFile: Codable, Sendable {
    public struct Capabilities: Codable, Sendable { public let canEdit: Bool?; public let canAddChildren: Bool? }
    public let id: String
    public let name: String?
    public let mimeType: String?
    public let md5Checksum: String?
    public let size: String?
    public let properties: [String: String]?
    public let capabilities: Capabilities?
    public let trashed: Bool?
}
@MainActor
public protocol DriveTransport {
    func folder(_ id: String) async throws -> GoogleDriveFile
    func files(in folder: String) async throws -> [GoogleDriveFile]
    func reserveID() async throws -> String
    func upload(_ batch: DriveBatch, folder: String, fileID: String) async throws -> DriveReceipt
    func download(_ file: GoogleDriveFile) async throws -> (DriveBatch, DriveReceipt)
}
@MainActor
public final class GoogleDriveClient: DriveTransport {
    private let auth: any GoogleAccessAuthorizing
    private let session: URLSession
    private let fields = "id,name,mimeType,md5Checksum,size,properties,capabilities(canEdit,canAddChildren),trashed"
    public init(auth: any GoogleAccessAuthorizing, session: URLSession = .shared) { self.auth = auth; self.session = session }
    public func account() async throws -> String {
        struct About: Decodable { struct User: Decodable { let emailAddress: String }; let user: User }
        return try JSONDecoder().decode(About.self, from: await request(path: "about", query: ["fields": "user(emailAddress)"]).0).user.emailAddress
    }
    public func spaces() async throws -> [GoogleDriveFile] {
        try await list(query: "trashed = false and mimeType = 'application/vnd.google-apps.folder' and properties has { key='nexoFormat' and value='1' }")
    }
    public func folder(_ id: String) async throws -> GoogleDriveFile {
        try checkID(id)
        return try JSONDecoder().decode(GoogleDriveFile.self, from: await request(path: "files/\(id)", query: ["fields": fields, "supportsAllDrives": "true"]).0)
    }
    public func createSpace(name: String, organizationID: UUID) async throws -> GoogleDriveFile {
        let id = try await reserveID()
        let body: [String: Any] = ["id": id, "name": "Nexo · " + name, "mimeType": "application/vnd.google-apps.folder", "properties": ["nexoFormat": "1", "nexoOrg": organizationID.uuidString]]
        do {
            return try JSONDecoder().decode(GoogleDriveFile.self, from: await request(path: "files", method: "POST", query: ["fields": fields], body: JSONSerialization.data(withJSONObject: body)).0)
        } catch {
            // A lost response must not make another folder or lose its identity.
            if let existing = try? await folder(id), existing.properties?["nexoOrg"] == organizationID.uuidString { return existing }
            throw error
        }
    }
    public func reserveID() async throws -> String {
        struct IDs: Decodable { let ids: [String] }
        let data = try await request(path: "files/generateIds", query: ["count": "1", "space": "drive", "type": "files"]).0
        guard let id = try JSONDecoder().decode(IDs.self, from: data).ids.first else { throw DriveSyncError.invalidHistory }
        try checkID(id); return id
    }
    public func files(in folder: String) async throws -> [GoogleDriveFile] {
        try checkID(folder)
        return try await list(query: "'\(folder)' in parents and trashed = false and properties has { key='nexoBatch' and value='1' }")
    }
    private func list(query: String) async throws -> [GoogleDriveFile] {
        struct Page: Decodable { let files: [GoogleDriveFile]; let nextPageToken: String?; let incompleteSearch: Bool? }
        var files: [GoogleDriveFile] = [], cursor: String?, visited = Set<String>()
        repeat {
            var q = ["q": query, "pageSize": "1000", "fields": "nextPageToken,incompleteSearch,files(\(fields))", "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"]
            q["pageToken"] = cursor
            let page = try JSONDecoder().decode(Page.self, from: await request(path: "files", query: q).0)
            guard page.incompleteSearch != true else { throw GoogleDriveError.message(NexoLocale.text("Drive devolvió un historial incompleto. Vuelve a sincronizar.")) }
            files.append(contentsOf: page.files); cursor = page.nextPageToken
            if let cursor, !visited.insert(cursor).inserted { throw DriveSyncError.invalidHistory }
        } while cursor != nil
        return files
    }
    public func upload(_ batch: DriveBatch, folder: String, fileID: String) async throws -> DriveReceipt {
        try checkID(folder); try checkID(fileID)
        let encoder = ExperienceStore.encoder(); encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(batch)
        guard data.count <= 64_000_000 else { throw GoogleDriveError.message(NexoLocale.text("El cambio supera 64 MB. Reduce el tamaño de los PDF de las plantillas.")) }
        let metadata: [String: Any] = ["id": fileID, "name": "change-\(batch.id.uuidString).json", "mimeType": "application/json", "parents": [folder], "properties": ["nexoBatch": "1", "nexoOrg": batch.organizationID.uuidString, "nexoChange": batch.id.uuidString]]
        do {
            let (_, response) = try await request(path: "files", method: "POST", query: ["uploadType": "resumable", "fields": fields, "supportsAllDrives": "true"], body: JSONSerialization.data(withJSONObject: metadata), upload: true, extraHeaders: ["X-Upload-Content-Type": "application/json", "X-Upload-Content-Length": String(data.count)])
            guard let location = response.value(forHTTPHeaderField: "Location"), let url = URL(string: location), url.scheme == "https", url.host == "www.googleapis.com" else { throw DriveSyncError.invalidHistory }
            var request = URLRequest(url: url); request.httpMethod = "PUT"; request.httpBody = data
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let (result, _) = try await send(request)
            let file = try JSONDecoder().decode(GoogleDriveFile.self, from: result)
            guard file.id == fileID, file.md5Checksum == Self.checksum(data) else { throw DriveSyncError.invalidHistory }
            return DriveReceipt(fileID: fileID, checksum: Self.checksum(data), batchID: batch.id)
        } catch {
            // Reserved IDs make retries idempotent even when upload succeeded but
            // its acknowledgement was lost. Verify the actual stored bytes.
            let original = error
            if let file = try? await self.folder(fileID), let received = try? await download(file), received.0.id == batch.id, received.1.checksum == Self.checksum(data) { return received.1 }
            throw original
        }
    }
    public func download(_ file: GoogleDriveFile) async throws -> (DriveBatch, DriveReceipt) {
        try checkID(file.id)
        guard file.properties?["nexoBatch"] == "1", let sizeText = file.size, let size = Int(sizeText), size > 0, size <= 64_000_000, let checksum = file.md5Checksum else { throw DriveSyncError.invalidHistory }
        let data = try await request(path: "files/\(file.id)", query: ["alt": "media", "supportsAllDrives": "true"]).0
        guard data.count == size, Self.checksum(data) == checksum else { throw DriveSyncError.invalidHistory }
        let batch = try ExperienceStore.decoder().decode(DriveBatch.self, from: data)
        guard file.properties?["nexoChange"] == batch.id.uuidString,
              file.properties?["nexoOrg"] == batch.organizationID.uuidString else { throw DriveSyncError.wrongWorkspace }
        return (batch, DriveReceipt(fileID: file.id, checksum: checksum, batchID: batch.id))
    }
    private static func checksum(_ data: Data) -> String { Insecure.MD5.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private func checkID(_ value: String) throws {
        guard !value.isEmpty, value.count <= 200, value.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { throw DriveSyncError.wrongWorkspace }
    }
    private func request(path: String, method: String = "GET", query: [String: String] = [:], body: Data? = nil, upload: Bool = false, extraHeaders: [String: String] = [:]) async throws -> (Data, HTTPURLResponse) {
        var url = URLComponents(string: "https://www.googleapis.com/\(upload ? "upload/" : "")drive/v3/\(path)")!
        url.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        var request = URLRequest(url: url.url!); request.httpMethod = method; request.httpBody = body
        if body != nil { request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type") }
        for (key, value) in extraHeaders { request.setValue(value, forHTTPHeaderField: key) }
        return try await send(request)
    }
    private func send(_ original: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var refreshed = false
        for attempt in 0..<3 {
            var request = original; request.timeoutInterval = 45
            request.setValue("Bearer \(try await auth.accessToken(forceRefresh: refreshed))", forHTTPHeaderField: "Authorization")
            let (data, raw) = try await session.data(for: request)
            guard let response = raw as? HTTPURLResponse else { throw GoogleDriveError.http(0) }
            if (200..<300).contains(response.statusCode) { return (data, response) }
            if response.statusCode == 401 && !refreshed { refreshed = true; continue }
            if (response.statusCode == 429 || response.statusCode >= 500) && attempt < 2 {
                try await Task.sleep(for: .seconds(attempt + 1)); continue
            }
            throw GoogleDriveError.http(response.statusCode)
        }
        throw GoogleDriveError.signIn
    }
}
