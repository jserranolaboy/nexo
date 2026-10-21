import Foundation
import NexoCore

public enum DrivePresentation {
    public static func conflictSummary(_ value: JSONValue, key: String, snapshot: WorkspaceSnapshot) -> String {
        func text(_ values: [String: JSONValue], _ key: String) -> String { if case .string(let value) = values[key] { return value }; return "" }
        let labels = ["present": NexoLocale.text("Presente"), "absent": NexoLocale.text("Ausente"), "excused": NexoLocale.text("Excusada"), "pending": NexoLocale.text("Pendiente"), "interested": "Interesado", "selected": "Seleccionado", "completed": NexoLocale.text("Participó"), "noShow": NexoLocale.text("No participó"), "declined": "Retirado"]
        switch value {
        case .object(let item):
            if key.hasPrefix("attendance:") {
                let name = text(item, "memberNameSnapshot"), status = text(item, "status"), note = text(item, "note")
                let excluded = item["isVoided"] == .bool(true) ? " · Fuera de la lista" : ""
                return name + " · " + (labels[status] ?? status) + excluded + (note.isEmpty ? "" : "\n" + note)
            }
            let title = [text(item, "name"), text(item, "title")].first { !$0.isEmpty } ?? NexoLocale.text("Registro")
            var details = [title]
            if key.hasPrefix("organization:") { details.append(text(item, "deletedAt").isEmpty ? "Activo" : NexoLocale.text("En Papelera")) }
            if case .bool(let active) = item["isActive"] { details.append(active ? "Activa" : NexoLocale.text("Archivada")) }
            if case .bool(let cancelled) = item["isCancelled"], cancelled { details.append(NexoLocale.text("Cancelado")) }
            if !text(item, "startsAt").isEmpty { details.append(text(item, "startsAt")) }
            if key.hasPrefix("template:") {
                if case .array(let blocks) = item["textBlocks"] {
                    details += blocks.compactMap { if case .object(let block) = $0 { return text(block, "text") }; return nil }
                }
                details.append(NexoLocale.text("Plantilla completa conservada en el historial"))
            }
            return details.joined(separator: "\n")
        case .array(let rows):
            if rows.isEmpty { return NexoLocale.text("Lista vacía") }
            return rows.compactMap { row -> String? in
                guard case .object(let item) = row else { return nil }
                let memberID = text(item, "memberID"), groupID = text(item, "groupID"), status = text(item, "status")
                let member = snapshot.members.first { $0.id.uuidString == memberID }?.name ?? NexoLocale.text("Persona")
                if !groupID.isEmpty {
                    let group = snapshot.groups.first { $0.id.uuidString == groupID }?.name ?? NexoLocale.text("Grupo")
                    return member + " · " + group + (item["endsAt"] == nil || item["endsAt"] == .null ? "" : " " + NexoLocale.text("(anterior)"))
                }
                return member + " · " + (labels[status] ?? status)
            }.joined(separator: "\n")
        default: return NexoLocale.text("Registro")
        }
    }
}
