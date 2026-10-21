import Foundation
import Testing
import VRRCore
@testable import ExperienceKit

/// Explicit opt-in only. Uses Nexo's already-authorized account without logging
/// tokens; creates synthetic data and moves its own test folder to Drive Trash.
@MainActor
struct LiveDriveTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["NEXO_LIVE_DRIVE_TEST"] == "1"))
    func twoIsolatedStoresConvergeThroughGoogleDrive() async throws {
        let support = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Valentina-Experience")
        let auth = try GoogleAuthorization(directory: support, keychainService: "org.nexo.google")
        if auth.requiresKeychainAccess { try auth.restoreStoredSession() }
        #expect(auth.signedIn)
        let remote = GoogleDriveClient(auth: auth)
        guard let authorizedAccount = ProcessInfo.processInfo.environment["NEXO_LIVE_DRIVE_ACCOUNT"],
              try await remote.account().lowercased() == authorizedAccount.lowercased() else {
            throw GoogleDriveError.message("La cuenta conectada no coincide con la autorizada para esta prueba.")
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nexo-live-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        var fixture = ExperienceStoreTests().fixture()
        fixture.organizations[0].name = "Prueba de colaboración"
        let orgID = fixture.organizations[0].id
        let folder = try await remote.createSpace(name: fixture.organizations[0].name, organizationID: orgID)
        print("Nexo synthetic test folder: \(folder.id)")
        do {
            let disk = SnapshotStore(directory: root.appendingPathComponent("A"))
            try disk.initialize(fixture)
            let a = try ExperienceStore(directory: disk.directory)
            let b = try ExperienceStore(directory: root.appendingPathComponent("B"))
            let ca = DriveCoordinator(store: a.store, transport: remote)
            let cb = DriveCoordinator(store: b.store, transport: remote)
            try ca.activate(organizationID: orgID, folderID: folder.id)
            try await ca.sync(organizationID: orgID)
            #expect(try await remote.spaces().contains { $0.id == folder.id })
            #expect(try await cb.join(folderID: folder.id) == orgID)
            let event = fixture.events[0].id.uuidString, member = fixture.members[0].id.uuidString
            for (store, status) in [(a, "present"), (b, "excused")] {
                _ = try store.perform(["kind": "roster", "eventID": event, "memberIDs": [member]], expectedRevision: store.load().revision)
                _ = try store.perform(["kind": "attendance", "eventID": event, "memberID": member, "status": status], expectedRevision: store.load().revision)
            }
            try await ca.sync(organizationID: orgID)
            try await cb.sync(organizationID: orgID)
            try await ca.sync(organizationID: orgID)
            let replica = try a.load().driveReplicas[0]
            #expect(replica.conflicts.count == 1)
            let key = try #require(replica.conflicts.first)
            let version = try #require(replica.versions[key]?.last)
            try ca.resolve(organizationID: orgID, key: key, versionID: version.batchID)
            try await ca.sync(organizationID: orgID)
            try await cb.sync(organizationID: orgID)
            #expect(try a.load().driveReplicas[0].conflicts.isEmpty)
            #expect(try b.load().driveReplicas[0].conflicts.isEmpty)
            #expect(try DriveSync.entities(a.load(), organizationID: orgID) == DriveSync.entities(b.load(), organizationID: orgID))
            #expect(try await remote.files(in: folder.id).count == 6)
            let reopened = try ExperienceStore(directory: b.store.directory)
            #expect(try reopened.load().attendance == a.load().attendance)
        } catch {
            do { try await trashTestFolder(folder.id, auth: auth) }
            catch { throw GoogleDriveError.message("No se pudo confirmar la limpieza de la carpeta de prueba \(folder.id): \(error.localizedDescription)") }
            throw error
        }
        try await trashTestFolder(folder.id, auth: auth)
    }

    private func trashTestFolder(_ id: String, auth: GoogleAuthorization) async throws {
        var request = URLRequest(url: URL(string: "https://www.googleapis.com/drive/v3/files/\(id)")!)
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(try await auth.accessToken())", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{\"trashed\":true}".utf8)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw GoogleDriveError.message("No se pudo retirar la carpeta de prueba \(id).")
        }
        var verification = URLRequest(url: URL(string: "https://www.googleapis.com/drive/v3/files/\(id)?fields=id,trashed")!)
        verification.setValue("Bearer \(try await auth.accessToken())", forHTTPHeaderField: "Authorization")
        let (data, checkResponse) = try await URLSession.shared.data(for: verification)
        guard let http = checkResponse as? HTTPURLResponse, http.statusCode == 200,
              let body = try JSONSerialization.jsonObject(with: data) as? [String: Any], body["trashed"] as? Bool == true else {
            throw GoogleDriveError.message("No se pudo confirmar que la carpeta de prueba \(id) está en la papelera.")
        }
        print("Nexo synthetic test cleanup verified: folder \(id) is in Trash.")
    }
}
