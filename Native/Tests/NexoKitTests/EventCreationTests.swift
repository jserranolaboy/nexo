import Foundation
import Testing
import NexoCore
@testable import NexoKit

@MainActor
struct EventCreationTests {
    private func entity(_ event: ActivityEvent) throws -> Any {
        try JSONSerialization.jsonObject(with: WorkspaceStore.encoder().encode(event))
    }

    @Test func eventAndCopiedRosterCommitTogetherInOneRevision() throws {
        let root = try WorkspaceStoreTests().scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = SnapshotStore(directory: root)
        try disk.initialize(WorkspaceStoreTests().fixture())
        let store = try WorkspaceStore(directory: root), before = try store.load()
        var event = before.events[0]
        event.id = UUID(); event.title = "Synthetic duplicate"
        let result = try store.perform(["kind": "addEvent", "entity": try entity(event),
                                        "memberIDs": [before.members[0].id.uuidString]],
                                       expectedRevision: before.revision)
        #expect(result.revision == before.revision + 1)
        #expect(result.events.count == before.events.count + 1)
        let rows = result.attendance.filter { $0.eventID == event.id }
        #expect(rows.count == 1)
        #expect(rows.first?.memberID == before.members[0].id)
        #expect(rows.first?.memberNameSnapshot == before.members[0].name)
        #expect(rows.first?.status == .pending)
        #expect(rows.first?.eventDateSnapshot == event.startsAt)
        #expect(try store.load() == result)
    }

    @Test func invalidRosterNeverLeavesAnEventAndRetryCreatesOnlyOne() throws {
        let root = try WorkspaceStoreTests().scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        var fixture = WorkspaceStoreTests().fixture()
        let foreign = Organization(name: "Synthetic other team")
        let foreignMember = Member(organizationID: foreign.id, name: "Synthetic foreign person")
        var inactive = Member(organizationID: fixture.organizations[0].id, name: "Synthetic inactive person")
        inactive.isActive = false
        fixture.organizations.append(foreign); fixture.members += [foreignMember, inactive]
        let disk = SnapshotStore(directory: root); try disk.initialize(fixture)
        let store = try WorkspaceStore(directory: root), before = try store.load()
        let bytes = try Data(contentsOf: disk.primaryURL)
        var event = before.events[0]; event.id = UUID(); event.title = "Synthetic retry"
        let validID = before.members[0].id.uuidString
        for invalid in [UUID().uuidString, foreignMember.id.uuidString, inactive.id.uuidString, validID] {
            #expect(throws: (any Error).self) {
                try store.perform(["kind": "addEvent", "entity": try entity(event),
                                   "memberIDs": [validID, invalid]], expectedRevision: before.revision)
            }
            #expect(try Data(contentsOf: disk.primaryURL) == bytes)
        }
        let result = try store.perform(["kind": "addEvent", "entity": try entity(event),
                                        "memberIDs": [validID]], expectedRevision: before.revision)
        #expect(result.events.filter { $0.id == event.id }.count == 1)
        #expect(result.attendance.filter { $0.eventID == event.id }.count == 1)
        #expect(result.revision == before.revision + 1)
    }

    @Test func copiedRosterAndEventShareOneDriveBatchAndFailuresPreserveHistory() throws {
        let root = try WorkspaceStoreTests().scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        var fixture = WorkspaceStoreTests().fixture()
        let orgID = fixture.organizations[0].id
        try DriveSync.activate(&fixture, organizationID: orgID, folderID: "synthetic-folder", deviceName: "Synthetic device")
        let disk = SnapshotStore(directory: root); try disk.initialize(fixture)
        let store = try WorkspaceStore(directory: root), before = try store.load()
        let bytes = try Data(contentsOf: disk.primaryURL)
        var event = before.events[0]; event.id = UUID()
        #expect(throws: (any Error).self) {
            try store.perform(["kind": "addEvent", "entity": try entity(event),
                               "memberIDs": [UUID().uuidString]], expectedRevision: before.revision)
        }
        #expect(try Data(contentsOf: disk.primaryURL) == bytes)
        #expect(try store.load().driveReplicas == before.driveReplicas)
        let result = try store.perform(["kind": "addEvent", "entity": try entity(event),
                                        "memberIDs": [before.members[0].id.uuidString]],
                                       expectedRevision: before.revision)
        #expect(result.driveReplicas[0].outbox.count == before.driveReplicas[0].outbox.count + 1)
        let row = try #require(result.attendance.first { $0.eventID == event.id })
        let batch = try #require(result.driveReplicas[0].outbox.last)
        #expect(Set(batch.changes.map(\.key)) == ["event:\(event.id.uuidString)",
                                                  "attendance:\(event.id.uuidString):\(row.memberID.uuidString)",
                                                  "volunteers:\(event.id.uuidString)"])
    }

    @Test func eventCreationWithoutRosterRemainsCompatible() throws {
        let root = try WorkspaceStoreTests().scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = SnapshotStore(directory: root); try disk.initialize(WorkspaceStoreTests().fixture())
        let store = try WorkspaceStore(directory: root)
        for memberIDs: [String]? in [nil, []] {
            let before = try store.load()
            var event = before.events[0]; event.id = UUID()
            var action: [String: Any] = ["kind": "addEvent", "entity": try entity(event)]
            if let memberIDs { action["memberIDs"] = memberIDs }
            let result = try store.perform(action, expectedRevision: before.revision)
            #expect(result.events.count == before.events.count + 1)
            #expect(result.attendance.isEmpty)
        }
    }
}
