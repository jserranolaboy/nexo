import Foundation
import XCTest
@testable import VRRCore

final class WorkspaceRulesTests: XCTestCase {
    private let day: TimeInterval = 86_400

    func testIndividualPercentageExcludesExcusedPendingAndOtherPeriods() throws {
        let organization = Organization(name: "Asociación")
        let person = Member(organizationID: organization.id, name: "Ana")
        let component = ActivityComponent(organizationID: organization.id, name: "Formación")
        let other = ActivityComponent(organizationID: organization.id, name: "Servicio")
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let period = WorkPeriod(organizationID: organization.id, name: "Semestre", startsAt: start, endsAt: start.addingTimeInterval(10 * day))
        let statuses: [AttendanceStatus] = [.present, .present, .present, .absent, .excused, .pending]
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [organization]
        snapshot.periods = [period]
        snapshot.members = [person]
        snapshot.components = [component, other]
        snapshot.events = statuses.enumerated().map { index, _ in
            ActivityEvent(organizationID: organization.id, title: "Evento \(index)", startsAt: start.addingTimeInterval(Double(index) * day), componentID: component.id)
        }
        snapshot.events.append(ActivityEvent(organizationID: organization.id, title: "Después", startsAt: period.endsAt, componentID: component.id))
        snapshot.events.append(ActivityEvent(organizationID: organization.id, title: "Otro", startsAt: start, componentID: other.id))
        snapshot.attendance = zip(snapshot.events.prefix(statuses.count), statuses).map { event, status in
            AttendanceEntry(eventID: event.id, memberID: person.id, status: status)
        }
        snapshot.attendance.append(AttendanceEntry(eventID: snapshot.events[6].id, memberID: person.id, status: .absent))
        snapshot.attendance.append(AttendanceEntry(eventID: snapshot.events[7].id, memberID: person.id, status: .absent))
        try WorkspaceRules.validate(snapshot)

        let result = WorkspaceRules.attendance(for: person.id, in: period, componentID: component.id, snapshot: snapshot)
        XCTAssertEqual(result.present, 3)
        XCTAssertEqual(result.absent, 1)
        XCTAssertEqual(result.excused, 1)
        XCTAssertEqual(result.pending, 1)
        XCTAssertEqual(result.countedEvents, 4)
        XCTAssertEqual(result.percentage, 0.75)
    }

    func testVolunteerOrderUsesCompletedCategoryParticipationInCurrentPeriod() throws {
        let organization = Organization(name: "Asociación")
        let component = ActivityComponent(organizationID: organization.id, name: "Servicio")
        let category = ActivityCategory(componentID: component.id, name: "Clínicas")
        let otherCategory = ActivityCategory(componentID: component.id, name: "Ferias")
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let period = WorkPeriod(organizationID: organization.id, name: "Semestre", startsAt: start, endsAt: start.addingTimeInterval(30 * day))
        let target = ActivityEvent(organizationID: organization.id, title: "Clínica", startsAt: start.addingTimeInterval(20 * day), componentID: component.id, categoryID: category.id, volunteerCapacity: 2)
        let prior = ActivityEvent(organizationID: organization.id, title: "Clínica previa", startsAt: start.addingTimeInterval(5 * day), componentID: component.id, categoryID: category.id, volunteerCapacity: 2)
        let unrelated = ActivityEvent(organizationID: organization.id, title: "Feria", startsAt: start.addingTimeInterval(6 * day), componentID: component.id, categoryID: otherCategory.id, volunteerCapacity: 2)
        let alex = Member(organizationID: organization.id, name: "Alex")
        let bea = Member(organizationID: organization.id, name: "Bea")
        let carlos = Member(organizationID: organization.id, name: "Carlos")
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [organization]
        snapshot.periods = [period]
        snapshot.members = [alex, bea, carlos]
        snapshot.components = [component]
        snapshot.categories = [category, otherCategory]
        snapshot.events = [target, prior, unrelated]
        snapshot.volunteers = [
            VolunteerEntry(eventID: target.id, memberID: alex.id, registeredAt: start),
            VolunteerEntry(eventID: target.id, memberID: bea.id, registeredAt: start),
            VolunteerEntry(eventID: target.id, memberID: carlos.id, registeredAt: start),
            VolunteerEntry(eventID: prior.id, memberID: alex.id, status: .completed),
            VolunteerEntry(eventID: prior.id, memberID: carlos.id, status: .selected),
            VolunteerEntry(eventID: unrelated.id, memberID: bea.id, status: .completed)
        ]
        try WorkspaceRules.validate(snapshot)

        let suggestions = WorkspaceRules.volunteerSuggestions(for: target, in: period, snapshot: snapshot)
        XCTAssertEqual(suggestions.map(\.memberID), [bea.id, carlos.id, alex.id].sorted { lhs, rhs in
            // Both zero-participation applicants tie, so their UUIDs decide.
            if lhs == alex.id { return false }
            if rhs == alex.id { return true }
            return lhs.uuidString < rhs.uuidString
        })
        XCTAssertEqual(suggestions.map(\.completedInPeriod), [0, 0, 1])
    }

    func testDeclinedSelectionReleasesPlaceWithoutLosingVolunteerHistory() throws {
        let organization = Organization(name: "Asociación")
        let component = ActivityComponent(organizationID: organization.id, name: "Servicio")
        let event = ActivityEvent(organizationID: organization.id, title: "Jornada", startsAt: .now,
                                  componentID: component.id, volunteerCapacity: 1)
        let ana = Member(organizationID: organization.id, name: "Ana")
        let bea = Member(organizationID: organization.id, name: "Bea")
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [organization]
        snapshot.components = [component]
        snapshot.events = [event]
        snapshot.members = [ana, bea]

        try snapshot.registerVolunteer(eventID: event.id, memberID: ana.id)
        try snapshot.registerVolunteer(eventID: event.id, memberID: bea.id)
        try snapshot.selectVolunteer(eventID: event.id, memberID: ana.id)
        XCTAssertThrowsError(try snapshot.selectVolunteer(eventID: event.id, memberID: bea.id)) {
            XCTAssertEqual($0 as? WorkspaceCommandError, .capacityReached)
        }
        try snapshot.declineVolunteer(eventID: event.id, memberID: ana.id)
        try snapshot.selectVolunteer(eventID: event.id, memberID: bea.id)
        XCTAssertEqual(snapshot.volunteers.first { $0.memberID == ana.id }?.status, .declined)
        XCTAssertEqual(snapshot.volunteers.first { $0.memberID == bea.id }?.status, .selected)
        XCTAssertEqual(snapshot.volunteers.count, 2)
        try WorkspaceRules.validate(snapshot)
    }

    func testVolunteerDeactivatedAfterRegistrationCannotBeSelected() throws {
        let organization = Organization(name: "Synthetic team")
        let component = ActivityComponent(organizationID: organization.id, name: "Service")
        let event = ActivityEvent(organizationID: organization.id, title: "Shift", startsAt: .now,
                                  componentID: component.id, volunteerCapacity: 1)
        let member = Member(organizationID: organization.id, name: "Synthetic person")
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [organization]
        snapshot.components = [component]
        snapshot.events = [event]
        snapshot.members = [member]
        try snapshot.registerVolunteer(eventID: event.id, memberID: member.id)
        snapshot.members[0].isActive = false
        let original = snapshot
        XCTAssertThrowsError(try snapshot.selectVolunteer(eventID: event.id, memberID: member.id)) {
            XCTAssertEqual($0 as? WorkspaceCommandError, .invalidMember)
        }
        XCTAssertEqual(snapshot, original)
        XCTAssertEqual(snapshot.volunteers.first?.status, .interested)
    }

    func testValidationRejectsDuplicateMemberEventResult() throws {
        let organization = Organization(name: "A")
        let member = Member(organizationID: organization.id, name: "B")
        let component = ActivityComponent(organizationID: organization.id, name: "C")
        let event = ActivityEvent(organizationID: organization.id, title: "D", startsAt: .now, componentID: component.id)
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [organization]
        snapshot.members = [member]
        snapshot.components = [component]
        snapshot.events = [event]
        snapshot.attendance = [
            AttendanceEntry(eventID: event.id, memberID: member.id, status: .present),
            AttendanceEntry(eventID: event.id, memberID: member.id, status: .absent)
        ]
        XCTAssertThrowsError(try WorkspaceRules.validate(snapshot)) { error in
            XCTAssertEqual(error as? WorkspaceValidationError, .duplicateAttendance)
        }
    }

    func testRosterCorrectionExcludesAndRestoresAttendanceWithoutDeletingIt() throws {
        let organization = Organization(name: "Asociación")
        let component = ActivityComponent(organizationID: organization.id, name: "Servicio")
        let first = Member(organizationID: organization.id, name: "Ana")
        let second = Member(organizationID: organization.id, name: "Bea")
        let eventDate = Date(timeIntervalSince1970: 1_790_000_000)
        let event = ActivityEvent(organizationID: organization.id, title: "Jornada",
                                  startsAt: eventDate, componentID: component.id)
        let period = WorkPeriod(organizationID: organization.id, name: "Semestre",
                                startsAt: eventDate.addingTimeInterval(-day),
                                endsAt: eventDate.addingTimeInterval(day))
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [organization]
        snapshot.components = [component]
        snapshot.members = [first, second]
        snapshot.events = [event]
        snapshot.periods = [period]
        try snapshot.createAttendanceList(eventID: event.id, memberIDs: [first.id])
        try snapshot.addAttendanceMembers(eventID: event.id, memberIDs: [second.id])
        XCTAssertEqual(snapshot.attendance.count, 2)
        XCTAssertThrowsError(try snapshot.addAttendanceMembers(eventID: event.id,
                                                                memberIDs: [first.id])) {
            XCTAssertEqual($0 as? WorkspaceCommandError, .alreadyIncluded)
        }
        try snapshot.setAttendance(eventID: event.id, memberID: first.id, status: .present)
        XCTAssertEqual(WorkspaceRules.attendance(for: first.id, in: period, snapshot: snapshot).percentage, 1)
        try snapshot.setAttendanceInclusion(eventID: event.id, memberID: first.id, included: false)
        XCTAssertEqual(snapshot.attendance.count, 2)
        XCTAssertNil(WorkspaceRules.attendance(for: first.id, in: period, snapshot: snapshot).percentage)
        XCTAssertThrowsError(try snapshot.setAttendance(eventID: event.id, memberID: first.id,
                                                        status: .absent))
        try snapshot.setAttendanceInclusion(eventID: event.id, memberID: first.id, included: true)
        XCTAssertEqual(WorkspaceRules.attendance(for: first.id, in: period, snapshot: snapshot).percentage, 1)
        try WorkspaceRules.validate(snapshot)
    }

    func testLegacyAttendanceWithoutVoidedFieldRemainsIncluded() throws {
        let entry = AttendanceEntry(eventID: UUID(), memberID: UUID())
        let data = try JSONEncoder().encode(entry)
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        json.removeValue(forKey: "isVoided")
        let oldData = try JSONSerialization.data(withJSONObject: json)
        let restored = try JSONDecoder().decode(AttendanceEntry.self, from: oldData)
        XCTAssertFalse(restored.isVoided)
    }
}
