import Foundation
import Testing
import CoreGraphics
import VRRCore
@testable import ExperienceKit

@MainActor
struct WorkspaceTransferTests {
    @Test func restoreRechecksSyncAfterConfirmationAndNeverReplacesAnActiveStore() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = ExperienceStoreTests().fixture(), org = fixture.organizations[0].id
        let disk = SnapshotStore(directory: root); try disk.initialize(fixture)
        let remote = MemoryDrive(orgID: org), coordinator = DriveCoordinator(store: disk, transport: remote)
        try coordinator.activate(organizationID: org, folderID: "synthetic-folder")
        let backup = try disk.load()
        #expect(!coordinator.syncing) // The initial host check happens before its picker and confirmation.
        var reserved: CheckedContinuation<Void, Never>?
        remote.beforeReserveID = { await withCheckedContinuation { reserved = $0 } }
        let sync = Task { try await coordinator.sync(organizationID: org) }
        while reserved == nil { await Task.yield() }
        let before = try Data(contentsOf: disk.primaryURL)
        #expect(throws: (any Error).self) { try coordinator.restoreWorkspace(backup) }
        #expect(try Data(contentsOf: disk.primaryURL) == before)
        reserved?.resume()
        try await sync.value
        let restored = try coordinator.restoreWorkspace(backup)
        #expect(restored.driveReplicas[0].isPaused == true)
        #expect(restored.driveReplicas[0].outbox.count == 1)
        try await coordinator.syncAvailable()
        #expect(remote.uploaded == 1)
        #expect(try disk.load() == restored)
    }

    func completeFixture() throws -> WorkspaceSnapshot {
        var s = ExperienceStoreTests().fixture()
        let org = s.organizations[0].id, member = s.members[0].id, component = s.components[0].id
        let date = Date(timeIntervalSince1970: 1_790_000_000)
        s.events[0].startsAt = date
        s.periods = [WorkPeriod(organizationID: org, name: "Semestre 1", startsAt: date.addingTimeInterval(-1000), endsAt: date.addingTimeInterval(1000)), WorkPeriod(organizationID: org, name: "Semestre 2", startsAt: date.addingTimeInterval(1000), endsAt: date.addingTimeInterval(2000))]
        let group = MemberGroup(organizationID: org, name: "Junta")
        s.groups = [group]
        s.memberships = [GroupMembership(memberID: member, groupID: group.id, startsAt: date.addingTimeInterval(-2000), endsAt: date.addingTimeInterval(-1500)), GroupMembership(memberID: member, groupID: group.id, startsAt: date.addingTimeInterval(-1000))]
        s.categories = [ActivityCategory(componentID: component, name: "Comunidad")]
        s.events[0].categoryID = s.categories[0].id
        for (i, status) in AttendanceStatus.allCases.enumerated() {
            let person = Member(organizationID: org, name: "Persona \(i) · ñáé 🎓", isActive: i != 0)
            s.members.append(person)
            s.attendance.append(AttendanceEntry(eventID: s.events[0].id, memberID: person.id, status: status, isVoided: i == 0, note: "Nota\ncon acentos", recordedAt: date, memberNameSnapshot: person.name, groupIDsSnapshot: [group.id], eventDateSnapshot: date, componentIDSnapshot: component, categoryIDSnapshot: s.categories[0].id, countsAttendanceSnapshot: true))
        }
        s.volunteers = [VolunteerEntry(eventID: s.events[0].id, memberID: member, status: .completed, registeredAt: date)]
        let bytes = NSMutableData(), consumer = CGDataConsumer(data: bytes)!
        var bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
        let context = CGContext(consumer: consumer, mediaBox: &bounds, nil)!
        for _ in 0..<2 { context.beginPDFPage(nil); context.endPDFPage() }
        context.closePDF()
        let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4V8AAAAASUVORK5CYII=")!
        var template = DocumentTemplate(organizationID: org, name: "Plantilla completa", columns: [.participant, .notes, .signature], rowHeight: 32, headerTitle: "Asistencia", headerSubtitle: "Semestre", footerText: "Página", showsPageNumber: true, columnLabels: ["participant":"Integrante"], textBlocks: [TemplateTextBlock(text: "Texto libre", x: 20, y: 30)], imageBlocks: [TemplateImageBlock(imageData: png, x: 20, y: 60, width: 30, height: 30)], backgroundPDFData: bytes as Data, listPageIndex: 1, tableTopOffset: 140)
        s.templates = [template]
        template.id = UUID(); template.name = "Sin original"; template.backgroundPDFData = nil; template.listPageIndex = nil
        s.templates.append(template)
        return try WorkspaceTransfer.inspect(WorkspaceTransfer.export(s))
    }
    @Test func everyEntityAndEmbeddedAssetSurvivesThreeDeviceRoundTrips() throws {
        let original = try completeFixture()
        var current = original
        for _ in ["Mac", "iPhone", "iPad", "Mac"] {
            current = try WorkspaceTransfer.inspect(WorkspaceTransfer.export(current))
            #expect(current == original)
            #expect(current.templates[0].backgroundPDFData == original.templates[0].backgroundPDFData)
            #expect(current.templates[0].imageBlocks == original.templates[0].imageBlocks)
        }
    }
    @Test func restoreKeepsConflictAlternativesPendingChangesAndPreviousFileWithoutUploading() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        var original = try completeFixture(), other = WorkspaceSnapshot()
        let org = original.organizations[0].id
        try DriveSync.activate(&original, organizationID: org, folderID: "folder", deviceName: "Mac")
        other.driveReplicas = [DriveReplica(organizationID: org, folderID: "folder")]
        try DriveSync.receive(original.driveReplicas[0].outbox, into: &other, organizationID: org)
        let memberID = original.members[0].id
        let before = original; original.members[0].name = "Desde Mac"
        try DriveSync.capture(from: before, into: &original, deviceName: "Mac")
        let otherBefore = other; other.members[other.members.firstIndex { $0.id == memberID }!].name = "Desde iPad"
        try DriveSync.capture(from: otherBefore, into: &other, deviceName: "iPad")
        try DriveSync.receive(other.driveReplicas[0].outbox, into: &original, organizationID: org)
        let normalized = try WorkspaceTransfer.inspect(WorkspaceTransfer.export(original))
        let disk = SnapshotStore(directory: root); try disk.initialize(try completeFixture())
        let previous = try Data(contentsOf: disk.primaryURL)
        let restored = try WorkspaceTransfer.restore(normalized, into: disk)
        var expected = normalized; expected.driveReplicas[0].isPaused = true
        expected.revision += 1
        #expect(restored == expected)
        #expect(restored.driveReplicas[0].conflicts.count == 1)
        #expect(restored.driveReplicas[0].outbox.count == 2)
        let preserved = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).first { $0.lastPathComponent.hasPrefix("pre-restore-") }
        #expect(try Data(contentsOf: #require(preserved)) == previous)
        let remote = MemoryDrive(orgID: org), coordinator = DriveCoordinator(store: disk, transport: remote)
        try await coordinator.syncAvailable()
        #expect(remote.uploaded == 0)
        #expect(try disk.load() == restored)
    }
    @Test func importedPendingChangesDoNotDuplicateAfterAnotherDeviceUploads() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let original = try completeFixture(), org = original.organizations[0].id
        let a = SnapshotStore(directory: root.appendingPathComponent("A")); try a.initialize(original)
        let remote = MemoryDrive(orgID: org), ca = DriveCoordinator(store: a, transport: remote)
        try ca.activate(organizationID: org, folderID: "folder")
        let b = SnapshotStore(directory: root.appendingPathComponent("B")); try b.initialize()
        try WorkspaceTransfer.restore(WorkspaceTransfer.inspect(WorkspaceTransfer.export(a.load())), into: b)
        try await ca.sync(organizationID: org)
        let cb = DriveCoordinator(store: b, transport: remote)
        try cb.setPaused(false, organizationID: org)
        try await cb.sync(organizationID: org)
        #expect(remote.uploaded == 1)
        #expect(try b.load().driveReplicas[0].outbox.isEmpty)
        #expect(try DriveSync.entities(a.load(), organizationID: org) == DriveSync.entities(b.load(), organizationID: org))
        // Two restored devices can acknowledge identical bytes under distinct file IDs.
        let batch = try remote.data.values.first.map { try ExperienceStore.decoder().decode(DriveBatch.self, from: $0) }!
        _ = try await remote.upload(batch, folder: "folder", fileID: "duplicate")
        try await cb.sync(organizationID: org)
        #expect(try b.load().driveReplicas[0].receipts.count == 2)
        #expect(try b.load().members.sorted { $0.id.uuidString < $1.id.uuidString } == a.load().members.sorted { $0.id.uuidString < $1.id.uuidString })
    }
    @Test func inaccessibleSpaceDoesNotBlockAnotherSpace() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        var s = try completeFixture()
        let good = s.organizations[0].id, bad = Organization(name: "Sin acceso")
        s.organizations.append(bad)
        try DriveSync.activate(&s, organizationID: bad.id, folderID: "missing", deviceName: "Mac")
        try DriveSync.activate(&s, organizationID: good, folderID: "available", deviceName: "Mac")
        let disk = SnapshotStore(directory: root); try disk.initialize(s)
        let remote = MemoryDrive(orgID: good); remote.unavailableFolders.insert("missing")
        let coordinator = DriveCoordinator(store: disk, transport: remote)
        try await coordinator.syncAvailable()
        #expect(coordinator.errors[bad.id] != nil)
        #expect(coordinator.errors[good] == nil)
        let result = try disk.load()
        #expect(result.driveReplicas.first { $0.organizationID == bad.id }!.outbox.count == 1)
        #expect(result.driveReplicas.first { $0.organizationID == good }!.outbox.isEmpty)
    }
    @Test func invalidArchiveNeverReplacesExistingData() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = SnapshotStore(directory: root); try disk.initialize(try completeFixture())
        let bytes = try Data(contentsOf: disk.primaryURL)
        var invalid = try disk.load(); invalid.events[0].componentID = UUID()
        #expect(throws: (any Error).self) { try WorkspaceTransfer.restore(invalid, into: disk) }
        #expect(throws: (any Error).self) { try WorkspaceTransfer.inspect(Data(bytes.dropLast(5))) }
        #expect(try Data(contentsOf: disk.primaryURL) == bytes)
    }
    @Test func archiveChecksumDetectsValidJSONEditsAndLegacyCopiesStillOpen() throws {
        let original = try completeFixture()
        let exported = try WorkspaceTransfer.export(original)
        var object = try JSONSerialization.jsonObject(with: exported) as! [String: Any]
        var members = object["members"] as! [[String: Any]]
        members[0]["name"] = "Unexpected change"
        object["members"] = members
        #expect(throws: (any Error).self) { try WorkspaceTransfer.inspect(JSONSerialization.data(withJSONObject: object)) }
        let legacy = try ExperienceStore.encoder().encode(original)
        #expect(try WorkspaceTransfer.inspect(legacy) == original)
        #expect(try ExperienceStore.decoder().decode(WorkspaceSnapshot.self, from: exported) == original)
    }
    @Test func localDraftRecoveryWorksWithoutChangingSavedTemplatesOrCloudHistory() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let original = try completeFixture(), disk = SnapshotStore(directory: root)
        try disk.initialize(original)
        let before = try Data(contentsOf: disk.primaryURL)
        var template = original.templates[0]; template.footerText = "Borrador recuperable"
        let payload = try JSONSerialization.jsonObject(with: ExperienceStore.encoder().encode(template))
        try TemplateDraftStore(directory: root).save(["dirty": true, "organizationID": template.organizationID.uuidString, "template": payload])
        let reopened = try TemplateDraftStore(directory: root).read()
        #expect((reopened?["template"] as? [String: Any])?["footerText"] as? String == "Borrador recuperable")
        #expect(try Data(contentsOf: disk.primaryURL) == before)
        try TemplateDraftStore(directory: root).save(["dirty": false])
        #expect(try TemplateDraftStore(directory: root).read() == nil)
    }

}
