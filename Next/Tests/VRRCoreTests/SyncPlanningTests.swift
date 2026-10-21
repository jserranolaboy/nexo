import Foundation
import XCTest
@testable import VRRCore

final class SyncPlanningTests: XCTestCase {
    func testActivationQueuesEntitiesInDependencyOrderAndPersistsOffline() throws {
        let org = Organization(name: "Asociación")
        let date = Date(timeIntervalSince1970: 1_790_000_000)
        let period = WorkPeriod(organizationID: org.id, name: "Semestre",
                                startsAt: date, endsAt: date.addingTimeInterval(100_000))
        let member = Member(organizationID: org.id, name: "Ana")
        let component = ActivityComponent(organizationID: org.id, name: "Servicio")
        let category = ActivityCategory(componentID: component.id, name: "Clínicas")
        let event = ActivityEvent(organizationID: org.id, title: "Jornada", startsAt: date,
                                  componentID: component.id, categoryID: category.id,
                                  volunteerCapacity: 1)
        let attendance = AttendanceEntry(eventID: event.id, memberID: member.id)
        let volunteer = VolunteerEntry(eventID: event.id, memberID: member.id, status: .completed)
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [org]
        snapshot.periods = [period]
        snapshot.members = [member]
        snapshot.components = [component]
        snapshot.categories = [category]
        snapshot.events = [event]
        snapshot.attendance = [attendance]
        snapshot.volunteers = [volunteer]
        try WorkspaceRules.validate(snapshot)

        try SyncPlanner.activate(&snapshot, organizationID: org.id)
        let state = try XCTUnwrap(snapshot.syncStates.first)
        XCTAssertFalse(state.remoteCreated)
        XCTAssertEqual(state.pending.map(\.kind), [
            .period, .member, .component, .category, .event, .attendance,
            .volunteer, .volunteer, .volunteer
        ])
        let volunteerMutations = state.pending.filter { $0.kind == .volunteer }
        XCTAssertEqual(volunteerMutations.map(\.expectedRevision), [nil, 1, 2])
        XCTAssertEqual(volunteerMutations.map { $0.payload["status"] }, [
            .string("interested"), .string("selected"), .string("completed")
        ])

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SnapshotStore(directory: directory)
        try store.initialize(snapshot)
        let reloaded = try store.load()
        XCTAssertEqual(reloaded.syncStates[0].creationMutationID, state.creationMutationID)
        XCTAssertEqual(reloaded.syncStates[0].pending.map(\.id), state.pending.map(\.id))
        XCTAssertEqual(reloaded.syncStates[0].pending.map(\.payload), state.pending.map(\.payload))
    }

    func testOfflineEditsKeepMutationIDsAndChainExpectedRevisions() throws {
        let org = Organization(name: "Asociación")
        let component = ActivityComponent(organizationID: org.id, name: "Servicio")
        let member = Member(organizationID: org.id, name: "Ana")
        let event = ActivityEvent(organizationID: org.id, title: "Reunión", startsAt: .now,
                                  componentID: component.id)
        var initial = WorkspaceSnapshot()
        initial.organizations = [org]
        initial.components = [component]
        initial.members = [member]
        initial.events = [event]
        try SyncPlanner.activate(&initial, organizationID: org.id)

        var withAttendance = initial
        withAttendance.attendance = [AttendanceEntry(eventID: event.id, memberID: member.id)]
        try SyncPlanner.captureChanges(from: initial, into: &withAttendance)
        let first = try XCTUnwrap(withAttendance.syncStates[0].pending.last)
        XCTAssertEqual(first.kind, .attendance)
        XCTAssertNil(first.expectedRevision)

        var marked = withAttendance
        marked.attendance[0].status = .present
        try SyncPlanner.captureChanges(from: withAttendance, into: &marked)
        let second = try XCTUnwrap(marked.syncStates[0].pending.last)
        XCTAssertEqual(second.expectedRevision, 1)
        XCTAssertNotEqual(first.id, second.id)
        XCTAssertEqual(marked.syncStates[0].pending.first { $0.id == first.id }, first)

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SnapshotStore(directory: directory)
        try store.initialize(initial)
        let saved = try store.save(marked, expectedRevision: 0)
        XCTAssertEqual(try store.load().syncStates[0].pending.last?.id, second.id)
        XCTAssertEqual(saved.syncStates[0].pending.last?.id, second.id)
    }

    func testAcknowledgementRequiresFirstMutationAndExactRevision() throws {
        let org = Organization(name: "Asociación")
        let member = Member(organizationID: org.id, name: "Ana")
        var state = OrganizationSyncState(organizationID: org.id)
        try state.stage(member, kind: .member, id: member.id)
        var renamed = member
        renamed.name = "Ana Rivera"
        try state.stage(renamed, kind: .member, id: member.id)
        let first = state.pending[0].id
        let second = state.pending[1].id
        XCTAssertThrowsError(try state.acknowledge(second, revision: 2))
        XCTAssertThrowsError(try state.acknowledge(first, revision: 2))
        try state.acknowledge(first, revision: 1)
        try state.acknowledge(second, revision: 2)
        XCTAssertTrue(state.pending.isEmpty)
        XCTAssertEqual(state.revisions[OrganizationSyncState.key(.member, member.id)], 2)
    }

    func testSecondMacJoinsExistingAssociationAndReaderCannotQueueEdits() throws {
        let remote = RemoteOrganization(id: UUID(), name: "Equipo compartido",
                                        timeZone: "America/Puerto_Rico", role: "reader")
        var snapshot = WorkspaceSnapshot()
        try SyncPlanner.join(&snapshot, remote: remote)
        XCTAssertEqual(snapshot.organizations[0].id, remote.id)
        XCTAssertEqual(snapshot.syncStates[0].role, .reader)
        XCTAssertTrue(snapshot.syncStates[0].remoteCreated)
        XCTAssertTrue(snapshot.syncStates[0].pending.isEmpty)

        var edited = snapshot
        edited.members.append(Member(organizationID: remote.id, name: "Ana"))
        XCTAssertThrowsError(try SyncPlanner.captureChanges(from: snapshot, into: &edited)) {
            XCTAssertEqual($0 as? SyncPlanningError, .readOnlyAssociation)
        }
        XCTAssertTrue(snapshot.members.isEmpty)
        XCTAssertThrowsError(try SyncPlanner.join(&snapshot, remote: remote)) {
            XCTAssertEqual($0 as? SyncPlanningError, .organizationAlreadyExists)
        }
    }

    func testOfflineVolunteerCompletionStagesRequiredSelectionAndRejectsReversal() throws {
        let org = Organization(name: "Asociación")
        let component = ActivityComponent(organizationID: org.id, name: "Servicio")
        let member = Member(organizationID: org.id, name: "Ana")
        let event = ActivityEvent(organizationID: org.id, title: "Jornada", startsAt: .now,
                                  componentID: component.id, volunteerCapacity: 1)
        let volunteer = VolunteerEntry(eventID: event.id, memberID: member.id)
        var previous = WorkspaceSnapshot()
        previous.organizations = [org]
        previous.components = [component]
        previous.members = [member]
        previous.events = [event]
        previous.volunteers = [volunteer]
        try SyncPlanner.activate(&previous, organizationID: org.id)

        var completed = previous
        completed.volunteers[0].status = .completed
        try SyncPlanner.captureChanges(from: previous, into: &completed)
        let statuses = completed.syncStates[0].pending.compactMap { mutation -> JSONValue? in
            mutation.kind == .volunteer ? mutation.payload["status"] : nil
        }
        XCTAssertEqual(statuses, [.string("interested"), .string("selected"), .string("completed")])
        XCTAssertEqual(completed.syncStates[0].pending.filter { $0.kind == .volunteer }
            .map(\.expectedRevision), [nil, 1, 2])

        var reversed = completed
        reversed.volunteers[0].status = .interested
        XCTAssertThrowsError(try SyncPlanner.captureChanges(from: completed, into: &reversed)) {
            XCTAssertEqual($0 as? SyncPlanningError, .invalidVolunteerTransition)
        }
    }
}
