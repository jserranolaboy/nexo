import Foundation
import Testing
import NexoCore
@testable import NexoKit

@MainActor
struct SpaceLifecycleTests {
    func fixture() throws -> WorkspaceSnapshot {
        var s = WorkspaceStoreTests().fixture()
        try s.addAttendanceMembers(eventID: s.events[0].id, memberIDs: [s.members[0].id])
        try s.setAttendance(eventID: s.events[0].id, memberID: s.members[0].id, status: .excused, note: "Avisó")
        s.templates = [DocumentTemplate(organizationID: s.organizations[0].id, name: "Lista")]
        return try WorkspaceStore.decoder().decode(WorkspaceSnapshot.self, from: WorkspaceStore.encoder().encode(s))
    }
    func action(_ org: Organization, deleted: Bool) -> [String: Any] {
        ["kind": "setOrganizationDeleted", "organizationID": org.id.uuidString,
         "expectedName": org.name, "expectedDeleted": !deleted, "deleted": deleted]
    }
    @Test func trashReopensExportsAndRestoresWithoutLosingRecords() throws {
        let root = try WorkspaceStoreTests().scratch(); defer { try? FileManager.default.removeItem(at: root) }
        let before = try fixture(), org = before.organizations[0]
        let disk = SnapshotStore(directory: root); try disk.initialize(before)
        let bridge = try WorkspaceStore(directory: root)
        let removed = try bridge.perform(action(org, deleted: true), expectedRevision: before.revision)
        #expect(removed.organizations[0].deletedAt != nil)
        #expect(try WorkspaceStore(directory: root).load().organizations[0].deletedAt != nil)
        let copy = try WorkspaceTransfer.inspect(WorkspaceTransfer.export(removed))
        #expect(copy.organizations[0].deletedAt != nil)
        #expect(copy.attendance == before.attendance)
        #expect(copy.templates == before.templates)
        let result = try bridge.perform(action(org, deleted: false), expectedRevision: removed.revision)
        #expect(result.organizations == before.organizations)
        #expect(result.members == before.members)
        #expect(result.events == before.events)
        #expect(result.attendance == before.attendance)
        #expect(result.templates == before.templates)
    }
    @Test func staleConfirmationAndEditsToTrashLeaveDiskUnchanged() throws {
        let root = try WorkspaceStoreTests().scratch(); defer { try? FileManager.default.removeItem(at: root) }
        let before = try fixture(), org = before.organizations[0]
        let disk = SnapshotStore(directory: root); try disk.initialize(before)
        let bridge = try WorkspaceStore(directory: root)
        let removed = try bridge.perform(action(org, deleted: true), expectedRevision: before.revision)
        let bytes = try Data(contentsOf: disk.primaryURL)
        #expect(throws: (any Error).self) { try bridge.perform(action(org, deleted: true), expectedRevision: removed.revision) }
        #expect(throws: (any Error).self) {
            try bridge.perform(["kind": "attendance", "eventID": before.events[0].id.uuidString,
                                "memberID": before.members[0].id.uuidString, "status": "absent"], expectedRevision: removed.revision)
        }
        #expect(try Data(contentsOf: disk.primaryURL) == bytes)
    }
    @Test func deletionAndRestoreTravelThroughDriveHistoryWithoutDeletingRemoteFiles() throws {
        let root = try WorkspaceStoreTests().scratch(); defer { try? FileManager.default.removeItem(at: root) }
        var before = try fixture(); let org = before.organizations[0]
        try DriveSync.activate(&before, organizationID: org.id, folderID: "synthetic-folder", deviceName: "Mac")
        var other = before
        let disk = SnapshotStore(directory: root); try disk.initialize(before)
        let bridge = try WorkspaceStore(directory: root)
        let removed = try bridge.perform(action(org, deleted: true), expectedRevision: before.revision)
        try DriveSync.receive(removed.driveReplicas[0].outbox, into: &other, organizationID: org.id)
        #expect(other.organizations[0].deletedAt != nil)
        #expect(other.attendance == before.attendance)
        let restored = try bridge.perform(action(org, deleted: false), expectedRevision: removed.revision)
        try DriveSync.receive(restored.driveReplicas[0].outbox, into: &other, organizationID: org.id)
        #expect(other.organizations[0].deletedAt == nil)
        #expect(other.members == before.members)
        #expect(other.templates == before.templates)
    }
    @Test func readOnlyLinkedSpaceCannotBeDeletedEvenWhilePaused() throws {
        let root = try WorkspaceStoreTests().scratch(); defer { try? FileManager.default.removeItem(at: root) }
        var before = try fixture(); let org = before.organizations[0]
        try DriveSync.activate(&before, organizationID: org.id, folderID: "synthetic-folder", deviceName: "Mac")
        before.driveReplicas[0].canEdit = false; before.driveReplicas[0].isPaused = true
        let disk = SnapshotStore(directory: root); try disk.initialize(before)
        let bridge = try WorkspaceStore(directory: root)
        #expect(throws: (any Error).self) { try bridge.perform(action(org, deleted: true), expectedRevision: before.revision) }
        #expect(try bridge.load().organizations[0].deletedAt == nil)
    }
    @Test func concurrentAttendanceEditSurvivesSpaceDeletion() throws {
        var before = try fixture(); let org = before.organizations[0]
        try DriveSync.activate(&before, organizationID: org.id, folderID: "synthetic-folder", deviceName: "Mac")
        var phone = before, mac = before
        try phone.setAttendance(eventID: phone.events[0].id, memberID: phone.members[0].id, status: .present, note: "Llegó")
        try DriveSync.capture(from: before, into: &phone, deviceName: "iPhone")
        mac.organizations[0].deletedAt = Date(timeIntervalSince1970: 1_800_000_000)
        try DriveSync.capture(from: before, into: &mac, deviceName: "Mac")
        try DriveSync.receive(phone.driveReplicas[0].outbox, into: &mac, organizationID: org.id)
        try DriveSync.receive(mac.driveReplicas[0].outbox, into: &phone, organizationID: org.id)
        #expect(mac.organizations[0].deletedAt != nil)
        #expect(phone.organizations[0].deletedAt != nil)
        #expect(mac.attendance[0].status == .present)
        #expect(mac.attendance[0].note == "Llegó")
        #expect(mac.attendance == phone.attendance)
    }
    @Test func legacyOrganizationWithoutTombstoneStillDecodes() throws {
        let legacy = "{\"id\":\"\(UUID())\",\"name\":\"Equipo\",\"accentHex\":\"#262629\",\"timeZoneIdentifier\":\"America/Puerto_Rico\"}"
        #expect(try WorkspaceStore.decoder().decode(Organization.self, from: Data(legacy.utf8)).deletedAt == nil)
    }
}
