import Foundation

public struct Organization: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var name: String
    public var accentHex: String
    public var timeZoneIdentifier: String
    /// A recoverable tombstone. Related records remain intact for restore and sync.
    public var deletedAt: Date?

    public init(id: UUID = UUID(), name: String, accentHex: String = "#315EAD", timeZoneIdentifier: String = TimeZone.current.identifier, deletedAt: Date? = nil) {
        self.id = id
        self.name = name
        self.accentHex = accentHex
        self.timeZoneIdentifier = timeZoneIdentifier
        self.deletedAt = deletedAt
    }
}

/// End dates are exclusive, so adjacent semesters never overlap.
public struct WorkPeriod: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var organizationID: UUID
    public var name: String
    public var startsAt: Date
    public var endsAt: Date

    public init(id: UUID = UUID(), organizationID: UUID, name: String, startsAt: Date, endsAt: Date) {
        self.id = id
        self.organizationID = organizationID
        self.name = name
        self.startsAt = startsAt
        self.endsAt = endsAt
    }

    public func contains(_ date: Date) -> Bool { startsAt <= date && date < endsAt }
}

public struct Member: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var organizationID: UUID
    public var name: String
    public var isActive: Bool

    public init(id: UUID = UUID(), organizationID: UUID, name: String, isActive: Bool = true) {
        self.id = id
        self.organizationID = organizationID
        self.name = name
        self.isActive = isActive
    }
}

public struct MemberGroup: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var organizationID: UUID
    public var name: String

    public init(id: UUID = UUID(), organizationID: UUID, name: String) {
        self.id = id
        self.organizationID = organizationID
        self.name = name
    }
}

public struct GroupMembership: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var memberID: UUID
    public var groupID: UUID
    public var startsAt: Date
    public var endsAt: Date?

    public init(id: UUID = UUID(), memberID: UUID, groupID: UUID, startsAt: Date, endsAt: Date? = nil) {
        self.id = id
        self.memberID = memberID
        self.groupID = groupID
        self.startsAt = startsAt
        self.endsAt = endsAt
    }

    public func includes(_ date: Date) -> Bool { startsAt <= date && (endsAt.map { date < $0 } ?? true) }
}

public struct ActivityComponent: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var organizationID: UUID
    public var name: String

    public init(id: UUID = UUID(), organizationID: UUID, name: String) {
        self.id = id
        self.organizationID = organizationID
        self.name = name
    }
}

public struct ActivityCategory: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var componentID: UUID
    public var name: String

    public init(id: UUID = UUID(), componentID: UUID, name: String) {
        self.id = id
        self.componentID = componentID
        self.name = name
    }
}

public struct ActivityEvent: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var organizationID: UUID
    public var title: String
    public var startsAt: Date
    public var componentID: UUID
    public var categoryID: UUID?
    public var countsAttendance: Bool
    public var isCancelled: Bool
    public var volunteerCapacity: Int?

    public init(
        id: UUID = UUID(), organizationID: UUID, title: String, startsAt: Date,
        componentID: UUID, categoryID: UUID? = nil, countsAttendance: Bool = true,
        isCancelled: Bool = false, volunteerCapacity: Int? = nil
    ) {
        self.id = id
        self.organizationID = organizationID
        self.title = title
        self.startsAt = startsAt
        self.componentID = componentID
        self.categoryID = categoryID
        self.countsAttendance = countsAttendance
        self.isCancelled = isCancelled
        self.volunteerCapacity = volunteerCapacity
    }
}

public enum AttendanceStatus: String, Codable, CaseIterable, Sendable {
    case pending, present, absent, excused
}

/// One member's result for one event. Its existence records eligibility;
/// people without a row are not in that event's denominator.
public struct AttendanceEntry: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var eventID: UUID
    public var memberID: UUID
    public var status: AttendanceStatus
    /// A roster correction keeps the record and its history without counting it.
    public var isVoided: Bool
    public var note: String
    public var recordedAt: Date?
    public var memberNameSnapshot: String?
    public var groupIDsSnapshot: Set<UUID>?
    public var eventDateSnapshot: Date?
    public var componentIDSnapshot: UUID?
    public var categoryIDSnapshot: UUID?
    public var countsAttendanceSnapshot: Bool?

    public init(
        id: UUID = UUID(), eventID: UUID, memberID: UUID,
        status: AttendanceStatus = .pending, isVoided: Bool = false,
        note: String = "", recordedAt: Date? = nil,
        memberNameSnapshot: String? = nil, groupIDsSnapshot: Set<UUID>? = nil,
        eventDateSnapshot: Date? = nil, componentIDSnapshot: UUID? = nil,
        categoryIDSnapshot: UUID? = nil, countsAttendanceSnapshot: Bool? = nil
    ) {
        self.id = id
        self.eventID = eventID
        self.memberID = memberID
        self.status = status
        self.isVoided = isVoided
        self.note = note
        self.recordedAt = recordedAt
        self.memberNameSnapshot = memberNameSnapshot
        self.groupIDsSnapshot = groupIDsSnapshot
        self.eventDateSnapshot = eventDateSnapshot
        self.componentIDSnapshot = componentIDSnapshot
        self.categoryIDSnapshot = categoryIDSnapshot
        self.countsAttendanceSnapshot = countsAttendanceSnapshot
    }

    private enum CodingKeys: String, CodingKey {
        case id, eventID, memberID, status, isVoided, note, recordedAt
        case memberNameSnapshot, groupIDsSnapshot, eventDateSnapshot
        case componentIDSnapshot, categoryIDSnapshot, countsAttendanceSnapshot
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        eventID = try values.decode(UUID.self, forKey: .eventID)
        memberID = try values.decode(UUID.self, forKey: .memberID)
        status = try values.decode(AttendanceStatus.self, forKey: .status)
        isVoided = try values.decodeIfPresent(Bool.self, forKey: .isVoided) ?? false
        note = try values.decode(String.self, forKey: .note)
        recordedAt = try values.decodeIfPresent(Date.self, forKey: .recordedAt)
        memberNameSnapshot = try values.decodeIfPresent(String.self, forKey: .memberNameSnapshot)
        groupIDsSnapshot = try values.decodeIfPresent(Set<UUID>.self, forKey: .groupIDsSnapshot)
        eventDateSnapshot = try values.decodeIfPresent(Date.self, forKey: .eventDateSnapshot)
        componentIDSnapshot = try values.decodeIfPresent(UUID.self, forKey: .componentIDSnapshot)
        categoryIDSnapshot = try values.decodeIfPresent(UUID.self, forKey: .categoryIDSnapshot)
        countsAttendanceSnapshot = try values.decodeIfPresent(Bool.self, forKey: .countsAttendanceSnapshot)
    }
}

public enum VolunteerStatus: String, Codable, CaseIterable, Sendable {
    case interested, selected, declined, completed, noShow
}

public struct VolunteerEntry: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var eventID: UUID
    public var memberID: UUID
    public var status: VolunteerStatus
    public var registeredAt: Date

    public init(id: UUID = UUID(), eventID: UUID, memberID: UUID, status: VolunteerStatus = .interested, registeredAt: Date = .now) {
        self.id = id
        self.eventID = eventID
        self.memberID = memberID
        self.status = status
        self.registeredAt = registeredAt
    }
}

public enum WorkspaceRole: String, Codable, Sendable {
    case administrator, coordinator, reader
}

public struct Collaborator: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var organizationID: UUID
    public var email: String
    public var role: WorkspaceRole

    public init(id: UUID = UUID(), organizationID: UUID, email: String, role: WorkspaceRole) {
        self.id = id
        self.organizationID = organizationID
        self.email = email
        self.role = role
    }
}

public enum TemplateFormat: String, Codable, Sendable {
    case visual, pdf, docx
}

public enum TemplateColumn: String, Codable, CaseIterable, Sendable {
    case participant, present, absent, excused, signature, notes
}

public struct TemplateTextBlock: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var text: String
    /// Position and width in PDF points, measured from the page's top-left corner.
    public var x: Double
    public var y: Double
    public var width: Double
    public var fontSize: Double

    public init(id: UUID = UUID(), text: String, x: Double, y: Double,
                width: Double = 220, fontSize: Double = 12) {
        self.id = id
        self.text = text
        self.x = x
        self.y = y
        self.width = width
        self.fontSize = fontSize
    }
}

public struct TemplateImageBlock: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var imageData: Data
    /// Position and size in PDF points, measured from the page's top-left corner.
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(id: UUID = UUID(), imageData: Data, x: Double, y: Double,
                width: Double, height: Double) {
        self.id = id
        self.imageData = imageData
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public struct DocumentTemplate: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var organizationID: UUID
    public var name: String
    public var format: TemplateFormat
    public var columns: [TemplateColumn]
    public var accentHex: String
    public var rowHeight: Double
    /// Optional text explicitly added by the person editing the document.
    public var headerTitle: String?
    public var headerSubtitle: String?
    public var footerText: String?
    public var showsPageNumber: Bool?
    /// Overrides for the built-in column titles, keyed by TemplateColumn.rawValue.
    public var columnLabels: [String: String]?
    public var textBlocks: [TemplateTextBlock]?
    public var imageBlocks: [TemplateImageBlock]?
    /// Original PDF page bytes, retained so the finished list can be placed on top.
    public var backgroundPDFData: Data?
    /// Zero-based page of the original PDF that receives the list.
    public var listPageIndex: Int?
    /// Distance from the page's top edge to the table header, in PDF points.
    public var tableTopOffset: Double?
    /// A remote object key for an original DOCX/PDF or uploaded logo. The
    /// original bytes are held separately from the workspace metadata.
    public var sourceObjectKey: String?

    public init(
        id: UUID = UUID(), organizationID: UUID, name: String,
        format: TemplateFormat = .visual,
        columns: [TemplateColumn] = [.participant, .present, .absent, .excused, .signature],
        accentHex: String = "#315EAD", rowHeight: Double = 28,
        headerTitle: String? = nil, headerSubtitle: String? = nil,
        footerText: String? = nil, showsPageNumber: Bool? = nil,
        columnLabels: [String: String]? = nil,
        textBlocks: [TemplateTextBlock]? = nil,
        imageBlocks: [TemplateImageBlock]? = nil,
        backgroundPDFData: Data? = nil, listPageIndex: Int? = nil,
        tableTopOffset: Double? = nil,
        sourceObjectKey: String? = nil
    ) {
        self.id = id
        self.organizationID = organizationID
        self.name = name
        self.format = format
        self.columns = columns
        self.accentHex = accentHex
        self.rowHeight = rowHeight
        self.headerTitle = headerTitle
        self.headerSubtitle = headerSubtitle
        self.footerText = footerText
        self.showsPageNumber = showsPageNumber
        self.columnLabels = columnLabels
        self.textBlocks = textBlocks
        self.imageBlocks = imageBlocks
        self.backgroundPDFData = backgroundPDFData
        self.listPageIndex = listPageIndex
        self.tableTopOffset = tableTopOffset
        self.sourceObjectKey = sourceObjectKey
    }
}

public struct WorkspaceSnapshot: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 1
    public var schemaVersion = currentSchemaVersion
    public var revision: UInt64 = 0
    public var organizations: [Organization] = []
    public var periods: [WorkPeriod] = []
    public var members: [Member] = []
    public var groups: [MemberGroup] = []
    public var memberships: [GroupMembership] = []
    public var components: [ActivityComponent] = []
    public var categories: [ActivityCategory] = []
    public var events: [ActivityEvent] = []
    public var attendance: [AttendanceEntry] = []
    public var volunteers: [VolunteerEntry] = []
    public var collaborators: [Collaborator] = []
    public var templates: [DocumentTemplate] = []
    /// Persisted in the same atomic file as the edits it needs to upload.
    public var syncStates: [OrganizationSyncState] = []
    public var driveReplicas: [DriveReplica] = []
    /// Keeps both values and the decision after a conflict is resolved.
    public var resolvedSyncConflicts: [ResolvedSyncConflict] = []

    public init() {}

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, revision, organizations, periods, members, groups, memberships
        case components, categories, events, attendance, volunteers, collaborators, templates, syncStates,
             resolvedSyncConflicts, driveReplicas
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try values.decode(Int.self, forKey: .schemaVersion)
        revision = try values.decode(UInt64.self, forKey: .revision)
        organizations = try values.decode([Organization].self, forKey: .organizations)
        periods = try values.decode([WorkPeriod].self, forKey: .periods)
        members = try values.decode([Member].self, forKey: .members)
        groups = try values.decode([MemberGroup].self, forKey: .groups)
        memberships = try values.decode([GroupMembership].self, forKey: .memberships)
        components = try values.decode([ActivityComponent].self, forKey: .components)
        categories = try values.decode([ActivityCategory].self, forKey: .categories)
        events = try values.decode([ActivityEvent].self, forKey: .events)
        attendance = try values.decode([AttendanceEntry].self, forKey: .attendance)
        volunteers = try values.decode([VolunteerEntry].self, forKey: .volunteers)
        collaborators = try values.decode([Collaborator].self, forKey: .collaborators)
        templates = try values.decodeIfPresent([DocumentTemplate].self, forKey: .templates) ?? []
        driveReplicas = try values.decodeIfPresent([DriveReplica].self, forKey: .driveReplicas) ?? []
        syncStates = try values.decodeIfPresent([OrganizationSyncState].self, forKey: .syncStates) ?? []
        resolvedSyncConflicts = try values.decodeIfPresent([ResolvedSyncConflict].self,
                                                            forKey: .resolvedSyncConflicts) ?? []
    }
}
