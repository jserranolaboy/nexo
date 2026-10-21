import Foundation
import Testing
import VRRCore
@testable import ExperienceKit

@MainActor
struct ExperienceStoreTests {
    func scratch() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("experience-tests-\(UUID())")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
    func fixture() -> WorkspaceSnapshot {
        let org = Organization(name: "Test Association")
        let component = ActivityComponent(organizationID: org.id, name: "Servicio")
        let member = Member(organizationID: org.id, name: "Ana")
        let event = ActivityEvent(organizationID: org.id, title: "Encuentro", startsAt: .now, componentID: component.id, volunteerCapacity: 1)
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [org]; snapshot.components = [component]; snapshot.members = [member]; snapshot.events = [event]
        return snapshot
    }
    @Test func migrationCopiesValidatedDataAndNeverChangesTheOriginal() throws {
        let root = try scratch(); defer { try? FileManager.default.removeItem(at: root) }
        let source = SnapshotStore(directory: root.appendingPathComponent("Preview"))
        try source.initialize(fixture())
        let originalBytes = try Data(contentsOf: source.primaryURL)
        let destination = root.appendingPathComponent("Experience")
        let bridge = try ExperienceStore(directory: destination, previewDirectory: source.directory)
        #expect(bridge.copiedPreview)
        let before = try bridge.load()
        let after = try bridge.perform(["kind": "addMember", "id": UUID().uuidString, "organizationID": before.organizations[0].id.uuidString, "name": "Bea"], expectedRevision: before.revision)
        #expect(after.members.count == 2)
        #expect(try Data(contentsOf: source.primaryURL) == originalBytes)
        #expect(try ExperienceStore(directory: destination, previewDirectory: source.directory).load().members.count == 2)
    }
    @Test func failedBatchAndStaleClientLeaveDiskUnchanged() throws {
        let root = try scratch(); defer { try? FileManager.default.removeItem(at: root) }
        let disk = SnapshotStore(directory: root); try disk.initialize(fixture())
        let bridge = try ExperienceStore(directory: root), snapshot = try bridge.load()
        let bytes = try Data(contentsOf: disk.primaryURL)
        #expect(throws: (any Error).self) {
            try bridge.perform(["kind": "roster", "eventID": snapshot.events[0].id.uuidString, "memberIDs": [snapshot.members[0].id.uuidString, UUID().uuidString]], expectedRevision: 0)
        }
        #expect(try Data(contentsOf: disk.primaryURL) == bytes)
        #expect(throws: (any Error).self) {
            try bridge.perform(["kind": "addMember", "id": UUID().uuidString, "organizationID": snapshot.organizations[0].id.uuidString, "name": "Bea"], expectedRevision: 99)
        }
        #expect(try Data(contentsOf: disk.primaryURL) == bytes)
    }
    @Test func attendanceAndExclusionRoundTripThroughTheNativeBridge() throws {
        let root = try scratch(); defer { try? FileManager.default.removeItem(at: root) }
        let disk = SnapshotStore(directory: root); try disk.initialize(fixture())
        let bridge = try ExperienceStore(directory: root), snapshot = try bridge.load()
        let event = snapshot.events[0].id.uuidString, person = snapshot.members[0].id.uuidString
        var result = try bridge.perform(["kind": "roster", "eventID": event, "memberIDs": [person]], expectedRevision: 0)
        result = try bridge.perform(["kind": "attendance", "eventID": event, "memberID": person, "status": "excused", "note": "Avisó"], expectedRevision: result.revision)
        #expect(result.attendance[0].status == .excused)
        #expect(result.attendance[0].memberNameSnapshot == "Ana")
        result = try bridge.perform(["kind": "inclusion", "eventID": event, "memberID": person, "included": false], expectedRevision: result.revision)
        #expect(result.attendance[0].isVoided)
        result = try bridge.perform(["kind": "inclusion", "eventID": event, "memberID": person, "included": true], expectedRevision: result.revision)
        #expect(!result.attendance[0].isVoided)
        #expect(result.attendance[0].note == "Avisó")
        #expect(result.attendance[0].status == .excused)
        #expect(try disk.availableBackups().count == 8)
    }
    @Test func corruptOrMissingPrimaryWithBackupsNeverCreatesAnEmptySpace() throws {
        let root = try scratch(); defer { try? FileManager.default.removeItem(at: root) }
        let bridge = try ExperienceStore(directory: root)
        _ = try bridge.perform(["kind": "createOrganization", "id": UUID().uuidString, "name": "Equipo"], expectedRevision: 0)
        let bad = Data("corrupt bytes".utf8)
        try bad.write(to: bridge.store.primaryURL)
        #expect(throws: (any Error).self) { try ExperienceStore(directory: root) }
        #expect(try Data(contentsOf: bridge.store.primaryURL) == bad)
        try FileManager.default.removeItem(at: bridge.store.primaryURL)
        #expect(throws: (any Error).self) { try ExperienceStore(directory: root) }
        #expect(!FileManager.default.fileExists(atPath: bridge.store.primaryURL.path))
    }
    @Test func staleAttendanceUndoCannotOverwriteANewerState() throws {
        let root = try scratch(); defer { try? FileManager.default.removeItem(at: root) }
        let disk = SnapshotStore(directory: root); try disk.initialize(fixture())
        let bridge = try ExperienceStore(directory: root), snapshot = try bridge.load()
        let event = snapshot.events[0].id.uuidString, person = snapshot.members[0].id.uuidString
        var result = try bridge.perform(["kind": "roster", "eventID": event, "memberIDs": [person]], expectedRevision: 0)
        result = try bridge.perform(["kind": "attendance", "eventID": event, "memberID": person, "status": "present", "expectedStatus": "pending"], expectedRevision: result.revision)
        result = try bridge.perform(["kind": "attendance", "eventID": event, "memberID": person, "status": "excused", "expectedStatus": "present", "note": "Avisó"], expectedRevision: result.revision)
        let before = try Data(contentsOf: disk.primaryURL)
        #expect(throws: (any Error).self) {
            try bridge.perform(["kind": "attendance", "eventID": event, "memberID": person, "status": "pending", "expectedStatus": "present"], expectedRevision: result.revision)
        }
        #expect(try Data(contentsOf: disk.primaryURL) == before)
        #expect(try bridge.load().attendance[0].status == .excused)
        #expect(try bridge.load().attendance[0].note == "Avisó")
    }
    @Test func changingGroupsKeepsPreviousMembershipsAndRejectsForeignGroups() throws {
        let root = try scratch(); defer { try? FileManager.default.removeItem(at: root) }
        var snapshot = fixture()
        let previous = MemberGroup(organizationID: snapshot.organizations[0].id, name: "Anterior")
        let next = MemberGroup(organizationID: snapshot.organizations[0].id, name: "Actual")
        let foreignOrg = Organization(name: "Otro espacio")
        let foreign = MemberGroup(organizationID: foreignOrg.id, name: "Otro grupo")
        snapshot.organizations.append(foreignOrg); snapshot.groups = [previous, next, foreign]
        snapshot.memberships = [GroupMembership(memberID: snapshot.members[0].id, groupID: previous.id, startsAt: .distantPast)]
        let disk = SnapshotStore(directory: root); try disk.initialize(snapshot)
        let bridge = try ExperienceStore(directory: root)
        let result = try bridge.perform(["kind": "memberGroups", "memberID": snapshot.members[0].id.uuidString, "groupIDs": [next.id.uuidString]], expectedRevision: 0)
        #expect(result.memberships.count == 2)
        #expect(result.memberships.first { $0.groupID == previous.id }?.endsAt != nil)
        #expect(result.memberships.first { $0.groupID == next.id }?.endsAt == nil)
        #expect(throws: (any Error).self) {
            try bridge.perform(["kind": "memberGroups", "memberID": snapshot.members[0].id.uuidString, "groupIDs": [foreign.id.uuidString]], expectedRevision: result.revision)
        }
        #expect(try disk.load().revision == result.revision)
    }
    @Test func decodesJavaScriptFractionalDates() throws {
        let data = Data("\"2026-10-03T17:00:00.123Z\"".utf8)
        let date = try ExperienceStore.decoder().decode(Date.self, from: data)
        #expect(abs(date.timeIntervalSince1970 - 1791046800.123) < 0.001)
    }
    @Test func openEditorsCannotOverwriteNewerNamesNotesOrTemplates() throws {
        let root = try scratch(); defer { try? FileManager.default.removeItem(at: root) }
        var initial = fixture()
        let template = DocumentTemplate(organizationID: initial.organizations[0].id, name: "Original")
        initial.templates = [template]
        let disk = SnapshotStore(directory: root); try disk.initialize(initial)
        let bridge = try ExperienceStore(directory: root), member = initial.members[0].id.uuidString, event = initial.events[0].id.uuidString
        _ = try bridge.perform(["kind":"updateMember", "memberID":member, "name":"Nombre nuevo"], expectedRevision:bridge.load().revision)
        #expect(throws:(any Error).self) {
            try bridge.perform(["kind":"updateMember", "memberID":member, "name":"Edición antigua", "expectedName":"Ana"], expectedRevision:bridge.load().revision)
        }
        _ = try bridge.perform(["kind":"roster", "eventID":event, "memberIDs":[member]], expectedRevision:bridge.load().revision)
        _ = try bridge.perform(["kind":"attendance", "eventID":event, "memberID":member, "status":"present", "note":"Nota nueva"], expectedRevision:bridge.load().revision)
        #expect(throws:(any Error).self) {
            try bridge.perform(["kind":"attendance", "eventID":event, "memberID":member, "status":"pending", "note":"Nota antigua", "expectedNote":"", "noteOnly":true], expectedRevision:bridge.load().revision)
        }
        _ = try bridge.perform(["kind":"attendance", "eventID":event, "memberID":member, "status":"pending", "note":"Nota revisada", "expectedNote":"Nota nueva", "noteOnly":true], expectedRevision:bridge.load().revision)
        #expect(try bridge.load().attendance[0].status == .present)
        func object(_ value: DocumentTemplate) throws -> Any { try JSONSerialization.jsonObject(with: ExperienceStore.encoder().encode(value)) }
        var revised = template; revised.name = "Versión nueva"
        _ = try bridge.perform(["kind":"saveTemplate", "entity":try object(revised)], expectedRevision:bridge.load().revision)
        let bytes = try Data(contentsOf: disk.primaryURL)
        #expect(throws:(any Error).self) {
            try bridge.perform(["kind":"saveTemplate", "entity":try object(template), "expectedTemplate":try object(template)], expectedRevision:bridge.load().revision)
        }
        #expect(try Data(contentsOf:disk.primaryURL) == bytes)
    }
    @Test func editingAnEventUpdatesItsAttendanceAndRenamingKeepsIDs() throws {
        let root = try scratch(); defer { try? FileManager.default.removeItem(at: root) }
        let disk = SnapshotStore(directory: root); try disk.initialize(fixture())
        let bridge = try ExperienceStore(directory: root), initial = try bridge.load()
        let event = initial.events[0], member = initial.members[0].id.uuidString
        var result = try bridge.perform(["kind":"roster", "eventID":event.id.uuidString, "memberIDs":[member]], expectedRevision:initial.revision)
        result = try bridge.perform(["kind":"attendance", "eventID":event.id.uuidString, "memberID":member, "status":"present"], expectedRevision:result.revision)
        func object(_ value: ActivityEvent) throws -> Any { try JSONSerialization.jsonObject(with: ExperienceStore.encoder().encode(value)) }
        var edited = event; edited.title = "Encuentro movido"; edited.countsAttendance = false
        edited.startsAt = event.startsAt.addingTimeInterval(86400)
        result = try bridge.perform(["kind":"updateEvent", "entity":try object(edited)], expectedRevision:result.revision)
        #expect(result.events[0].title == "Encuentro movido")
        #expect(result.attendance[0].countsAttendanceSnapshot == false)
        #expect(result.attendance[0].status == .present)
        var empty = edited; empty.title = "  "
        #expect(throws:(any Error).self) { try bridge.perform(["kind":"updateEvent", "entity":try object(empty)], expectedRevision:result.revision) }
        result = try bridge.perform(["kind":"rename", "entity":"component", "id":event.componentID.uuidString, "name":"Servicio comunitario"], expectedRevision:bridge.load().revision)
        #expect(result.components[0].name == "Servicio comunitario")
        #expect(result.components[0].id == event.componentID)
        result = try bridge.perform(["kind":"createOrganization", "id":UUID().uuidString, "name":"Nuevo"], expectedRevision:result.revision)
        #expect(result.periods.isEmpty)
    }
}
