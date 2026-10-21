import Foundation
import VRRCore

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fatalError(message) }
}

let day: TimeInterval = 86_400
let start = Date(timeIntervalSince1970: 1_700_000_000)
let organization = Organization(name: "Asociación")
let period = WorkPeriod(organizationID: organization.id, name: "Semestre", startsAt: start, endsAt: start.addingTimeInterval(30 * day))
let component = ActivityComponent(organizationID: organization.id, name: "Servicio")
let category = ActivityCategory(componentID: component.id, name: "Clínicas")
let otherCategory = ActivityCategory(componentID: component.id, name: "Ferias")
let alex = Member(organizationID: organization.id, name: "Alex")
let bea = Member(organizationID: organization.id, name: "Bea")
let carlos = Member(organizationID: organization.id, name: "Carlos")
let target = ActivityEvent(organizationID: organization.id, title: "Clínica", startsAt: start.addingTimeInterval(20 * day), componentID: component.id, categoryID: category.id, volunteerCapacity: 2)
let prior = ActivityEvent(organizationID: organization.id, title: "Clínica previa", startsAt: start.addingTimeInterval(5 * day), componentID: component.id, categoryID: category.id, volunteerCapacity: 2)
let unrelated = ActivityEvent(organizationID: organization.id, title: "Feria", startsAt: start.addingTimeInterval(6 * day), componentID: component.id, categoryID: otherCategory.id, volunteerCapacity: 2)

var snapshot = WorkspaceSnapshot()
snapshot.organizations = [organization]
snapshot.periods = [period]
snapshot.members = [alex, bea, carlos]
snapshot.components = [component]
snapshot.categories = [category, otherCategory]
snapshot.events = [target, prior, unrelated]
snapshot.attendance = [
    AttendanceEntry(eventID: target.id, memberID: alex.id, status: .present),
    AttendanceEntry(eventID: prior.id, memberID: alex.id, status: .absent),
    AttendanceEntry(eventID: unrelated.id, memberID: alex.id, status: .excused)
]
snapshot.volunteers = [
    VolunteerEntry(eventID: target.id, memberID: alex.id, registeredAt: start),
    VolunteerEntry(eventID: target.id, memberID: bea.id, registeredAt: start),
    VolunteerEntry(eventID: target.id, memberID: carlos.id, registeredAt: start),
    VolunteerEntry(eventID: prior.id, memberID: alex.id, status: .completed),
    VolunteerEntry(eventID: prior.id, memberID: carlos.id, status: .selected),
    VolunteerEntry(eventID: unrelated.id, memberID: bea.id, status: .completed)
]
try WorkspaceRules.validate(snapshot)

let attendance = WorkspaceRules.attendance(for: alex.id, in: period, snapshot: snapshot)
require(attendance.present == 1 && attendance.absent == 1 && attendance.excused == 1, "attendance counts")
require(attendance.percentage == 0.5, "excused event excluded from denominator")
let suggestions = WorkspaceRules.volunteerSuggestions(for: target, in: period, snapshot: snapshot)
require(suggestions.count == 3, "interested volunteers")
require(Set(suggestions.prefix(2).map(\.memberID)) == Set([bea.id, carlos.id]), "zero participation first")
require(suggestions.last?.memberID == alex.id, "category history used for priority")

var commands = snapshot
let freshEvent = ActivityEvent(organizationID: organization.id, title: "Nueva actividad", startsAt: start.addingTimeInterval(22 * day), componentID: component.id, volunteerCapacity: 1)
commands.events.append(freshEvent)
try commands.createAttendanceList(eventID: freshEvent.id, memberIDs: [alex.id, bea.id])
require(commands.attendance.filter { $0.eventID == freshEvent.id }.count == 2, "explicit attendance roster")
try commands.setAttendance(eventID: freshEvent.id, memberID: alex.id, status: .excused)
require(WorkspaceRules.attendance(for: alex.id, in: period, snapshot: commands).excused == 2, "excuse recorded")
try commands.registerVolunteer(eventID: freshEvent.id, memberID: alex.id)
try commands.registerVolunteer(eventID: freshEvent.id, memberID: bea.id)
try commands.selectVolunteer(eventID: freshEvent.id, memberID: alex.id)
do {
    try commands.selectVolunteer(eventID: freshEvent.id, memberID: bea.id)
    fatalError("capacity overfilled")
} catch WorkspaceCommandError.capacityReached {}
try commands.finishVolunteer(eventID: freshEvent.id, memberID: alex.id, participated: true)
require(commands.volunteers.first { $0.eventID == freshEvent.id && $0.memberID == alex.id }?.status == .completed, "completed service credited")
try WorkspaceRules.validate(commands)

let directory = FileManager.default.temporaryDirectory.appendingPathComponent("vrrcore-check-\(UUID().uuidString)")
defer { try? FileManager.default.removeItem(at: directory) }
let store = SnapshotStore(directory: directory)
try store.initialize()
let saved = try store.save(snapshot, expectedRevision: 0)
require(saved.revision == 1, "revision advances")
let roundTrip = try store.load()
require(roundTrip.attendance.count == 3, "snapshot round trip")
do {
    _ = try store.save(snapshot, expectedRevision: 0)
    fatalError("stale write accepted")
} catch SnapshotStoreError.staleRevision {}

let damaged = Data("{damaged".utf8)
try damaged.write(to: store.primaryURL, options: .atomic)
do {
    _ = try store.load()
    fatalError("damaged file accepted")
} catch SnapshotStoreError.corruptPrimary {}
let damagedAfterLoad = try Data(contentsOf: store.primaryURL)
require(damagedAfterLoad == damaged, "damaged bytes preserved")
let backup = try store.availableBackups().first!
_ = try store.restoreBackup(at: backup)
let recovered = try store.load()
require(recovered.revision == 0, "backup restored explicitly")

print("VRRCore checks passed: attendance, volunteer order, workflow, validation, revisions, damage protection, recovery")

if CommandLine.arguments.contains("--pdf-demo") {
    let output = URL(fileURLWithPath: CommandLine.arguments.last!)
    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
    let demoOrganization = Organization(name: "Asociación de ejemplo")
    let demoEvent = ActivityEvent(
        organizationID: demoOrganization.id, title: "Jornada de servicio comunitario",
        startsAt: Date(timeIntervalSince1970: 1_791_220_800), componentID: UUID()
    )
    let demoTemplate = DocumentTemplate(organizationID: demoOrganization.id, name: "Registro con firmas")
    let demoEntries = (1...44).map { number in
        AttendanceEntry(
            eventID: demoEvent.id, memberID: UUID(),
            status: [.present, .absent, .excused, .pending][number % 4],
            note: number == 12 ? "Llegó después del inicio y completó el turno asignado." : "",
            memberNameSnapshot: number == 13
                ? "Miembro 13, nombre de ejemplo especialmente largo para comprobar el ajuste de línea"
                : String(format: "Miembro %02d", number)
        )
    }
    try await MainActor.run {
        try AttendancePDF.render(
            organization: demoOrganization, event: demoEvent,
            entries: demoEntries, template: demoTemplate, mode: .blank,
            to: output.appendingPathComponent("VRR-ejemplo-hoja-para-firmas.pdf")
        )
        try AttendancePDF.render(
            organization: demoOrganization, event: demoEvent,
            entries: demoEntries, template: demoTemplate, mode: .completed,
            to: output.appendingPathComponent("VRR-ejemplo-asistencia-registrada.pdf")
        )
    }
    print("PDF demos generated: 2")
} else if CommandLine.arguments.count > 1 {
    let source = URL(fileURLWithPath: CommandLine.arguments[1])
    let bytes = try Data(contentsOf: source)
    let imported = try LegacyImporter.importData(bytes, organizationName: "Asociación importada")
    print("Legacy import validated: \(imported.snapshot.members.count) members, \(imported.snapshot.events.count) events, \(imported.importedAttendanceLists) lists, \(imported.snapshot.attendance.count) entries")
}
