import Foundation
import PDFKit
import UIKit
import XCTest
import NexoCore
import NexoKit
@testable import Nexo

@MainActor
final class IOSPersistenceTests: XCTestCase {
    func testDraftSurvivesRestartWithoutSavingOrUploadingTemplate() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try WorkspaceStore(directory: root)
        let orgID = UUID()
        let snapshot = try store.perform(["kind":"createOrganization", "id":orgID.uuidString, "name":"Prueba iOS"], expectedRevision: 0)
        var template = DocumentTemplate(organizationID: orgID, name: "Borrador sin guardar")
        template.footerText = "Edición recuperable"
        let object = try JSONSerialization.jsonObject(with: WorkspaceStore.encoder().encode(template))
        let drafts = IOSDraftStore(directory: root)
        try drafts.save(["dirty":true, "organizationID":orgID.uuidString, "template":object])
        let reopened = try IOSDraftStore(directory: root).read()
        XCTAssertEqual((reopened?["template"] as? [String:Any])?["footerText"] as? String, "Edición recuperable")
        XCTAssertEqual(try WorkspaceStore(directory: root).load(), snapshot)
        XCTAssertTrue(try store.load().driveReplicas.isEmpty)
        try drafts.save(["dirty": false])
        XCTAssertNil(try drafts.read())
    }
    func testUIKitPDFRendersEveryRowAndCanBeReopened() throws {
        let org = Organization(name: "Equipo iOS")
        let event = ActivityEvent(organizationID: org.id, title: "Encuentro de prueba", startsAt: .now, componentID: UUID())
        let entries = (1...55).map { AttendanceEntry(eventID: event.id, memberID: UUID(), status: $0 == 1 ? .excused : .present, note: "Nota de la persona \($0)", memberNameSnapshot: "Persona \($0)") }
        var template = DocumentTemplate(organizationID: org.id, name: "Lista", columns: [.participant, .excused, .notes])
        template.headerTitle = "Lista de asistencia"
        template.footerText = "Nexo para iOS"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ios-pdf-\(UUID()).pdf")
        defer { try? FileManager.default.removeItem(at: url) }
        try AttendancePDF.render(organization: org, event: event, entries: entries, template: template, mode: .completed, to: url)
        let attachment = XCTAttachment(data: try Data(contentsOf: url), uniformTypeIdentifier: "com.adobe.pdf")
        attachment.name = "Nexo-iOS-attendance.pdf"; attachment.lifetime = .keepAlways; add(attachment)
        let pdf = try XCTUnwrap(PDFDocument(url: url))
        XCTAssertGreaterThan(pdf.pageCount, 1)
        let text = pdf.string ?? ""
        XCTAssertTrue(text.contains("Persona 55"))
        XCTAssertTrue(text.contains("Lista de asistencia"))
        XCTAssertTrue(text.contains("Nota de la persona 55"))
        XCTAssertNotNil(pdf.page(at: 0)?.thumbnail(of: CGSize(width: 612, height: 792), for: .mediaBox).pngData())
    }
}
