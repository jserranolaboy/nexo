import XCTest
import NexoInterfazUI

final class EmbeddedKernelTests: XCTestCase {
    func testWindowActionsRunInsideJavaScriptCore() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("nexo-jscore-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        XCTAssertFalse(directory.path.contains("Application Support"))

        let wrote = EmbeddedKernel.press(directory: directory, action: "attendance", lang: "es")
        XCTAssertTrue(wrote.contains("Persona Alfa: presente; 1/1"), wrote)
        XCTAssertTrue(wrote.contains("Persona Beta: ausente; 0/1"), wrote)
        XCTAssertTrue(wrote.contains("Persona Gamma: sin registro; sin encuentros evaluables"), wrote)
        XCTAssertFalse(wrote.contains("Persona Gamma: ausente"))
        let attendance = directory.appendingPathComponent("asistencia/nexo-reconstruction-v1.json")
        let before = try Data(contentsOf: attendance)

        let read = EmbeddedKernel.press(directory: directory, action: "attendance-read", lang: "en")
        XCTAssertTrue(read.contains("Persona Alfa: present; 1/1"), read)
        XCTAssertTrue(read.contains("Persona Gamma: no record; no countable encounters"), read)
        XCTAssertFalse(read.contains("Persona Gamma: absent"))
        XCTAssertEqual(try Data(contentsOf: attendance), before)

        let document = EmbeddedKernel.press(directory: directory, action: "document", lang: "es")
        XCTAssertTrue(document.contains("Borrador: Nota breve"), document)
        XCTAssertTrue(document.contains("No cabe: Persona Alfa\nLinea uno\nLinea dos\nLinea tres\nLinea cuatro"), document)
        let pdf = directory.appendingPathComponent("documentos/document-drafts/export.pdf")
        XCTAssertEqual(try Data(contentsOf: pdf).prefix(5), Data("%PDF-".utf8))

        let volunteers = EmbeddedKernel.press(directory: directory, action: "volunteers", lang: "es")
        XCTAssertTrue(volunteers.contains("Sugerencia: Persona Tardía"), volunteers)
        XCTAssertTrue(volunteers.contains("Persona Cero: seleccionado en Encuentro actual"), volunteers)
        XCTAssertTrue(volunteers.contains("Rechazo de cupo: capacity-exceeded"), volunteers)

        let collaboration = EmbeddedKernel.press(directory: directory, action: "collaboration", lang: "es")
        XCTAssertTrue(collaboration.contains("Sincronización: en pausa"), collaboration)
        XCTAssertTrue(collaboration.contains("Subidas pendientes: ninguna"), collaboration)
        XCTAssertTrue(collaboration.contains("alternativa-local"), collaboration)
        XCTAssertTrue(collaboration.contains("alternativa-remota"), collaboration)
        let chosen = EmbeddedKernel.press(directory: directory, action: "collaboration-choose", lang: "en")
        XCTAssertTrue(chosen.contains("Alternative chosen: alternativa-local"), chosen)
        XCTAssertTrue(chosen.contains("Pending uploads: none"), chosen)
        XCTAssertFalse(chosen.contains("alternativa-remota"))

        let migrated = EmbeddedKernel.press(directory: directory, action: "migration", lang: "es")
        XCTAssertTrue(migrated.contains("Persona Beta: presente"), migrated)
        let source = directory.appendingPathComponent("migracion/origen/workspace-v1.json")
        let sourceBytes = try Data(contentsOf: source)
        let reverted = EmbeddedKernel.press(directory: directory, action: "migration-revert", lang: "es")
        XCTAssertTrue(reverted.contains("Copia nueva anterior restaurada"), reverted)
        XCTAssertTrue(reverted.contains("Persona Alfa: presente; 1/1"), reverted)
        XCTAssertTrue(reverted.contains("Persona Gamma: sin registro"), reverted)
        XCTAssertFalse(reverted.contains("Persona Gamma: ausente"))
        XCTAssertFalse(reverted.contains("Persona Beta: presente"))
        XCTAssertEqual(try Data(contentsOf: source), sourceBytes)
    }
}
