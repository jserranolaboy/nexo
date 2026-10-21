import Foundation
import Testing
import CryptoKit
import VRRCore
@testable import ExperienceKit

@MainActor
final class MemoryDrive: DriveTransport {
    let orgID: UUID
    var data: [String: Data] = [:]
    var failAfterUpload = false
    var canEdit = true
    var unavailableFolders = Set<String>()
    var uploaded = 0
    var beforeReserveID: (() async -> Void)?
    init(orgID: UUID) { self.orgID = orgID }
    func folder(_ id: String) async throws -> GoogleDriveFile {
        if unavailableFolders.contains(id) { throw GoogleDriveError.http(404) }
        return GoogleDriveFile(id: id, name: "Nexo", mimeType: "application/vnd.google-apps.folder", md5Checksum: nil, size: nil, properties: ["nexoFormat": "1", "nexoOrg": orgID.uuidString], capabilities: .init(canEdit: canEdit, canAddChildren: canEdit), trashed: false)
    }
    func files(in folder: String) async throws -> [GoogleDriveFile] {
        try data.map { id, bytes in
            let batch = try ExperienceStore.decoder().decode(DriveBatch.self, from: bytes)
            return GoogleDriveFile(id: id, name: id, mimeType: "application/json", md5Checksum: digest(bytes), size: String(bytes.count), properties: ["nexoBatch": "1", "nexoOrg": orgID.uuidString, "nexoChange": batch.id.uuidString], capabilities: nil, trashed: false)
        }
    }
    func reserveID() async throws -> String {
        await beforeReserveID?()
        return UUID().uuidString
    }
    func upload(_ batch: DriveBatch, folder: String, fileID: String) async throws -> DriveReceipt {
        uploaded += 1
        let encoder = ExperienceStore.encoder(); encoder.outputFormatting = [.sortedKeys]
        let bytes = try encoder.encode(batch)
        if let old = data[fileID] { #expect(old == bytes) }
        data[fileID] = bytes
        if failAfterUpload { failAfterUpload = false; throw URLError(.networkConnectionLost) }
        return DriveReceipt(fileID: fileID, checksum: digest(bytes), batchID: batch.id)
    }
    func download(_ file: GoogleDriveFile) async throws -> (DriveBatch, DriveReceipt) {
        let bytes = data[file.id]!, batch = try ExperienceStore.decoder().decode(DriveBatch.self, from: bytes)
        return (batch, DriveReceipt(fileID: file.id, checksum: digest(bytes), batchID: batch.id))
    }
    func digest(_ data: Data) -> String { Insecure.MD5.hash(data: data).map { String(format: "%02x", $0) }.joined() }
}
@MainActor
struct DriveSyncTests {
    private func pair() async throws -> (URL, ExperienceStore, ExperienceStore, DriveCoordinator, DriveCoordinator, MemoryDrive) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nexo-drive-tests-\(UUID())")
        let fixture = ExperienceStoreTests().fixture()
        let disk = SnapshotStore(directory: root.appendingPathComponent("A")); try disk.initialize(fixture)
        let a = try ExperienceStore(directory: disk.directory), b = try ExperienceStore(directory: root.appendingPathComponent("B"))
        let remote = MemoryDrive(orgID: fixture.organizations[0].id)
        let ca = DriveCoordinator(store: a.store, transport: remote), cb = DriveCoordinator(store: b.store, transport: remote)
        try ca.activate(organizationID: remote.orgID, folderID: "test-folder")
        try await ca.sync(organizationID: remote.orgID)
        _ = try await cb.join(folderID: "test-folder")
        return (root, a, b, ca, cb, remote)
    }
    @Test func concurrentAttendanceKeepsBothVersionsAndResolutionConverges() async throws {
        let (root, a, b, ca, cb, remote) = try await pair(); defer { try? FileManager.default.removeItem(at: root) }
        let baseline = try a.load(), event = baseline.events[0].id.uuidString, member = baseline.members[0].id.uuidString
        for (store, status) in [(a, "present"), (b, "excused")] {
            var s = try store.perform(["kind": "roster", "eventID": event, "memberIDs": [member]], expectedRevision: store.load().revision)
            s = try store.perform(["kind": "attendance", "eventID": event, "memberID": member, "status": status, "note": status], expectedRevision: s.revision)
            #expect(s.driveReplicas[0].outbox.count == 2)
        }
        try await ca.sync(organizationID: remote.orgID); try await cb.sync(organizationID: remote.orgID); try await ca.sync(organizationID: remote.orgID)
        let conflicted = try a.load(), replica = conflicted.driveReplicas[0]
        #expect(replica.conflicts.count == 1)
        #expect(conflicted.attendance.count == 1)
        #expect(try DriveSync.entities(a.load(), organizationID: remote.orgID) == DriveSync.entities(b.load(), organizationID: remote.orgID))
        #expect(throws: (any Error).self) { try a.perform(["kind": "attendance", "eventID": event, "memberID": member, "status": "absent"], expectedRevision: conflicted.revision) }
        let key = replica.conflicts[0], version = replica.versions[key]!.last!
        try ca.resolve(organizationID: remote.orgID, key: key, versionID: version.batchID)
        try await ca.sync(organizationID: remote.orgID); try await cb.sync(organizationID: remote.orgID)
        #expect(try a.load().driveReplicas[0].conflicts.isEmpty)
        #expect(try b.load().driveReplicas[0].conflicts.isEmpty)
        #expect(try a.load().attendance == b.load().attendance)
        #expect(remote.data.count == 6) // root + two edits from each Mac + resolution
    }
    @Test func lostUploadAcknowledgementSurvivesRestartWithoutDuplicate() async throws {
        let (root, a, _, ca, _, remote) = try await pair(); defer { try? FileManager.default.removeItem(at: root) }
        let initial = try a.load()
        _ = try a.perform(["kind":"updateMember", "memberID":initial.members[0].id.uuidString, "name":"Ana María"], expectedRevision: initial.revision)
        remote.failAfterUpload = true
        await #expect(throws: (any Error).self) { try await ca.sync(organizationID: remote.orgID) }
        #expect(try a.load().driveReplicas[0].outbox.count == 1)
        #expect(remote.data.count == 2)
        let reopened = try ExperienceStore(directory: a.store.directory)
        let resumed = DriveCoordinator(store: reopened.store, transport: remote)
        try await resumed.sync(organizationID: remote.orgID)
        #expect(try reopened.load().driveReplicas[0].outbox.isEmpty)
        #expect(remote.data.count == 2)
        #expect(try reopened.load().members[0].name == "Ana María")
    }
    @Test func independentEditsMergeAndOnlyTheChosenOrganizationIsUploaded() async throws {
        let (root, a, b, ca, cb, remote) = try await pair(); defer { try? FileManager.default.removeItem(at: root) }
        var sa = try a.load(), sb = try b.load()
        sa = try a.perform(["kind":"addMember", "id":UUID().uuidString, "organizationID":remote.orgID.uuidString, "name":"Bea"], expectedRevision:sa.revision)
        sb = try b.perform(["kind":"addComponent", "id":UUID().uuidString, "organizationID":remote.orgID.uuidString, "name":"Investigación"], expectedRevision:sb.revision)
        let pending = sa.driveReplicas[0].outbox.count
        sa = try a.perform(["kind":"createOrganization", "id":UUID().uuidString, "name":"Privado"], expectedRevision:sa.revision)
        #expect(sa.driveReplicas[0].outbox.count == pending)
        try await ca.sync(organizationID:remote.orgID); try await cb.sync(organizationID:remote.orgID); try await ca.sync(organizationID:remote.orgID)
        #expect(try b.load().organizations.count == 1)
        #expect(try a.load().members.count == 2)
        #expect(try a.load().components.count == 2)
        #expect(try DriveSync.entities(a.load(),organizationID:remote.orgID) == DriveSync.entities(b.load(),organizationID:remote.orgID))
    }
    @Test func concurrentVolunteerSelectionsNeverOverfillCapacity() async throws {
        let (root, a, b, ca, cb, remote) = try await pair(); defer { try? FileManager.default.removeItem(at: root) }
        let second = UUID(), event = try a.load().events[0].id.uuidString
        _ = try a.perform(["kind":"addMember","id":second.uuidString,"organizationID":remote.orgID.uuidString,"name":"Bea"],expectedRevision:a.load().revision)
        let first = try a.load().members[0].id.uuidString
        _ = try a.perform(["kind":"registerVolunteers","eventID":event,"memberIDs":[first,second.uuidString]],expectedRevision:a.load().revision)
        try await ca.sync(organizationID:remote.orgID); try await cb.sync(organizationID:remote.orgID)
        for (store,member) in [(a,first),(b,second.uuidString)] {
            _ = try store.perform(["kind":"volunteer","eventID":event,"memberID":member,"status":"selected"],expectedRevision:store.load().revision)
        }
        try await ca.sync(organizationID:remote.orgID); try await cb.sync(organizationID:remote.orgID); try await ca.sync(organizationID:remote.orgID)
        #expect(try a.load().volunteers.filter{$0.status == .selected}.count == 1)
        #expect(try a.load().driveReplicas[0].conflicts == ["volunteers:\(event)"])
        #expect(try a.load().volunteers == b.load().volunteers)
    }
    @Test func missingOrModifiedRemoteHistoryNeverReplacesLocalData() async throws {
        let (root, a, _, ca, _, remote) = try await pair(); defer { try? FileManager.default.removeItem(at: root) }
        let bytes = try Data(contentsOf:a.store.primaryURL), original = remote.data
        remote.data = [:]
        await #expect(throws:(any Error).self) { try await ca.sync(organizationID:remote.orgID) }
        #expect(try Data(contentsOf:a.store.primaryURL) == bytes)
        remote.data = original.mapValues { $0 + Data(" ".utf8) }
        await #expect(throws:(any Error).self) { try await ca.sync(organizationID:remote.orgID) }
        #expect(try Data(contentsOf:a.store.primaryURL) == bytes)
    }
    @Test func missingParentsAndForeignOrganizationAreRejectedAtomically() throws {
        var a = ExperienceStoreTests().fixture(), b = WorkspaceSnapshot()
        let orgID = a.organizations[0].id
        try DriveSync.activate(&a,organizationID:orgID,folderID:"folder",deviceName:"A")
        b.driveReplicas = [DriveReplica(organizationID:orgID,folderID:"folder")]
        var bad = a.driveReplicas[0].outbox[0]; bad.parents = [UUID()]
        let before = b
        #expect(throws:(any Error).self) { try DriveSync.receive([bad],into:&b,organizationID:orgID) }
        #expect(b == before)
        bad = a.driveReplicas[0].outbox[0]; bad.organizationID = UUID()
        #expect(throws:(any Error).self) { try DriveSync.receive([bad],into:&b,organizationID:orgID) }
        #expect(b == before)
    }
    @Test func revokedWritePermissionKeepsPendingEdits() async throws {
        let (root, a, _, ca, _, remote) = try await pair(); defer { try? FileManager.default.removeItem(at:root) }
        let s = try a.load()
        _ = try a.perform(["kind":"updateMember","memberID":s.members[0].id.uuidString,"name":"Ana editada"],expectedRevision:s.revision)
        remote.canEdit = false
        await #expect(throws:(any Error).self) { try await ca.sync(organizationID:remote.orgID) }
        #expect(try a.load().driveReplicas[0].outbox.count == 1)
        #expect(try a.load().members[0].name == "Ana editada")
        #expect(throws:(any Error).self) { try a.perform(["kind":"updateMember","memberID":s.members[0].id.uuidString,"name":"Otro cambio"],expectedRevision:a.load().revision) }
    }
}
