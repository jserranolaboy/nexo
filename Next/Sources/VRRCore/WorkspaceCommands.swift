import Foundation

public enum WorkspaceCommandError: Error, Equatable, Sendable {
    case eventNotFound
    case memberNotFound
    case unavailableEvent
    case invalidMember
    case emptySelection
    case alreadyListed
    case volunteerUnavailable
    case alreadyRegistered
    case capacityReached
    case invalidTransition
    case alreadyIncluded
}

public extension WorkspaceSnapshot {
    /// The caller explicitly chooses the people expected at this event. An
    /// absent row is never inferred for every other member of the association.
    mutating func createAttendanceList(eventID: UUID, memberIDs: Set<UUID>) throws {
        guard let event = events.first(where: { $0.id == eventID }) else { throw WorkspaceCommandError.eventNotFound }
        guard !event.isCancelled else { throw WorkspaceCommandError.unavailableEvent }
        guard !attendance.contains(where: { $0.eventID == eventID }) else { throw WorkspaceCommandError.alreadyListed }
        try addAttendanceMembers(eventID: eventID, memberIDs: memberIDs)
    }

    mutating func addAttendanceMembers(eventID: UUID, memberIDs: Set<UUID>) throws {
        guard let event = events.first(where: { $0.id == eventID }) else { throw WorkspaceCommandError.eventNotFound }
        guard !event.isCancelled else { throw WorkspaceCommandError.unavailableEvent }
        guard !memberIDs.isEmpty else { throw WorkspaceCommandError.emptySelection }
        guard !attendance.contains(where: { $0.eventID == eventID && memberIDs.contains($0.memberID) })
        else { throw WorkspaceCommandError.alreadyIncluded }
        let selected = members.filter { memberIDs.contains($0.id) }
        guard selected.count == memberIDs.count,
              selected.allSatisfy({ $0.organizationID == event.organizationID && $0.isActive })
        else { throw WorkspaceCommandError.invalidMember }
        attendance.append(contentsOf: selected.map { member in
            AttendanceEntry(
                eventID: eventID, memberID: member.id,
                memberNameSnapshot: member.name,
                groupIDsSnapshot: Set(memberships.filter { $0.memberID == member.id && $0.includes(event.startsAt) }.map(\.groupID)),
                eventDateSnapshot: event.startsAt,
                componentIDSnapshot: event.componentID,
                categoryIDSnapshot: event.categoryID,
                countsAttendanceSnapshot: event.countsAttendance
            )
        })
    }

    mutating func setAttendance(eventID: UUID, memberID: UUID, status: AttendanceStatus, note: String = "", recordedAt: Date = .now) throws {
        guard let index = attendance.firstIndex(where: { $0.eventID == eventID && $0.memberID == memberID })
        else { throw WorkspaceCommandError.memberNotFound }
        guard !attendance[index].isVoided else { throw WorkspaceCommandError.invalidTransition }
        attendance[index].status = status
        attendance[index].note = note.trimmingCharacters(in: .whitespacesAndNewlines)
        attendance[index].recordedAt = recordedAt
    }

    mutating func setAttendanceInclusion(eventID: UUID, memberID: UUID, included: Bool) throws {
        guard let index = attendance.firstIndex(where: { $0.eventID == eventID && $0.memberID == memberID })
        else { throw WorkspaceCommandError.memberNotFound }
        guard attendance[index].isVoided == included else { throw WorkspaceCommandError.invalidTransition }
        attendance[index].isVoided = !included
    }

    mutating func registerVolunteer(eventID: UUID, memberID: UUID, at date: Date = .now) throws {
        guard let event = events.first(where: { $0.id == eventID }) else { throw WorkspaceCommandError.eventNotFound }
        guard !event.isCancelled, event.volunteerCapacity != nil else { throw WorkspaceCommandError.volunteerUnavailable }
        guard let member = members.first(where: { $0.id == memberID }),
              member.organizationID == event.organizationID, member.isActive
        else { throw WorkspaceCommandError.invalidMember }
        guard !volunteers.contains(where: { $0.eventID == eventID && $0.memberID == memberID })
        else { throw WorkspaceCommandError.alreadyRegistered }
        volunteers.append(VolunteerEntry(eventID: eventID, memberID: memberID, registeredAt: date))
    }

    /// Selection is always an explicit coordinator action. Ranking never calls
    /// this method or occupies a place on its own.
    mutating func selectVolunteer(eventID: UUID, memberID: UUID) throws {
        guard let event = events.first(where: { $0.id == eventID }), let capacity = event.volunteerCapacity,
              !event.isCancelled
        else { throw WorkspaceCommandError.volunteerUnavailable }
        guard let index = volunteers.firstIndex(where: { $0.eventID == eventID && $0.memberID == memberID }),
              volunteers[index].status == .interested
        else { throw WorkspaceCommandError.invalidTransition }
        let occupied = volunteers.filter { $0.eventID == eventID && ($0.status == .selected || $0.status == .completed) }.count
        guard occupied < capacity else { throw WorkspaceCommandError.capacityReached }
        volunteers[index].status = .selected
    }

    mutating func finishVolunteer(eventID: UUID, memberID: UUID, participated: Bool) throws {
        guard let index = volunteers.firstIndex(where: { $0.eventID == eventID && $0.memberID == memberID }),
              volunteers[index].status == .selected
        else { throw WorkspaceCommandError.invalidTransition }
        volunteers[index].status = participated ? .completed : .noShow
    }

    mutating func declineVolunteer(eventID: UUID, memberID: UUID) throws {
        guard let index = volunteers.firstIndex(where: { $0.eventID == eventID && $0.memberID == memberID }),
              volunteers[index].status == .interested || volunteers[index].status == .selected
        else { throw WorkspaceCommandError.invalidTransition }
        volunteers[index].status = .declined
    }

    /// Edits an event in place. Attendance rows keep their person snapshots, but the
    /// event-derived values follow the edit so the result always matches the event.
    mutating func updateEvent(_ updated: ActivityEvent) throws {
        guard let index = events.firstIndex(where: { $0.id == updated.id }),
              events[index].organizationID == updated.organizationID
        else { throw WorkspaceCommandError.eventNotFound }
        guard components.contains(where: { $0.id == updated.componentID && $0.organizationID == updated.organizationID }),
              updated.categoryID == nil || categories.contains(where: { $0.id == updated.categoryID && $0.componentID == updated.componentID })
        else { throw WorkspaceCommandError.unavailableEvent }
        if let capacity = updated.volunteerCapacity {
            let occupied = volunteers.filter { $0.eventID == updated.id && ($0.status == .selected || $0.status == .completed) }.count
            guard capacity >= max(1, occupied) else { throw WorkspaceCommandError.capacityReached }
        } else if volunteers.contains(where: { $0.eventID == updated.id }) {
            throw WorkspaceCommandError.volunteerUnavailable
        }
        events[index] = updated
        for row in attendance.indices where attendance[row].eventID == updated.id {
            attendance[row].eventDateSnapshot = updated.startsAt
            attendance[row].componentIDSnapshot = updated.componentID
            attendance[row].categoryIDSnapshot = updated.categoryID
            attendance[row].countsAttendanceSnapshot = updated.countsAttendance
        }
    }
}
