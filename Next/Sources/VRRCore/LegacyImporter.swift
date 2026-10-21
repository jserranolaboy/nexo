import Foundation

public struct LegacyImportResult: Sendable {
    public let snapshot: WorkspaceSnapshot
    public let importedAttendanceLists: Int
    public let legacyMetricCount: Int
    public let hadOfficialTemplate: Bool
}

/// Reads Beta data without ever writing to its source URL. The caller can
/// inspect the result, then save it to a new store after confirmation.
public enum LegacyImporter {
    public static func importData(
        _ data: Data, organizationName: String,
        timeZone: TimeZone = .current
    ) throws -> LegacyImportResult {
        let decoder = JSONDecoder()
        let legacy: LegacySnapshot
        if let envelope = try? decoder.decode(LegacyBackupEnvelope.self, from: data) {
            legacy = envelope.snapshot
        } else {
            legacy = try decoder.decode(LegacySnapshot.self, from: data)
        }

        let organization = Organization(name: organizationName, timeZoneIdentifier: timeZone.identifier)
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [organization]
        snapshot.groups = legacy.groups.map { MemberGroup(id: $0.id, organizationID: organization.id, name: $0.name) }
        snapshot.members = legacy.members.map { Member(id: $0.id, organizationID: organization.id, name: $0.name, isActive: $0.isActive) }
        snapshot.memberships = legacy.members.flatMap { member in
            member.groupIDs.map { GroupMembership(memberID: member.id, groupID: $0, startsAt: member.createdAt) }
        }
        snapshot.components = legacy.components.map {
            ActivityComponent(id: $0.id, organizationID: organization.id, name: $0.name)
        }
        snapshot.categories = legacy.subcategories.map {
            ActivityCategory(id: $0.id, componentID: $0.componentID, name: $0.name)
        }
        snapshot.events = legacy.events.map {
            ActivityEvent(
                id: $0.id, organizationID: organization.id, title: $0.title,
                startsAt: $0.startsAt, componentID: $0.componentID,
                categoryID: $0.subcategoryID,
                countsAttendance: $0.countsTowardAttendance,
                isCancelled: $0.isCancelled
            )
        }
        let events = Dictionary(snapshot.events.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        snapshot.attendance = try legacy.attendanceLists.flatMap { list -> [AttendanceEntry] in
            guard let event = events[list.eventID] else { throw WorkspaceValidationError.brokenRelationship }
            return list.records.map { record in
                AttendanceEntry(
                    id: record.id, eventID: list.eventID, memberID: record.memberID,
                    status: record.status ?? (record.isPresent == true ? .present : .absent),
                    note: record.note, memberNameSnapshot: record.memberNameSnapshot,
                    groupIDsSnapshot: record.groupIDsSnapshot,
                    eventDateSnapshot: list.eventDateSnapshot,
                    componentIDSnapshot: list.componentIDSnapshot,
                    categoryIDSnapshot: event.categoryID,
                    countsAttendanceSnapshot: event.countsAttendance
                )
            }
        }
        snapshot.periods = makeSemesters(for: snapshot.events, organizationID: organization.id, timeZone: timeZone)
        try WorkspaceRules.validate(snapshot)
        return LegacyImportResult(
            snapshot: snapshot,
            importedAttendanceLists: legacy.attendanceLists.count,
            legacyMetricCount: legacy.metrics.count,
            hadOfficialTemplate: legacy.officialTemplate != nil
        )
    }

    private static func makeSemesters(for events: [ActivityEvent], organizationID: UUID, timeZone: TimeZone) -> [WorkPeriod] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let keys = Set(events.map { event -> String in
            let parts = calendar.dateComponents([.year, .month], from: event.startsAt)
            let year = parts.year ?? 1970
            return "\(year)-\((parts.month ?? 1) <= 6 ? 1 : 7)"
        })
        return keys.sorted().compactMap { key in
            let pieces = key.split(separator: "-").compactMap { Int($0) }
            guard pieces.count == 2,
                  let start = calendar.date(from: DateComponents(year: pieces[0], month: pieces[1], day: 1)),
                  let end = calendar.date(byAdding: .month, value: 6, to: start)
            else { return nil }
            let label = pieces[1] == 1 ? "enero-junio" : "julio-diciembre"
            return WorkPeriod(organizationID: organizationID, name: "\(pieces[0]) · \(label)", startsAt: start, endsAt: end)
        }
    }
}

private struct LegacyBackupEnvelope: Decodable { let snapshot: LegacySnapshot }
private struct LegacySnapshot: Decodable {
    let groups: [LegacyGroup]
    let members: [LegacyMember]
    let components: [LegacyComponent]
    let subcategories: [LegacySubcategory]
    let metrics: [LegacyMetric]
    let events: [LegacyEvent]
    let attendanceLists: [LegacyAttendanceList]
    let officialTemplate: LegacyTemplate?

    private enum CodingKeys: String, CodingKey {
        case groups, members, components, subcategories, metrics, events, attendanceLists, officialTemplate
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        groups = try values.decode([LegacyGroup].self, forKey: .groups)
        members = try values.decode([LegacyMember].self, forKey: .members)
        components = try values.decode([LegacyComponent].self, forKey: .components)
        subcategories = try values.decode([LegacySubcategory].self, forKey: .subcategories)
        metrics = try values.decodeIfPresent([LegacyMetric].self, forKey: .metrics) ?? []
        events = try values.decode([LegacyEvent].self, forKey: .events)
        attendanceLists = try values.decode([LegacyAttendanceList].self, forKey: .attendanceLists)
        officialTemplate = try values.decodeIfPresent(LegacyTemplate.self, forKey: .officialTemplate)
    }
}
private struct LegacyGroup: Decodable { let id: UUID; let name: String }
private struct LegacyMember: Decodable {
    let id: UUID; let name: String; let groupIDs: Set<UUID>; let isActive: Bool; let createdAt: Date
}
private struct LegacyComponent: Decodable { let id: UUID; let name: String }
private struct LegacySubcategory: Decodable { let id: UUID; let componentID: UUID; let name: String }
private struct LegacyMetric: Decodable { let id: UUID }
private struct LegacyEvent: Decodable {
    let id: UUID; let title: String; let startsAt: Date; let componentID: UUID
    let subcategoryID: UUID?; let countsTowardAttendance: Bool; let isCancelled: Bool
}
private struct LegacyAttendanceList: Decodable {
    let eventID: UUID; let eventDateSnapshot: Date; let componentIDSnapshot: UUID
    let records: [LegacyAttendanceRecord]
}
private struct LegacyAttendanceRecord: Decodable {
    let id: UUID; let memberID: UUID; let memberNameSnapshot: String
    let groupIDsSnapshot: Set<UUID>; let status: AttendanceStatus?; let isPresent: Bool?
    let note: String
}
private struct LegacyTemplate: Decodable { let filename: String }
