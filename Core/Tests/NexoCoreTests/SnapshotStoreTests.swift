import Foundation
import XCTest
@testable import NexoCore

final class SnapshotStoreTests: XCTestCase {
    func testCorruptPrimaryNeverGetsReplacedOnLoadOrSave() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SnapshotStore(directory: directory)
        try store.initialize()
        var snapshot = try store.load()
        snapshot.organizations.append(Organization(name: "Saved"))
        _ = try store.save(snapshot, expectedRevision: 0)
        XCTAssertEqual(try store.availableBackups().count, 2)

        let damaged = Data("{broken".utf8)
        try damaged.write(to: store.primaryURL, options: .atomic)
        XCTAssertThrowsError(try store.load()) { error in
            XCTAssertEqual(error as? SnapshotStoreError, .corruptPrimary)
        }
        XCTAssertThrowsError(try store.save(snapshot, expectedRevision: 1))
        XCTAssertEqual(try Data(contentsOf: store.primaryURL), damaged)

        let backup = try XCTUnwrap(store.availableBackups().first)
        let restored = try store.restoreBackup(at: backup)
        XCTAssertEqual(restored.revision, 2)
        XCTAssertEqual(try store.load().organizations.count, 0)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent(
            try XCTUnwrap(FileManager.default.contentsOfDirectory(atPath: directory.path).first { $0.hasPrefix("pre-restore-") })
        )), damaged)
    }

    func testLatestSavedRevisionCanBeRecoveredAfterPrimaryIsDamaged() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SnapshotStore(directory: directory)
        try store.initialize()
        var proposed = try store.load()
        proposed.organizations.append(Organization(name: "Último cambio"))
        let saved = try store.save(proposed, expectedRevision: 0)
        XCTAssertEqual(saved.revision, 1)

        let latest = try XCTUnwrap(store.availableBackups().last)
        XCTAssertEqual(try store.inspectBackup(at: latest).organizations.first?.name, "Último cambio")
        try Data("damaged".utf8).write(to: store.primaryURL, options: .atomic)
        let recovered = try store.restoreBackup(at: latest)
        var expected = saved
        expected.revision = saved.revision + 1
        XCTAssertEqual(recovered, expected)
        XCTAssertEqual(try store.load(), expected)
        XCTAssertEqual(try store.inspectBackup(at: XCTUnwrap(store.availableBackups().last)), expected)
    }

    func testRejectsStaleRevision() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SnapshotStore(directory: directory)
        try store.initialize()
        let initial = try store.load()
        let saved = try store.save(initial, expectedRevision: 0)
        XCTAssertEqual(saved.revision, 1)
        XCTAssertThrowsError(try store.save(initial, expectedRevision: 0)) { error in
            XCTAssertEqual(error as? SnapshotStoreError, .staleRevision)
        }
    }

    func testExternalCopyCanBeRestoredWhilePreservingCurrentWorkspace() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SnapshotStore(directory: directory.appendingPathComponent("active"))
        try store.initialize()
        var original = try store.load()
        original.organizations.append(Organization(name: "Antes"))
        let first = try store.save(original, expectedRevision: 0)
        let externalCopy = directory.appendingPathComponent("exported.json")
        try FileManager.default.copyItem(at: store.primaryURL, to: externalCopy)

        var changed = first
        changed.organizations[0].name = "Después"
        let second = try store.save(changed, expectedRevision: 1)
        let restored = try store.restoreBackup(at: externalCopy)

        var expected = first
        expected.revision = second.revision + 1
        XCTAssertEqual(restored, expected)
        XCTAssertEqual(try store.load(), expected)
        let preserved = try FileManager.default.contentsOfDirectory(
            at: store.directory, includingPropertiesForKeys: nil
        ).first { $0.lastPathComponent.hasPrefix("pre-restore-") }
        XCTAssertNotNil(preserved)
        if let preserved {
            XCTAssertEqual(try store.inspectBackup(at: preserved), second)
        }
    }

    func testRestoreInvalidatesPreRestoreWritersAfterFurtherEdits() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SnapshotStore(directory: directory)
        try store.initialize()
        var beforeRestore = try store.load()
        beforeRestore.organizations.append(Organization(name: "Before restore"))
        let stale = try store.save(beforeRestore, expectedRevision: 0)
        let originalBackup = try XCTUnwrap(store.availableBackups().first)

        let restored = try store.restoreBackup(at: originalBackup)
        XCTAssertGreaterThan(restored.revision, stale.revision)
        var edited = restored
        edited.organizations.append(Organization(name: "After restore"))
        let saved = try store.save(edited, expectedRevision: restored.revision)

        XCTAssertThrowsError(try store.save(stale, expectedRevision: stale.revision)) {
            XCTAssertEqual($0 as? SnapshotStoreError, .staleRevision)
        }
        XCTAssertEqual(try store.load(), saved)
        XCTAssertEqual(try store.inspectBackup(at: XCTUnwrap(store.availableBackups().last)), saved)
    }

    func testRestoreUsesRetainedRevisionWhenPrimaryIsMissing() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SnapshotStore(directory: directory)
        try store.initialize()
        let first = try store.save(store.load(), expectedRevision: 0)
        let originalBackup = try XCTUnwrap(store.availableBackups().first)
        try FileManager.default.removeItem(at: store.primaryURL)

        let restored = try store.restoreBackup(at: originalBackup)
        XCTAssertEqual(restored.revision, first.revision + 1)
        XCTAssertEqual(try store.load(), restored)
    }

    func testExhaustedRevisionFailsWithoutReplacingPrimary() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SnapshotStore(directory: directory)
        var snapshot = WorkspaceSnapshot()
        snapshot.revision = UInt64.max
        try store.initialize(snapshot)
        let original = try Data(contentsOf: store.primaryURL)

        XCTAssertThrowsError(try store.restoreBackup(at: store.primaryURL)) {
            XCTAssertEqual($0 as? SnapshotStoreError, .revisionExhausted)
        }
        XCTAssertThrowsError(try store.save(snapshot, expectedRevision: snapshot.revision)) {
            XCTAssertEqual($0 as? SnapshotStoreError, .revisionExhausted)
        }
        XCTAssertEqual(try Data(contentsOf: store.primaryURL), original)
        XCTAssertTrue(try store.availableBackups().isEmpty)
    }

    func testCompactionKeepsRecentCopiesAndThinsOlderOnes() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SnapshotStore(directory: directory)
        try store.initialize()
        var revision: UInt64 = 0
        for index in 0..<40 {
            var next = try store.load()
            next.organizations.append(Organization(name: "Espacio \(index)"))
            revision = try store.save(next, expectedRevision: revision).revision
        }
        // Age the oldest copies: ten days ago, all within the same day.
        let old = Date().addingTimeInterval(-10 * 86400)
        for url in try store.availableBackups().prefix(30) {
            try FileManager.default.setAttributes([.modificationDate: old], ofItemAtPath: url.path)
        }
        // 80 copies were written; saving already thinned everything beyond the
        // newest 60 to one per hour.
        let before = try store.availableBackups()
        XCTAssertEqual(before.count, 61)
        let removed = try store.compactBackups(keepingRecent: 50)
        let after = try store.availableBackups()
        XCTAssertEqual(removed, 10)
        XCTAssertEqual(after.count, 51)
        XCTAssertEqual(after.suffix(50), before.suffix(50))
        XCTAssertEqual(try store.load().organizations.count, 40)
    }

    func testInitializeRefusesIntervalsInvalidAfterSerializationWithoutWritingPrimary() throws {
        for membership in [false, true] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: directory) }
            let store = SnapshotStore(directory: directory)
            let proposed = codecIntervalFixture(membership: membership, startOffset: 0.125, endOffset: 0.875)
            try WorkspaceRules.validate(proposed)
            XCTAssertThrowsError(try store.initialize(proposed), "membership=\(membership)") { error in
                XCTAssertEqual(error as? WorkspaceValidationError,
                               membership ? .brokenRelationship : .invalidPeriod)
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: store.primaryURL.path))
            XCTAssertTrue(try store.availableBackups().isEmpty)
        }
    }

    func testSaveRefusesIntervalsInvalidAfterSerializationAndPreservesEverySavedByte() throws {
        for membership in [false, true] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: directory) }
            let store = SnapshotStore(directory: directory)
            try store.initialize()
            let current = try store.save(store.load(), expectedRevision: 0)
            let primary = try Data(contentsOf: store.primaryURL)
            let backups = try codecBackupBytes(store)
            XCTAssertEqual(backups.count, 2)
            var proposed = codecIntervalFixture(membership: membership, startOffset: 0.125, endOffset: 0.875)
            proposed.revision = current.revision
            try WorkspaceRules.validate(proposed)
            XCTAssertThrowsError(try store.save(proposed, expectedRevision: current.revision),
                                 "membership=\(membership)") { error in
                XCTAssertEqual(error as? WorkspaceValidationError,
                               membership ? .brokenRelationship : .invalidPeriod)
            }
            XCTAssertEqual(try Data(contentsOf: store.primaryURL), primary)
            XCTAssertEqual(try codecBackupBytes(store), backups)
            XCTAssertEqual(try store.load(), current)
        }
    }

    func testRepresentableIntervalsStillInitializeSaveAndReloadWithExistingDateEncoding() throws {
        for membership in [false, true] {
            for fractional in [false, true] {
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                defer { try? FileManager.default.removeItem(at: directory) }
                let store = SnapshotStore(directory: directory)
                let initial = codecIntervalFixture(membership: membership,
                                                   startOffset: fractional ? 0.125 : 0,
                                                   endOffset: fractional ? 1.875 : 1)
                try WorkspaceRules.validate(initial)
                // Existing whole-second encoding remains unchanged, not made lossless.
                var expected = initial
                let base = Date(timeIntervalSince1970: 1_790_000_000)
                if membership {
                    expected.memberships[0].startsAt = base
                    expected.memberships[0].endsAt = base.addingTimeInterval(1)
                } else {
                    expected.periods[0].startsAt = base
                    expected.periods[0].endsAt = base.addingTimeInterval(1)
                }
                try store.initialize(initial)
                XCTAssertEqual(try store.load(), expected)
                var proposed = initial
                proposed.organizations[0].name = "Updated synthetic interval"
                let saved = try store.save(proposed, expectedRevision: initial.revision)
                expected.organizations[0].name = proposed.organizations[0].name
                expected.revision = saved.revision
                XCTAssertEqual(try store.load(), expected)
                XCTAssertEqual(try store.availableBackups().count, 2)
            }
        }
    }

    private func codecIntervalFixture(membership: Bool, startOffset: TimeInterval, endOffset: TimeInterval) -> WorkspaceSnapshot {
        let base = Date(timeIntervalSince1970: 1_790_000_000)
        let start = base.addingTimeInterval(startOffset)
        let end = base.addingTimeInterval(endOffset)
        let organization = Organization(name: "Synthetic interval")
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [organization]
        if membership {
            let member = Member(organizationID: organization.id, name: "Synthetic person")
            let group = MemberGroup(organizationID: organization.id, name: "Synthetic group")
            snapshot.members = [member]; snapshot.groups = [group]
            snapshot.memberships = [GroupMembership(memberID: member.id, groupID: group.id,
                                                     startsAt: start, endsAt: end)]
        } else {
            snapshot.periods = [WorkPeriod(organizationID: organization.id, name: "Synthetic period",
                                           startsAt: start, endsAt: end)]
        }
        return snapshot
    }

    private func codecBackupBytes(_ store: SnapshotStore) throws -> [URL: Data] {
        var result: [URL: Data] = [:]
        for url in try store.availableBackups() { result[url] = try Data(contentsOf: url) }
        return result
    }
}
