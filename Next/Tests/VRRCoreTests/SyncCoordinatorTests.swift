import Foundation
import XCTest
@testable import VRRCore

private actor FakeSyncTransport: SyncTransport {
    enum Mode { case loseFirstResponse, conflict, remotePage(RemoteChangePage) }
    let mode: Mode
    private var putIDs: [UUID] = []

    init(mode: Mode) { self.mode = mode }

    func createOrganization(id: UUID, mutationID: UUID, name: String,
                            timeZone: String) async throws -> CreatedRemoteOrganization {
        CreatedRemoteOrganization(id: id, name: name, timeZone: timeZone)
    }

    func put(organizationID: UUID, kind: String, entityID: UUID,
             payload: [String: JSONValue], expectedRevision: Int?,
             mutationID: UUID) async throws -> RemoteAcknowledgement {
        putIDs.append(mutationID)
        switch mode {
        case .loseFirstResponse where putIDs.count == 1:
            throw URLError(.timedOut)
        case .conflict:
            throw RemoteWorkspaceError.revisionConflict(
                revision: 2, payload: ["name": .string("Cambio de otro Mac")]
            )
        default:
            return RemoteAcknowledgement(
                id: entityID, kind: kind,
                revision: (expectedRevision ?? 0) + 1, payload: payload
            )
        }
    }

    func changes(organizationID: UUID, after cursor: Int) async throws -> RemoteChangePage {
        if case let .remotePage(page) = mode, cursor < page.cursor { return page }
        return RemoteChangePage(cursor: cursor, changes: [])
    }

    func recordedIDs() -> [UUID] { putIDs }
}

@MainActor
final class SyncCoordinatorTests: XCTestCase {
    private func storeWithOneQueuedMember() throws -> (SnapshotStore, UUID, UUID, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = SnapshotStore(directory: directory)
        let org = Organization(name: "Asociación")
        let member = Member(organizationID: org.id, name: "Ana")
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [org]
        snapshot.members = [member]
        try SyncPlanner.activate(&snapshot, organizationID: org.id)
        try store.initialize(snapshot)
        return (store, org.id, snapshot.syncStates[0].pending[0].id, directory)
    }

    func testLostResponseRetriesSameMutationAfterRestart() async throws {
        let (store, organizationID, mutationID, directory) = try storeWithOneQueuedMember()
        defer { try? FileManager.default.removeItem(at: directory) }
        let remote = FakeSyncTransport(mode: .loseFirstResponse)
        let firstCoordinator = SyncCoordinator(store: store, remote: remote)
        do {
            _ = try await firstCoordinator.upload(organizationID: organizationID)
            XCTFail("The first response should be lost")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .timedOut)
        }
        XCTAssertEqual(try store.load().syncStates[0].pending[0].id, mutationID)
        XCTAssertTrue(try store.load().syncStates[0].remoteCreated)

        let restartedCoordinator = SyncCoordinator(store: store, remote: remote)
        let result = try await restartedCoordinator.upload(organizationID: organizationID)
        let recordedIDs = await remote.recordedIDs()
        XCTAssertEqual(result, .synchronized)
        XCTAssertEqual(recordedIDs, [mutationID, mutationID])
        XCTAssertTrue(try store.load().syncStates[0].pending.isEmpty)
    }

    func testConflictPreservesLocalMutationAndRemoteValue() async throws {
        let (store, organizationID, mutationID, directory) = try storeWithOneQueuedMember()
        defer { try? FileManager.default.removeItem(at: directory) }
        let remote = FakeSyncTransport(mode: .conflict)
        let coordinator = SyncCoordinator(store: store, remote: remote)
        let firstResult = try await coordinator.upload(organizationID: organizationID)
        XCTAssertEqual(firstResult, .needsAttention)
        let state = try store.load().syncStates[0]
        XCTAssertEqual(state.pending.first?.id, mutationID)
        XCTAssertEqual(state.conflicts.first?.mutationID, mutationID)
        XCTAssertEqual(state.conflicts.first?.serverRevision, 2)
        XCTAssertEqual(state.conflicts.first?.serverPayload?["name"],
                       .string("Cambio de otro Mac"))
        let secondResult = try await coordinator.upload(organizationID: organizationID)
        let recordedIDs = await remote.recordedIDs()
        XCTAssertEqual(secondResult, .needsAttention)
        XCTAssertEqual(recordedIDs, [mutationID])
    }

    func testDownloadAppliesRemoteChangesAndAdvancesCursorTogether() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let org = Organization(name: "Asociación")
        let member = Member(organizationID: org.id, name: "Nombre anterior")
        let component = ActivityComponent(organizationID: org.id, name: "Servicio")
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [org]
        snapshot.members = [member]
        snapshot.components = [component]
        var state = OrganizationSyncState(organizationID: org.id)
        state.remoteCreated = true
        state.revisions[OrganizationSyncState.key(.member, member.id)] = 1
        snapshot.syncStates = [state]
        let store = SnapshotStore(directory: directory)
        try store.initialize(snapshot)

        let eventID = UUID()
        let memberChange = RemoteChange(
            cursor: 5, kind: "member", id: member.id, revision: 2,
            payload: ["name": .string("Cambio de otro Mac"), "isActive": .bool(true)],
            before: nil, mutationID: UUID(), changedAt: nil, actor: "coordinator"
        )
        let eventChange = RemoteChange(
            cursor: 6, kind: "event", id: eventID, revision: 1,
            payload: [
                "title": .string("Jornada"),
                "startsAt": .string("2026-10-05T18:00:00.123456+00:00"),
                "componentID": .string(component.id.uuidString),
                "categoryID": .null, "countsAttendance": .bool(true),
                "isCancelled": .bool(false), "volunteerCapacity": .null,
            ], before: nil, mutationID: UUID(), changedAt: nil, actor: "coordinator"
        )
        let remote = FakeSyncTransport(mode: .remotePage(
            RemoteChangePage(cursor: 6, changes: [memberChange, eventChange])
        ))
        let result = try await SyncCoordinator(store: store, remote: remote)
            .download(organizationID: org.id)
        XCTAssertEqual(result, SyncDownloadResult(received: 2, conflicts: 0))
        let reloaded = try store.load()
        XCTAssertEqual(reloaded.members[0].name, "Cambio de otro Mac")
        XCTAssertEqual(reloaded.events[0].id, eventID)
        XCTAssertEqual(reloaded.syncStates[0].cursor, 6)
        XCTAssertEqual(reloaded.syncStates[0].revisions[
            OrganizationSyncState.key(.event, eventID)], 1)
    }

    func testDownloadKeepsPendingLocalEditWhenAnotherMacChangesSameMember() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let org = Organization(name: "Asociación")
        let member = Member(organizationID: org.id, name: "Mi edición")
        var state = OrganizationSyncState(organizationID: org.id)
        state.remoteCreated = true
        state.revisions[OrganizationSyncState.key(.member, member.id)] = 1
        try state.stage(member, kind: .member, id: member.id)
        let mutationID = state.pending[0].id
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [org]
        snapshot.members = [member]
        snapshot.syncStates = [state]
        let store = SnapshotStore(directory: directory)
        try store.initialize(snapshot)

        let change = RemoteChange(
            cursor: 2, kind: "member", id: member.id, revision: 2,
            payload: ["name": .string("Edición del otro Mac"), "isActive": .bool(true)],
            before: nil, mutationID: UUID(), changedAt: nil, actor: "other"
        )
        let remote = FakeSyncTransport(mode: .remotePage(
            RemoteChangePage(cursor: 2, changes: [change])
        ))
        let result = try await SyncCoordinator(store: store, remote: remote)
            .download(organizationID: org.id)
        XCTAssertEqual(result, SyncDownloadResult(received: 1, conflicts: 1))
        let reloaded = try store.load()
        XCTAssertEqual(reloaded.members[0].name, "Mi edición")
        XCTAssertEqual(reloaded.syncStates[0].pending[0].id, mutationID)
        XCTAssertEqual(reloaded.syncStates[0].conflicts[0].serverPayload?["name"],
                       .string("Edición del otro Mac"))
        XCTAssertEqual(reloaded.syncStates[0].cursor, 2)
    }

    func testConflictResolutionKeepsBothVersionsAndRebasesLocalChoice() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let org = Organization(name: "Asociación")
        var member = Member(organizationID: org.id, name: "Mi versión final")
        var state = OrganizationSyncState(organizationID: org.id)
        state.remoteCreated = true
        let key = OrganizationSyncState.key(.member, member.id)
        state.revisions[key] = 1
        member.name = "Mi primera edición"
        try state.stage(member, kind: .member, id: member.id)
        member.name = "Mi versión final"
        try state.stage(member, kind: .member, id: member.id)
        let oldIDs = state.pending.map(\.id)
        let remotePayload: [String: JSONValue] = ["name": .string("Versión del servidor"),
                                                  "isActive": .bool(true)]
        try state.recordConflict(for: oldIDs[0], revision: 3, payload: remotePayload)
        let conflictID = try XCTUnwrap(state.conflicts.first?.id)
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [org]
        snapshot.members = [member]
        snapshot.syncStates = [state]

        var serverChoice = snapshot
        try SyncConflictResolver.resolve(&serverChoice, organizationID: org.id,
                                         conflictID: conflictID, choice: .useServer)
        XCTAssertEqual(serverChoice.members[0].name, "Versión del servidor")
        XCTAssertTrue(serverChoice.syncStates[0].pending.isEmpty)
        XCTAssertTrue(serverChoice.syncStates[0].conflicts.isEmpty)
        XCTAssertEqual(serverChoice.resolvedSyncConflicts[0].localPayload["name"],
                       .string("Mi versión final"))
        XCTAssertEqual(serverChoice.resolvedSyncConflicts[0].serverPayload, remotePayload)

        try SyncConflictResolver.resolve(&snapshot, organizationID: org.id,
                                         conflictID: conflictID, choice: .keepLocal)
        XCTAssertEqual(snapshot.members[0].name, "Mi versión final")
        XCTAssertEqual(snapshot.syncStates[0].pending.count, 1)
        XCTAssertEqual(snapshot.syncStates[0].pending[0].expectedRevision, 3)
        XCTAssertFalse(oldIDs.contains(snapshot.syncStates[0].pending[0].id))
        XCTAssertEqual(snapshot.resolvedSyncConflicts[0].discardedMutationIDs, oldIDs)

        let store = SnapshotStore(directory: directory)
        try store.initialize(snapshot)
        let remote = FakeSyncTransport(mode: .remotePage(RemoteChangePage(cursor: 0, changes: [])))
        let result = try await SyncCoordinator(store: store, remote: remote).upload(organizationID: org.id)
        XCTAssertEqual(result, .synchronized)
        let persisted = try store.load()
        XCTAssertTrue(persisted.syncStates[0].pending.isEmpty)
        XCTAssertEqual(persisted.syncStates[0].revisions[key], 4)
        XCTAssertEqual(persisted.resolvedSyncConflicts[0].serverPayload, remotePayload)
    }

    func testConflictResolutionRefusesIncompleteServerValueWithoutEditingLocal() throws {
        let org = Organization(name: "Asociación")
        let member = Member(organizationID: org.id, name: "Mi versión")
        var state = OrganizationSyncState(organizationID: org.id)
        state.remoteCreated = true
        try state.stage(member, kind: .member, id: member.id)
        try state.recordConflict(for: state.pending[0].id, revision: nil, payload: nil)
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [org]
        snapshot.members = [member]
        snapshot.syncStates = [state]
        let original = snapshot
        XCTAssertThrowsError(try SyncConflictResolver.resolve(&snapshot, organizationID: org.id,
                                                               conflictID: state.conflicts[0].id,
                                                               choice: .useServer)) {
            XCTAssertEqual($0 as? SyncResolutionError, .serverValueUnavailable)
        }
        XCTAssertEqual(snapshot, original)
    }
}
