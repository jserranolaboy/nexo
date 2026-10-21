import CoreGraphics
import Foundation

public struct AttendanceResult: Equatable, Sendable {
    public var present: Int = 0
    public var absent: Int = 0
    public var excused: Int = 0
    public var pending: Int = 0

    public var countedEvents: Int { present + absent }
    public var percentage: Double? {
        guard countedEvents > 0 else { return nil }
        return Double(present) / Double(countedEvents)
    }
}

public struct VolunteerSuggestion: Equatable, Identifiable, Sendable {
    public var id: UUID { memberID }
    public let memberID: UUID
    public let memberName: String
    public let completedInPeriod: Int
    public let lastCompletedAt: Date?
    public let registeredAt: Date
}

public enum WorkspaceValidationError: Error, Equatable, Sendable {
    case invalidPeriod
    case duplicateIdentity
    case duplicateAttendance
    case duplicateVolunteer
    case brokenRelationship
    case invalidCapacity
    case invalidName
    case invalidTemplate
    case invalidSyncState
}

public enum WorkspaceRules {
    public static func attendance(
        for memberID: UUID, in period: WorkPeriod, componentID: UUID? = nil,
        categoryID: UUID? = nil, snapshot: WorkspaceSnapshot
    ) -> AttendanceResult {
        let events = Dictionary(snapshot.events.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var result = AttendanceResult()
        for entry in snapshot.attendance where entry.memberID == memberID && !entry.isVoided {
            guard let event = events[entry.eventID],
                  event.organizationID == period.organizationID,
                  !event.isCancelled, entry.countsAttendanceSnapshot ?? event.countsAttendance,
                  period.contains(entry.eventDateSnapshot ?? event.startsAt),
                  componentID.map({ (entry.componentIDSnapshot ?? event.componentID) == $0 }) ?? true,
                  categoryID.map({ (entry.categoryIDSnapshot ?? event.categoryID) == $0 }) ?? true
            else { continue }
            switch entry.status {
            case .present: result.present += 1
            case .absent: result.absent += 1
            case .excused: result.excused += 1
            case .pending: result.pending += 1
            }
        }
        return result
    }

    /// Suggests an order without changing selection. Only completed work in
    /// the chosen period and the event's category (or component) gives credit.
    public static func volunteerSuggestions(
        for event: ActivityEvent, in period: WorkPeriod, snapshot: WorkspaceSnapshot
    ) -> [VolunteerSuggestion] {
        guard event.organizationID == period.organizationID,
              period.contains(event.startsAt), !event.isCancelled,
              event.volunteerCapacity != nil
        else { return [] }

        let members = Dictionary(snapshot.members.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let events = Dictionary(snapshot.events.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let priorCompletions = snapshot.volunteers.compactMap { entry -> (UUID, Date)? in
            guard entry.status == .completed,
                  let prior = events[entry.eventID],
                  prior.id != event.id,
                  prior.organizationID == event.organizationID,
                  !prior.isCancelled,
                  prior.startsAt < event.startsAt,
                  period.contains(prior.startsAt),
                  event.categoryID.map({ prior.categoryID == $0 }) ?? (prior.componentID == event.componentID)
            else { return nil }
            return (entry.memberID, prior.startsAt)
        }

        return snapshot.volunteers.compactMap { entry -> VolunteerSuggestion? in
            guard entry.eventID == event.id, entry.status == .interested,
                  let member = members[entry.memberID],
                  member.organizationID == event.organizationID, member.isActive
            else { return nil }
            let dates = priorCompletions.filter { $0.0 == member.id }.map(\.1)
            return VolunteerSuggestion(
                memberID: member.id,
                memberName: member.name,
                completedInPeriod: dates.count,
                lastCompletedAt: dates.max(),
                registeredAt: entry.registeredAt
            )
        }
        .sorted { lhs, rhs in
            if lhs.completedInPeriod != rhs.completedInPeriod {
                return lhs.completedInPeriod < rhs.completedInPeriod
            }
            // A person who has waited longer since their last turn goes first.
            if lhs.lastCompletedAt != rhs.lastCompletedAt {
                return (lhs.lastCompletedAt ?? .distantPast) < (rhs.lastCompletedAt ?? .distantPast)
            }
            if lhs.registeredAt != rhs.registeredAt { return lhs.registeredAt < rhs.registeredAt }
            return lhs.memberID.uuidString < rhs.memberID.uuidString
        }
    }

    public static func validate(_ snapshot: WorkspaceSnapshot) throws {
        guard snapshot.periods.allSatisfy({ $0.startsAt < $0.endsAt }) else { throw WorkspaceValidationError.invalidPeriod }
        guard snapshot.events.allSatisfy({ ($0.volunteerCapacity ?? 0) >= 0 }) else { throw WorkspaceValidationError.invalidCapacity }
        guard snapshot.organizations.allSatisfy({ !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }),
              snapshot.members.allSatisfy({ !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }),
              snapshot.events.allSatisfy({ !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
        else { throw WorkspaceValidationError.invalidName }

        func unique<T: Identifiable>(_ values: [T]) -> Bool where T.ID == UUID {
            Set(values.map(\.id)).count == values.count
        }
        guard unique(snapshot.organizations), unique(snapshot.periods), unique(snapshot.members),
              unique(snapshot.groups), unique(snapshot.memberships), unique(snapshot.components),
              unique(snapshot.categories), unique(snapshot.events), unique(snapshot.attendance),
              unique(snapshot.volunteers), unique(snapshot.collaborators), unique(snapshot.templates)
        else { throw WorkspaceValidationError.duplicateIdentity }

        let attendancePairs = snapshot.attendance.map { "\($0.eventID):\($0.memberID)" }
        guard Set(attendancePairs).count == attendancePairs.count else { throw WorkspaceValidationError.duplicateAttendance }
        let volunteerPairs = snapshot.volunteers.map { "\($0.eventID):\($0.memberID)" }
        guard Set(volunteerPairs).count == volunteerPairs.count else { throw WorkspaceValidationError.duplicateVolunteer }

        let organizations = Set(snapshot.organizations.map(\.id))
        let members = Dictionary(uniqueKeysWithValues: snapshot.members.map { ($0.id, $0) })
        let groups = Dictionary(uniqueKeysWithValues: snapshot.groups.map { ($0.id, $0) })
        let components = Dictionary(uniqueKeysWithValues: snapshot.components.map { ($0.id, $0) })
        let categories = Dictionary(uniqueKeysWithValues: snapshot.categories.map { ($0.id, $0) })
        let events = Dictionary(uniqueKeysWithValues: snapshot.events.map { ($0.id, $0) })
        guard snapshot.periods.allSatisfy({ organizations.contains($0.organizationID) }),
              snapshot.members.allSatisfy({ organizations.contains($0.organizationID) }),
              snapshot.groups.allSatisfy({ organizations.contains($0.organizationID) }),
              snapshot.components.allSatisfy({ organizations.contains($0.organizationID) }),
              snapshot.collaborators.allSatisfy({ organizations.contains($0.organizationID) }),
              snapshot.templates.allSatisfy({ organizations.contains($0.organizationID) }),
              snapshot.memberships.allSatisfy({ membership in
                  guard let member = members[membership.memberID], let group = groups[membership.groupID] else { return false }
                  return member.organizationID == group.organizationID &&
                      (membership.endsAt.map { membership.startsAt < $0 } ?? true)
              }),
              snapshot.categories.allSatisfy({ components[$0.componentID] != nil }),
              snapshot.events.allSatisfy({ event in
                  guard organizations.contains(event.organizationID),
                        let component = components[event.componentID],
                        component.organizationID == event.organizationID
                  else { return false }
                  guard let categoryID = event.categoryID else { return true }
                  return categories[categoryID]?.componentID == event.componentID
              }),
              snapshot.attendance.allSatisfy({ entry in
                  guard let event = events[entry.eventID], let member = members[entry.memberID] else { return false }
                  return event.organizationID == member.organizationID
              }),
              snapshot.volunteers.allSatisfy({ entry in
                  guard let event = events[entry.eventID], let member = members[entry.memberID] else { return false }
                  return event.organizationID == member.organizationID && event.volunteerCapacity != nil
              })
        else { throw WorkspaceValidationError.brokenRelationship }

        guard snapshot.templates.allSatisfy({ template in
            let pageSize: CGSize
            if let data = template.backgroundPDFData {
                guard !data.isEmpty, data.count <= 8_000_000,
                      let provider = CGDataProvider(data: data as CFData),
                      let document = CGPDFDocument(provider),
                      let page = document.page(at: (template.listPageIndex ?? 0) + 1)
                else { return false }
                pageSize = page.getBoxRect(.mediaBox).size
            } else {
                pageSize = CGSize(width: 612, height: 792)
            }
            return !template.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && template.columns.first == .participant
                && Set(template.columns).count == template.columns.count
                && (18...80).contains(template.rowHeight)
                && (template.textBlocks ?? []).allSatisfy({ block in
                    !block.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                    block.x >= 0 && block.y >= 0 &&
                    (60...2000).contains(block.width) && block.x + block.width <= pageSize.width &&
                    block.y + block.fontSize * 2.5 <= pageSize.height &&
                    (8...32).contains(block.fontSize)
                })
                && Set((template.textBlocks ?? []).map(\.id)).count == (template.textBlocks ?? []).count
                && (template.imageBlocks ?? []).reduce(0) { $0 + $1.imageData.count } <= 6_000_000
                && (template.imageBlocks ?? []).allSatisfy({ block in
                    !block.imageData.isEmpty && block.imageData.count <= 2_000_000 &&
                    block.x >= 0 && block.y >= 0 &&
                    (20...2000).contains(block.width) && (20...2000).contains(block.height) &&
                    block.x + block.width <= pageSize.width && block.y + block.height <= pageSize.height
                })
                && Set((template.imageBlocks ?? []).map(\.id)).count == (template.imageBlocks ?? []).count
                && (template.listPageIndex ?? 0) >= 0
                && (100...600).contains(template.tableTopOffset ?? 122)
                && (template.format == .visual || template.sourceObjectKey != nil)
        }) else { throw WorkspaceValidationError.invalidTemplate }

        guard Set(snapshot.resolvedSyncConflicts.map(\.id)).count == snapshot.resolvedSyncConflicts.count,
              snapshot.resolvedSyncConflicts.allSatisfy({ record in
                  organizations.contains(record.organizationID) && record.serverRevision >= 1 &&
                  !record.discardedMutationIDs.isEmpty
              }),
              Set(snapshot.syncStates.map(\.organizationID)).count == snapshot.syncStates.count,
              snapshot.syncStates.allSatisfy({ state in
                  organizations.contains(state.organizationID) && state.cursor >= 0 &&
                  Set(state.pending.map(\.id)).count == state.pending.count &&
                  state.pending.allSatisfy({ $0.organizationID == state.organizationID &&
                      ($0.expectedRevision.map { $0 >= 1 } ?? true) })
              })
        else { throw WorkspaceValidationError.invalidSyncState }
        guard Set(snapshot.driveReplicas.map(\.organizationID)).count == snapshot.driveReplicas.count,
              snapshot.driveReplicas.allSatisfy({ replica in
                  organizations.contains(replica.organizationID) && !replica.folderID.isEmpty &&
                  !snapshot.syncStates.contains(where: { $0.organizationID == replica.organizationID }) &&
                  Set(replica.seen).count == replica.seen.count &&
                  Set(replica.heads).isSubset(of: Set(replica.seen)) &&
                  Set(replica.outbox.map(\.id)).count == replica.outbox.count &&
                  replica.outbox.allSatisfy({ $0.organizationID == replica.organizationID && replica.seen.contains($0.id) }) &&
                  Set(replica.receipts.map(\.fileID)).count == replica.receipts.count &&
                  replica.receipts.allSatisfy({ replica.seen.contains($0.batchID) && $0.checksum.count == 32 }) &&
                  replica.versions.values.allSatisfy({ !$0.isEmpty && Set($0.map(\.batchID)).count == $0.count && $0.allSatisfy({ replica.seen.contains($0.batchID) }) })
              }) else { throw WorkspaceValidationError.invalidSyncState }
    }
}
