import Foundation
import NexoCore

public enum WorkspaceError: LocalizedError {
    case invalidInput(String), stale, unavailable
    public var errorDescription: String? {
        switch self {
        case .invalidInput(let message): message
        case .stale: NexoLocale.text("Los datos cambiaron. Vuelve a abrir el espacio antes de guardar.")
        case .unavailable: NexoLocale.text("No se pudo abrir el espacio. Recupera una copia para continuar.")
        }
    }
}

/// The web surface can request domain commands, never replace the whole store.
@MainActor
public final class WorkspaceStore {
    public let store: SnapshotStore
    public private(set) var copiedPreview = false
    public init(directory: URL, previewDirectory: URL? = nil) throws {
        store = SnapshotStore(directory: directory)
        if !FileManager.default.fileExists(atPath: store.primaryURL.path) {
            if let previewDirectory,
               FileManager.default.fileExists(atPath: previewDirectory.appendingPathComponent("workspace-v1.json").path) {
                let previous = try SnapshotStore(directory: previewDirectory).load()
                try store.initialize(previous)
                copiedPreview = !previous.organizations.isEmpty
            } else {
                try store.initialize()
            }
        }
        _ = try store.load()
    }
    public func load() throws -> WorkspaceSnapshot { try store.load() }
    public func perform(_ action: [String: Any], expectedRevision: UInt64) throws -> WorkspaceSnapshot {
        let previous = try store.load()
        guard previous.revision == expectedRevision else { throw WorkspaceError.stale }
        var next = previous
        let input = Input(action)
        let kind = try input.string("kind")
        if kind != "setOrganizationDeleted",
           let orgID = Self.organizationID(for: action, in: previous),
           previous.organizations.contains(where: { $0.id == orgID && $0.deletedAt != nil }) {
            throw WorkspaceError.invalidInput(NexoLocale.text("Este espacio está en Papelera. Restáuralo antes de editarlo."))
        }
        switch kind {
        case "setOrganizationDeleted":
            let orgID = try input.uuid("organizationID"), deleted = try input.bool("deleted")
            guard let index = next.organizations.firstIndex(where: { $0.id == orgID }) else {
                throw WorkspaceError.invalidInput(NexoLocale.text("No se encontró el espacio."))
            }
            guard (next.organizations[index].deletedAt != nil) == (try input.bool("expectedDeleted")),
                  action["expectedName"] as? String == next.organizations[index].name else {
                throw WorkspaceError.invalidInput(NexoLocale.text("El espacio cambió. Revisa su estado antes de continuar."))
            }
            if next.driveReplicas.contains(where: { $0.organizationID == orgID && !$0.canEdit }) {
                throw DriveSyncError.readOnly
            }
            next.organizations[index].deletedAt = deleted ? .now : nil
        case "createOrganization":
            let org = Organization(id: try input.uuid("id"), name: try input.name(), accentHex: "#262629")
            next.organizations.append(org)
        case "addMember":
            let orgID = try input.uuid("organizationID")
            let member = Member(id: try input.uuid("id"), organizationID: orgID, name: try input.name())
            next.members.append(member)
            for groupID in try input.uuids("groupIDs", optional: true) {
                guard next.groups.contains(where: { $0.id == groupID && $0.organizationID == orgID }) else { throw WorkspaceError.invalidInput(NexoLocale.text("El grupo no pertenece a este espacio.")) }
                next.memberships.append(GroupMembership(memberID: member.id, groupID: groupID, startsAt: .now))
            }
        case "updateMember":
            let memberID = try input.uuid("memberID")
            guard let index = next.members.firstIndex(where: { $0.id == memberID }) else { throw WorkspaceCommandError.memberNotFound }
            if let expectedName = action["expectedName"] as? String, expectedName != next.members[index].name { throw WorkspaceError.invalidInput(NexoLocale.text("El nombre cambió desde que comenzaste a editar. Tu texto sigue en el campo; revisa la versión actual antes de guardarlo.")) }
            if action["name"] != nil { next.members[index].name = try input.name() }
            if let active = action["isActive"] as? Bool { next.members[index].isActive = active }
        case "memberGroups":
            let memberID = try input.uuid("memberID"), wanted = Set(try input.uuids("groupIDs")), now = Date()
            guard let member = next.members.first(where: { $0.id == memberID }),
                  wanted.allSatisfy({ groupID in next.groups.contains { $0.id == groupID && $0.organizationID == member.organizationID } })
            else { throw WorkspaceError.invalidInput(NexoLocale.text("El grupo no pertenece a este espacio.")) }
            if let expected = action["expectedGroupIDs"] as? [String] {
                let current = Set(next.memberships.filter { $0.memberID == memberID && $0.endsAt == nil }.map { $0.groupID.uuidString })
                guard current == Set(expected.map { $0.uppercased() }) else { throw WorkspaceError.invalidInput(NexoLocale.text("Los grupos cambiaron desde que comenzaste a editar. Cierra la edición y revísalos.")) }
            }
            for index in next.memberships.indices where next.memberships[index].memberID == memberID && next.memberships[index].endsAt == nil && !wanted.contains(next.memberships[index].groupID) {
                next.memberships[index].endsAt = max(now, next.memberships[index].startsAt.addingTimeInterval(1))
            }
            for groupID in wanted where !next.memberships.contains(where: { $0.memberID == memberID && $0.groupID == groupID && $0.endsAt == nil }) {
                next.memberships.append(GroupMembership(memberID: memberID, groupID: groupID, startsAt: now))
            }
        case "addComponent":
            next.components.append(ActivityComponent(id: try input.uuid("id"), organizationID: try input.uuid("organizationID"), name: try input.name()))
        case "addGroup":
            next.groups.append(MemberGroup(id: try input.uuid("id"), organizationID: try input.uuid("organizationID"), name: try input.name()))
        case "addCategory":
            next.categories.append(ActivityCategory(id: try input.uuid("id"), componentID: try input.uuid("componentID"), name: try input.name()))
        case "addPeriod":
            let period = try input.entity(WorkPeriod.self)
            guard period.endsAt > period.startsAt else { throw WorkspaceError.invalidInput(NexoLocale.text("El último día debe ser posterior al inicio.")) }
            next.periods.append(period)
        case "updatePeriod":
            let period = try input.entity(WorkPeriod.self)
            guard let index = next.periods.firstIndex(where: { $0.id == period.id && $0.organizationID == period.organizationID }) else { throw WorkspaceError.invalidInput(NexoLocale.text("No se encontró el período.")) }
            guard period.endsAt > period.startsAt, !period.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw WorkspaceError.invalidInput(NexoLocale.text("Revisa el nombre y las fechas del período.")) }
            next.periods[index] = period
        case "addEvent": next.events.append(try input.entity(ActivityEvent.self))
        case "updateEvent":
            let event = try input.entity(ActivityEvent.self)
            guard !event.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw WorkspaceError.invalidInput(NexoLocale.text("Escribe el nombre del encuentro.")) }
            do { try next.updateEvent(event) } catch WorkspaceCommandError.capacityReached {
                throw WorkspaceError.invalidInput(NexoLocale.text("Hay más voluntarios seleccionados que cupos."))
            } catch WorkspaceCommandError.volunteerUnavailable {
                throw WorkspaceError.invalidInput(NexoLocale.text("Este encuentro ya tiene voluntarios. Ajusta los cupos en lugar de quitarlos."))
            }
        case "rename":
            let id = try input.uuid("id"), name = try input.name()
            switch try input.string("entity") {
            case "organization":
                guard let index = next.organizations.firstIndex(where: { $0.id == id }) else { throw WorkspaceError.invalidInput(NexoLocale.text("No se encontró el espacio.")) }
                next.organizations[index].name = name
            case "component":
                guard let index = next.components.firstIndex(where: { $0.id == id }) else { throw WorkspaceError.invalidInput(NexoLocale.text("No se encontró el componente.")) }
                next.components[index].name = name
            case "category":
                guard let index = next.categories.firstIndex(where: { $0.id == id }) else { throw WorkspaceError.invalidInput(NexoLocale.text("No se encontró la categoría.")) }
                next.categories[index].name = name
            case "group":
                guard let index = next.groups.firstIndex(where: { $0.id == id }) else { throw WorkspaceError.invalidInput(NexoLocale.text("No se encontró el grupo.")) }
                next.groups[index].name = name
            default: throw WorkspaceError.invalidInput(NexoLocale.text("Esta acción no está disponible."))
            }
        case "cancelEvent":
            let eventID = try input.uuid("eventID")
            guard let index = next.events.firstIndex(where: { $0.id == eventID }) else { throw WorkspaceCommandError.eventNotFound }
            next.events[index].isCancelled = try input.bool("cancelled")
        case "roster": try next.addAttendanceMembers(eventID: input.uuid("eventID"), memberIDs: Set(input.uuids("memberIDs")))
        case "attendance":
            let eventID = try input.uuid("eventID"), memberID = try input.uuid("memberID")
            guard var status = AttendanceStatus(rawValue: try input.string("status")) else { throw WorkspaceError.invalidInput(NexoLocale.text("El estado no es válido.")) }
            if let expected = action["expectedStatus"] as? String,
               next.attendance.first(where: { $0.eventID == eventID && $0.memberID == memberID })?.status.rawValue != expected {
                throw WorkspaceError.invalidInput(NexoLocale.text("Este registro cambió. Revisa su estado actual antes de modificarlo."))
            }
            let oldNote = next.attendance.first { $0.eventID == eventID && $0.memberID == memberID }?.note ?? ""
            if let expectedNote = action["expectedNote"] as? String, expectedNote != oldNote { throw WorkspaceError.invalidInput(NexoLocale.text("La nota cambió en otro dispositivo. Tu texto sigue en el campo; revisa la nota actual antes de guardarlo.")) }
            if action["noteOnly"] as? Bool == true { status = next.attendance.first { $0.eventID == eventID && $0.memberID == memberID }?.status ?? status }
            try next.setAttendance(eventID: eventID, memberID: memberID, status: status, note: action["note"] as? String ?? oldNote)
        case "inclusion": try next.setAttendanceInclusion(eventID: input.uuid("eventID"), memberID: input.uuid("memberID"), included: input.bool("included"))
        case "registerVolunteers":
            let eventID = try input.uuid("eventID")
            for memberID in try input.uuids("memberIDs") { try next.registerVolunteer(eventID: eventID, memberID: memberID) }
        case "volunteer":
            let eventID = try input.uuid("eventID"), memberID = try input.uuid("memberID")
            switch try input.string("status") {
            case "selected": try next.selectVolunteer(eventID: eventID, memberID: memberID)
            case "completed": try next.finishVolunteer(eventID: eventID, memberID: memberID, participated: true)
            case "noShow": try next.finishVolunteer(eventID: eventID, memberID: memberID, participated: false)
            case "declined": try next.declineVolunteer(eventID: eventID, memberID: memberID)
            default: throw WorkspaceError.invalidInput(NexoLocale.text("El cambio de voluntariado no es válido."))
            }
        case "saveTemplate":
            let template = try input.entity(DocumentTemplate.self)
            if let expected = action["expectedTemplate"], !(expected is NSNull) {
                let base = try Self.decoder().decode(DocumentTemplate.self, from: JSONSerialization.data(withJSONObject: expected))
                guard next.templates.first(where: { $0.id == template.id }) == base else { throw WorkspaceError.invalidInput(NexoLocale.text("La plantilla cambió en otro dispositivo. Guarda tu diseño como una nueva plantilla para conservar ambas versiones.")) }
            }
            if let index = next.templates.firstIndex(where: { $0.id == template.id }) { next.templates[index] = template }
            else { next.templates.append(template) }
        default: throw WorkspaceError.invalidInput(NexoLocale.text("Esta acción no está disponible."))
        }
        try SyncPlanner.captureChanges(from: previous, into: &next)
        try DriveSync.capture(from: previous, into: &next, deviceName: DeviceIdentity.name)
        return try store.save(next, expectedRevision: previous.revision)
    }
    public nonisolated static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601; return encoder
    }
    private static func organizationID(for action: [String: Any], in snapshot: WorkspaceSnapshot) -> UUID? {
        func uuid(_ key: String) -> UUID? { (action[key] as? String).flatMap(UUID.init(uuidString:)) }
        if let direct = uuid("organizationID") { return direct }
        if let entity = action["entity"] as? [String: Any],
           let raw = entity["organizationID"] as? String { return UUID(uuidString: raw) }
        if let event = uuid("eventID") { return snapshot.events.first { $0.id == event }?.organizationID }
        if let member = uuid("memberID") { return snapshot.members.first { $0.id == member }?.organizationID }
        if let component = uuid("componentID") { return snapshot.components.first { $0.id == component }?.organizationID }
        if action["kind"] as? String == "rename", let id = uuid("id") {
            switch action["entity"] as? String {
            case "organization"?: return id
            case "component"?: return snapshot.components.first { $0.id == id }?.organizationID
            case "group"?: return snapshot.groups.first { $0.id == id }?.organizationID
            case "category"?:
                let componentID = snapshot.categories.first { $0.id == id }?.componentID
                return snapshot.components.first { $0.id == componentID }?.organizationID
            default: return nil
            }
        }
        return nil
    }
    public nonisolated static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let format = ISO8601DateFormatter()
            format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = format.date(from: value) { return date }
            format.formatOptions = [.withInternetDateTime]
            guard let date = format.date(from: value) else { throw WorkspaceError.invalidInput(NexoLocale.text("La fecha no es válida.")) }
            return date
        }
        return decoder
    }
}
private struct Input {
    let values: [String: Any]
    init(_ values: [String: Any]) { self.values = values }
    func string(_ key: String) throws -> String {
        guard let value = values[key] as? String else { throw WorkspaceError.invalidInput(NexoLocale.text("Falta el campo {0}.", key)) }; return value
    }
    func name() throws -> String {
        let value = try string("name").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty && value.count <= 200 else { throw WorkspaceError.invalidInput(NexoLocale.text("Escribe un nombre de hasta 200 caracteres.")) }; return value
    }
    func uuid(_ key: String) throws -> UUID {
        guard let value = UUID(uuidString: try string(key)) else { throw WorkspaceError.invalidInput(NexoLocale.text("El identificador no es válido.")) }; return value
    }
    func uuids(_ key: String, optional: Bool = false) throws -> [UUID] {
        if optional && values[key] == nil { return [] }
        guard let raw = values[key] as? [String], raw.count <= 10000 else { throw WorkspaceError.invalidInput(NexoLocale.text("La selección no es válida.")) }
        let result = raw.compactMap(UUID.init(uuidString:))
        guard result.count == raw.count && Set(result).count == result.count else { throw WorkspaceError.invalidInput(NexoLocale.text("La selección contiene registros repetidos.")) }; return result
    }
    func bool(_ key: String) throws -> Bool {
        guard let value = values[key] as? Bool else { throw WorkspaceError.invalidInput(NexoLocale.text("La opción no es válida.")) }; return value
    }
    func entity<T: Decodable>(_ type: T.Type) throws -> T {
        guard let value = values["entity"] else { throw WorkspaceError.invalidInput(NexoLocale.text("Faltan los datos.")) }
        return try WorkspaceStore.decoder().decode(type, from: JSONSerialization.data(withJSONObject: value))
    }
}
