import Foundation

/// A Drive workspace is an append-only set of immutable, causally ordered files.
/// Entity versions and the outbox share the SnapshotStore transaction with edits.
public struct DriveChange: Codable, Equatable, Sendable {
    public var key: String
    public var replaces: [UUID]
    public var value: JSONValue
}
public struct DriveBatch: Codable, Equatable, Identifiable, Sendable {
    public var protocolVersion = 1
    public var id = UUID()
    public var organizationID: UUID
    public var deviceName: String
    public var createdAt = Date()
    public var parents: [UUID]
    public var changes: [DriveChange]
}
public struct DriveVersion: Codable, Equatable, Sendable {
    public var batchID: UUID
    public var deviceName: String
    public var createdAt: Date
    public var value: JSONValue
}
public struct DriveReceipt: Codable, Equatable, Sendable {
    public var fileID: String
    public var checksum: String
    public var batchID: UUID
    public init(fileID: String, checksum: String, batchID: UUID) {
        self.fileID = fileID; self.checksum = checksum; self.batchID = batchID
    }
}
public struct DriveReplica: Codable, Equatable, Sendable {
    public var organizationID: UUID
    public var folderID: String
    public var heads: [UUID] = []
    public var seen: [UUID] = []
    public var versions: [String: [DriveVersion]] = [:]
    public var outbox: [DriveBatch] = []
    public var uploadIDs: [String: String] = [:]
    public var receipts: [DriveReceipt] = []
    public var lastSyncAt: Date?
    public var canEdit = true
    /// Imported copies retain their history but never upload until resumed.
    /// Optional for compatibility with existing Mac and iOS archives.
    public var isPaused: Bool?
    public init(organizationID: UUID, folderID: String) {
        self.organizationID = organizationID; self.folderID = folderID
    }
    public var conflicts: [String] { versions.keys.filter { (versions[$0]?.count ?? 0) > 1 }.sorted() }
}
public enum DriveSyncError: LocalizedError {
    case invalidHistory, missingHistory, wrongWorkspace, conflict, readOnly, alreadyLinked, removedData
    public var errorDescription: String? {
        switch self {
        case .invalidHistory: "Drive contiene un cambio incompatible o dañado. Tus datos locales se conservaron."
        case .missingHistory: "Faltan cambios del historial en Drive. Vuelve a sincronizar; si persiste, recupera los archivos desde la papelera de Drive."
        case .wrongWorkspace: "Esta carpeta no corresponde a este espacio de Nexo."
        case .conflict: "Este registro tiene dos versiones. Revisa las versiones en Drive antes de editarlo."
        case .readOnly: "Tu acceso a esta carpeta de Drive es de lectura."
        case .alreadyLinked: "Este espacio ya tiene una conexión. Abre su carpeta desde Datos y colaboración."
        case .removedData: "La recuperación cambiaría el historial compartido. Recupera la copia en un espacio local separado."
        }
    }
}
public enum DriveSync {
    /// Seeds one association only; other associations never enter this folder.
    public static func activate(_ snapshot: inout WorkspaceSnapshot, organizationID: UUID, folderID: String, deviceName: String) throws {
        guard snapshot.organizations.contains(where: { $0.id == organizationID }) else { throw DriveSyncError.wrongWorkspace }
        guard !snapshot.driveReplicas.contains(where: { $0.organizationID == organizationID }),
              !snapshot.syncStates.contains(where: { $0.organizationID == organizationID }) else { throw DriveSyncError.alreadyLinked }
        var replica = DriveReplica(organizationID: organizationID, folderID: folderID)
        let values = try entities(snapshot, organizationID: organizationID)
        let batch = DriveBatch(organizationID: organizationID, deviceName: deviceName, parents: [], changes: values.keys.sorted().map { DriveChange(key: $0, replaces: [], value: values[$0]!) })
        try apply(batch, to: &replica)
        replica.outbox.append(batch)
        snapshot.driveReplicas.append(replica)
    }
    public static func capture(from old: WorkspaceSnapshot, into next: inout WorkspaceSnapshot, deviceName: String) throws {
        for index in next.driveReplicas.indices {
            var replica = next.driveReplicas[index]
            let before = try entities(old, organizationID: replica.organizationID)
            let after = try entities(next, organizationID: replica.organizationID)
            guard Set(before.keys).isSubset(of: Set(after.keys)) else { throw DriveSyncError.removedData }
            let keys = after.keys.filter { before[$0] != after[$0] }.sorted()
            guard !keys.isEmpty else { continue }
            guard replica.canEdit || replica.isPaused == true else { throw DriveSyncError.readOnly }
            guard keys.allSatisfy({ (replica.versions[$0]?.count ?? 0) <= 1 }) else { throw DriveSyncError.conflict }
            let changes = keys.map { DriveChange(key: $0, replaces: replica.versions[$0, default: []].map(\.batchID), value: after[$0]!) }
            let batch = DriveBatch(organizationID: replica.organizationID, deviceName: deviceName, parents: replica.heads, changes: changes)
            try apply(batch, to: &replica)
            replica.outbox.append(batch)
            next.driveReplicas[index] = replica
        }
    }
    /// Causal ordering makes delivery order irrelevant. Missing parents never
    /// produce a partial projection; the caller commits only the validated result.
    public static func receive(_ batches: [DriveBatch], into snapshot: inout WorkspaceSnapshot, organizationID: UUID) throws {
        guard let index = snapshot.driveReplicas.firstIndex(where: { $0.organizationID == organizationID }) else { throw DriveSyncError.wrongWorkspace }
        var replica = snapshot.driveReplicas[index]
        var waiting: [UUID: DriveBatch] = [:]
        for batch in batches {
            guard batch.organizationID == organizationID else { throw DriveSyncError.wrongWorkspace }
            if let existing = waiting[batch.id], existing != batch { throw DriveSyncError.invalidHistory }
            if !replica.seen.contains(batch.id) { waiting[batch.id] = batch }
        }
        while !waiting.isEmpty {
            let seen = Set(replica.seen)
            let ready = waiting.values.filter { Set($0.parents).isSubset(of: seen) }.sorted { $0.id.uuidString < $1.id.uuidString }
            guard !ready.isEmpty else { throw DriveSyncError.missingHistory }
            for batch in ready { try apply(batch, to: &replica); waiting.removeValue(forKey: batch.id) }
        }
        var projected = snapshot
        projected.driveReplicas[index] = replica
        try project(replica, into: &projected)
        try WorkspaceRules.validate(projected)
        snapshot = projected
    }
    public static func resolve(_ snapshot: inout WorkspaceSnapshot, organizationID: UUID, key: String, versionID: UUID, deviceName: String) throws {
        guard let index = snapshot.driveReplicas.firstIndex(where: { $0.organizationID == organizationID }) else { throw DriveSyncError.wrongWorkspace }
        var replica = snapshot.driveReplicas[index]
        guard replica.canEdit else { throw DriveSyncError.readOnly }
        guard let versions = replica.versions[key], versions.count > 1,
              let version = versions.first(where: { $0.batchID == versionID }) else { throw DriveSyncError.conflict }
        let batch = DriveBatch(organizationID: organizationID, deviceName: deviceName, parents: replica.heads, changes: [DriveChange(key: key, replaces: versions.map(\.batchID), value: version.value)])
        try apply(batch, to: &replica)
        replica.outbox.append(batch)
        var result = snapshot; result.driveReplicas[index] = replica
        try project(replica, into: &result); try WorkspaceRules.validate(result)
        snapshot = result
    }
    private static func apply(_ batch: DriveBatch, to replica: inout DriveReplica) throws {
        guard batch.protocolVersion == 1, batch.organizationID == replica.organizationID,
              !batch.changes.isEmpty, batch.changes.count <= 100_000,
              Set(batch.changes.map(\.key)).count == batch.changes.count,
              Set(batch.parents).count == batch.parents.count,
              Set(batch.parents).isSubset(of: Set(replica.seen)),
              !batch.parents.contains(batch.id), !replica.seen.contains(batch.id)
        else { throw DriveSyncError.invalidHistory }
        // Only the initial batch may have no parents.
        guard !batch.parents.isEmpty || replica.seen.isEmpty else { throw DriveSyncError.invalidHistory }
        for change in batch.changes {
            guard Set(change.replaces).isSubset(of: Set(replica.seen)),
                  Set(change.replaces).count == change.replaces.count else { throw DriveSyncError.invalidHistory }
            var current = replica.versions[change.key, default: []]
            current.removeAll { change.replaces.contains($0.batchID) }
            current.append(DriveVersion(batchID: batch.id, deviceName: batch.deviceName, createdAt: batch.createdAt, value: change.value))
            replica.versions[change.key] = current.sorted { $0.batchID.uuidString < $1.batchID.uuidString }
        }
        replica.heads.removeAll { batch.parents.contains($0) }
        replica.heads.append(batch.id); replica.heads.sort { $0.uuidString < $1.uuidString }
        replica.seen.append(batch.id)
    }
    private static func value<T: Encodable>(_ item: T) throws -> JSONValue {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        return try JSONDecoder().decode(JSONValue.self, from: encoder.encode(item))
    }
    private static func decode<T: Decodable>(_ value: JSONValue, as type: T.Type) throws -> T {
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(type, from: JSONEncoder().encode(value))
    }
    /// Logical pairs coalesce independently created roster rows. Coupled lists
    /// (volunteer capacity and group memberships) are one conflict unit.
    public static func entities(_ s: WorkspaceSnapshot, organizationID: UUID) throws -> [String: JSONValue] {
        var result: [String: JSONValue] = [:]
        func add<T: Encodable & Identifiable>(_ items: [T], _ kind: String) throws where T.ID == UUID {
            for item in items { result["\(kind):\(item.id.uuidString)"] = try value(item) }
        }
        try add(s.organizations.filter { $0.id == organizationID }, "organization")
        try add(s.periods.filter { $0.organizationID == organizationID }, "period")
        let members = s.members.filter { $0.organizationID == organizationID }; try add(members, "member")
        try add(s.groups.filter { $0.organizationID == organizationID }, "group")
        let components = s.components.filter { $0.organizationID == organizationID }; try add(components, "component")
        let componentIDs = Set(components.map(\.id))
        try add(s.categories.filter { componentIDs.contains($0.componentID) }, "category")
        let events = s.events.filter { $0.organizationID == organizationID }; try add(events, "event")
        let eventIDs = Set(events.map(\.id))
        for row in s.attendance where eventIDs.contains(row.eventID) {
            result["attendance:\(row.eventID):\(row.memberID)"] = try value(row)
        }
        for member in members {
            result["memberships:\(member.id)"] = try value(s.memberships.filter { $0.memberID == member.id }.sorted { $0.id.uuidString < $1.id.uuidString })
        }
        for event in events where event.volunteerCapacity != nil {
            result["volunteers:\(event.id)"] = try value(s.volunteers.filter { $0.eventID == event.id }.sorted { $0.id.uuidString < $1.id.uuidString })
        }
        try add(s.templates.filter { $0.organizationID == organizationID }, "template")
        return result
    }
    private static func project(_ replica: DriveReplica, into s: inout WorkspaceSnapshot) throws {
        let orgID = replica.organizationID
        let oldMemberIDs = Set(s.members.filter { $0.organizationID == orgID }.map(\.id))
        let oldEventIDs = Set(s.events.filter { $0.organizationID == orgID }.map(\.id))
        let oldComponentIDs = Set(s.components.filter { $0.organizationID == orgID }.map(\.id))
        s.organizations.removeAll { $0.id == orgID }; s.periods.removeAll { $0.organizationID == orgID }
        s.members.removeAll { $0.organizationID == orgID }; s.groups.removeAll { $0.organizationID == orgID }
        s.memberships.removeAll { oldMemberIDs.contains($0.memberID) }
        s.components.removeAll { $0.organizationID == orgID }; s.categories.removeAll { oldComponentIDs.contains($0.componentID) }
        s.events.removeAll { $0.organizationID == orgID }; s.attendance.removeAll { oldEventIDs.contains($0.eventID) }
        s.volunteers.removeAll { oldEventIDs.contains($0.eventID) }; s.templates.removeAll { $0.organizationID == orgID }
        for key in replica.versions.keys.sorted() {
            guard let selected = replica.versions[key]?.first else { throw DriveSyncError.invalidHistory }
            let v = selected.value, parts = key.split(separator: ":").map(String.init)
            func entity<T: Decodable & Identifiable>(_ type: T.Type) throws -> T where T.ID == UUID {
                let item = try decode(v, as: type)
                guard parts.count == 2, item.id.uuidString == parts[1] else { throw DriveSyncError.invalidHistory }; return item
            }
            switch parts.first {
            case "organization": s.organizations.append(try entity(Organization.self))
            case "period": s.periods.append(try entity(WorkPeriod.self))
            case "member": s.members.append(try entity(Member.self))
            case "group": s.groups.append(try entity(MemberGroup.self))
            case "component": s.components.append(try entity(ActivityComponent.self))
            case "category": s.categories.append(try entity(ActivityCategory.self))
            case "event": s.events.append(try entity(ActivityEvent.self))
            case "template": s.templates.append(try entity(DocumentTemplate.self))
            case "attendance":
                let row = try decode(v, as: AttendanceEntry.self)
                guard key == "attendance:\(row.eventID):\(row.memberID)" else { throw DriveSyncError.invalidHistory }
                s.attendance.append(row)
            case "memberships":
                let rows = try decode(v, as: [GroupMembership].self)
                guard parts.count == 2, rows.allSatisfy({ $0.memberID.uuidString == parts[1] }) else { throw DriveSyncError.invalidHistory }
                s.memberships.append(contentsOf: rows)
            case "volunteers":
                let rows = try decode(v, as: [VolunteerEntry].self)
                guard parts.count == 2, rows.allSatisfy({ $0.eventID.uuidString == parts[1] }) else { throw DriveSyncError.invalidHistory }
                s.volunteers.append(contentsOf: rows)
            default: throw DriveSyncError.invalidHistory
            }
        }
        // Prevent a validly encoded foreign entity from escaping its folder.
        let expected = try entities(s, organizationID: orgID)
        guard Set(expected.keys) == Set(replica.versions.keys) else { throw DriveSyncError.wrongWorkspace }
    }
}
