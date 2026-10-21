#if canImport(AppKit)
import AppKit
#else
import UIKit
#endif
import CoreGraphics
import Foundation
import PDFKit
import XCTest
@testable import VRRCore

@MainActor
final class AttendancePDFTests: XCTestCase {
    private func backgroundPDF(pageSizes: [CGSize]) throws -> Data {
        let data = NSMutableData()
        let consumer = try XCTUnwrap(CGDataConsumer(data: data))
        let context = try XCTUnwrap(CGContext(consumer: consumer, mediaBox: nil, nil))
        for size in pageSizes {
            var box = CGRect(origin: .zero, size: size)
            let mediaBox = withUnsafeBytes(of: &box) { Data($0) }
            context.beginPDFPage([kCGPDFContextMediaBox as String: mediaBox] as CFDictionary)
            context.endPDFPage()
        }
        context.closePDF()
        return data as Data
    }

    func testImportSkipsSmallPagesAndChosenPageRenders() throws {
        let data = try backgroundPDF(pageSizes: [CGSize(width: 250, height: 300),
                                                 CGSize(width: 612, height: 792)])
        let document = try XCTUnwrap(PDFDocument(data: data))
        let index = try XCTUnwrap((0..<document.pageCount).first {
            AttendancePDF.supportsListPage(document.page(at: $0)!.bounds(for: .mediaBox).size)
        })
        XCTAssertEqual(index, 1)
        let organization = Organization(name: "Synthetic")
        let event = ActivityEvent(organizationID: organization.id, title: "List", startsAt: .now,
                                  componentID: UUID())
        let template = DocumentTemplate(organizationID: organization.id, name: "Imported",
                                        backgroundPDFData: data, listPageIndex: index)
        let output = FileManager.default.temporaryDirectory.appendingPathComponent("nexo-page-fit-\(UUID()).pdf")
        defer { try? FileManager.default.removeItem(at: output) }
        try AttendancePDF.render(organization: organization, event: event, entries: [],
                                 template: template, mode: .blank, to: output)
        XCTAssertEqual(try XCTUnwrap(PDFDocument(url: output)).pageCount, 2)
    }

    func testLegacySmallTemplateStaysReadableAndPageFitRejectsImpossibleLayouts() throws {
        let organization = Organization(name: "Synthetic")
        var snapshot = WorkspaceSnapshot()
        snapshot.organizations = [organization]
        snapshot.templates = [DocumentTemplate(organizationID: organization.id, name: "Legacy",
                                                backgroundPDFData: try backgroundPDF(pageSizes: [CGSize(width: 250, height: 300)]))]
        try WorkspaceRules.validate(snapshot)
        XCTAssertFalse(AttendancePDF.supportsListPage(CGSize(width: 250, height: 300)))
        XCTAssertFalse(AttendancePDF.supportsListPage(CGSize(width: 320, height: 350),
                                                     minimumRowHeight: 34, tableTopOffset: 220))
        XCTAssertTrue(AttendancePDF.supportsListPage(CGSize(width: 320, height: 360),
                                                    minimumRowHeight: 34, tableTopOffset: 190))
        XCTAssertFalse(AttendancePDF.supportsListPage(CGSize(width: 612, height: 792),
                                                     minimumRowHeight: .nan))
    }

    func testLongNoteExpandsRowWithoutTruncatingFinalText() throws {
        let organization = Organization(name: "Asociación")
        let event = ActivityEvent(organizationID: organization.id, title: "Actividad",
                                  startsAt: .now, componentID: UUID())
        let note = String(repeating: "Detalle de asistencia ", count: 18) + "FIN DE LA NOTA"
        let entry = AttendanceEntry(eventID: event.id, memberID: UUID(), status: .present,
                                    note: note, memberNameSnapshot: "Ana")
        let template = DocumentTemplate(organizationID: organization.id, name: "Notas",
                                        columns: [.participant, .notes])
        let layout = try AttendancePDF.pageLayout(entries: [entry], columns: template.columns,
                                                   minimumRowHeight: template.rowHeight,
                                                   tableTopOffset: 122,
                                                   pageSize: CGSize(width: 612, height: 792),
                                                   mode: .completed)
        XCTAssertGreaterThan(layout.rowHeights[0], 95)

        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("vrr-long-note-\(UUID().uuidString).pdf")
        defer { try? FileManager.default.removeItem(at: file) }
        try AttendancePDF.render(organization: organization, event: event, entries: [entry],
                                 template: template, mode: .completed, to: file)
        let text = try XCTUnwrap(PDFDocument(url: file)?.string)
        let normalizedText = text.components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }.joined(separator: " ")
        XCTAssertTrue(normalizedText.contains("FIN DE LA NOTA"))
    }

    func testLongRowsUseSamePageBreaksAsExportedPDF() throws {
        let organization = Organization(name: "Asociación")
        let event = ActivityEvent(organizationID: organization.id, title: "Actividad",
                                  startsAt: .now, componentID: UUID())
        let entries = (0..<24).map { index in
            AttendanceEntry(eventID: event.id, memberID: UUID(), status: .present,
                            note: String(repeating: "Nota extensa ", count: 8),
                            memberNameSnapshot: String(format: "Persona %02d ", index)
                                + String(repeating: "Nombre largo ", count: 6))
        }
        let template = DocumentTemplate(organizationID: organization.id, name: "Filas largas",
                                        columns: [.participant, .present, .notes],
                                        rowHeight: 24, tableTopOffset: 140)
        let layout = try AttendancePDF.pageLayout(entries: entries, columns: template.columns,
                                                   minimumRowHeight: template.rowHeight,
                                                   tableTopOffset: 140,
                                                   pageSize: CGSize(width: 612, height: 792),
                                                   mode: .completed)
        XCTAssertGreaterThan(layout.pageRanges.count, 1)
        XCTAssertTrue(layout.rowHeights.contains { $0 > 24 })

        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("vrr-long-rows-\(UUID().uuidString).pdf")
        defer { try? FileManager.default.removeItem(at: file) }
        try AttendancePDF.render(organization: organization, event: event, entries: entries,
                                 template: template, mode: .completed, to: file)
        let document = try XCTUnwrap(PDFDocument(url: file))
        XCTAssertEqual(document.pageCount, layout.pageRanges.count)
        for (pageIndex, range) in layout.pageRanges.enumerated() {
            let pageText = try XCTUnwrap(document.page(at: pageIndex)?.string)
            for entryIndex in entries.indices {
                let prefix = String(format: "Persona %02d", entryIndex)
                XCTAssertEqual(pageText.contains(prefix), range.contains(entryIndex), prefix)
            }
        }
    }

    func testLongListContinuesBetweenOriginalPDFPages() throws {
        let organization = Organization(name: "Asociación")
        let event = ActivityEvent(organizationID: organization.id, title: "Actividad",
                                  startsAt: .now, componentID: UUID())
        let sourceFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("vrr-long-base-\(UUID().uuidString).pdf")
        let outputFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("vrr-long-output-\(UUID().uuidString).pdf")
        defer {
            try? FileManager.default.removeItem(at: sourceFile)
            try? FileManager.default.removeItem(at: outputFile)
        }
        let originals = (0..<45).map { index in
            AttendanceEntry(eventID: event.id, memberID: UUID(), status: .pending,
                            memberNameSnapshot: String(format: "Original %02d", index))
        }
        try AttendancePDF.render(organization: organization, event: event,
                                 entries: originals,
                                 template: DocumentTemplate(organizationID: organization.id, name: "Base"),
                                 mode: .blank, to: sourceFile)
        XCTAssertEqual(try XCTUnwrap(PDFDocument(url: sourceFile)).pageCount, 3)

        let inserted = (0..<40).map { index in
            AttendanceEntry(eventID: event.id, memberID: UUID(), status: .present,
                            memberNameSnapshot: String(format: "Nueva %02d", index))
        }
        let template = DocumentTemplate(organizationID: organization.id, name: "Con lista",
                                        backgroundPDFData: try Data(contentsOf: sourceFile),
                                        listPageIndex: 1, tableTopOffset: 200)
        try AttendancePDF.render(organization: organization, event: event,
                                 entries: inserted, template: template,
                                 mode: .completed, to: outputFile)
        let output = try XCTUnwrap(PDFDocument(url: outputFile))
        XCTAssertEqual(output.pageCount, 5)
        XCTAssertTrue(try XCTUnwrap(output.page(at: 0)?.string).contains("Original 00"))
        XCTAssertTrue(try XCTUnwrap(output.page(at: 4)?.string).contains("Original 44"))
        let listText = (1...3).compactMap { output.page(at: $0)?.string }.joined(separator: "\n")
        for index in 0..<40 {
            let name = String(format: "Nueva %02d", index)
            XCTAssertEqual(listText.components(separatedBy: name).count - 1, 1, name)
        }
        XCTAssertFalse(try XCTUnwrap(output.page(at: 0)?.string).contains("Nueva"))
        XCTAssertFalse(try XCTUnwrap(output.page(at: 4)?.string).contains("Nueva"))
    }

    func testTallRowOnShortPDFFailsWithoutStartingOutput() throws {
        let organization = Organization(name: "Asociación")
        let event = ActivityEvent(organizationID: organization.id, title: "Actividad",
                                  startsAt: .now, componentID: UUID())
        let sourceFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("vrr-short-base-\(UUID().uuidString).pdf")
        let outputFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("vrr-short-output-\(UUID().uuidString).pdf")
        defer {
            try? FileManager.default.removeItem(at: sourceFile)
            try? FileManager.default.removeItem(at: outputFile)
        }
        let bounds = CGRect(x: 0, y: 0, width: 320, height: 360)
        let consumer = try XCTUnwrap(CGDataConsumer(url: sourceFile as CFURL))
        let context = try XCTUnwrap(CGContext(consumer: consumer, mediaBox: nil, nil))
        var mediaBox = bounds
        let mediaBoxData = withUnsafeBytes(of: &mediaBox) { Data($0) }
        context.beginPDFPage([kCGPDFContextMediaBox as String: mediaBoxData] as CFDictionary)
        context.endPDFPage()
        context.closePDF()
        let sourcePage = try XCTUnwrap(PDFDocument(url: sourceFile)?.page(at: 0))
        XCTAssertEqual(sourcePage.bounds(for: .mediaBox).height, 360)

        let entry = AttendanceEntry(eventID: event.id, memberID: UUID(), status: .pending,
                                    memberNameSnapshot: String(repeating: "Nombre extenso ", count: 35))
        let template = DocumentTemplate(organizationID: organization.id, name: "Página corta",
                                        backgroundPDFData: try Data(contentsOf: sourceFile),
                                        tableTopOffset: 190)
        let shortEntry = AttendanceEntry(eventID: event.id, memberID: UUID(), status: .present,
                                         memberNameSnapshot: "Ana")
        try AttendancePDF.render(organization: organization, event: event,
                                 entries: [shortEntry], template: template,
                                 mode: .blank, to: outputFile)
        let outputPage = try XCTUnwrap(PDFDocument(url: outputFile)?.page(at: 0))
        XCTAssertEqual(outputPage.bounds(for: .mediaBox).width, 320)
        XCTAssertEqual(outputPage.bounds(for: .mediaBox).height, 360)
        try FileManager.default.removeItem(at: outputFile)

        XCTAssertThrowsError(try AttendancePDF.render(organization: organization, event: event,
                                                      entries: [entry], template: template,
                                                      mode: .blank, to: outputFile)) { error in
            guard case AttendancePDFError.invalidColumnLayout = error else {
                XCTFail("Error inesperado: \(error)")
                return
            }
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: outputFile.path))
    }

    func testExistingPDFPagesArePreservedWhenListIsInserted() throws {
        let organization = Organization(name: "Asociación")
        let event = ActivityEvent(organizationID: organization.id, title: "Actividad",
                                  startsAt: .now, componentID: UUID())
        let sourceFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("vrr-base-test-\(UUID().uuidString).pdf")
        let outputFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("vrr-overlay-test-\(UUID().uuidString).pdf")
        defer {
            try? FileManager.default.removeItem(at: sourceFile)
            try? FileManager.default.removeItem(at: outputFile)
        }
        let sourceEntries = (0..<30).map { index in
            AttendanceEntry(eventID: event.id, memberID: UUID(), status: .pending,
                            memberNameSnapshot: String(format: "Original %02d", index + 1))
        }
        let sourceTemplate = DocumentTemplate(organizationID: organization.id, name: "Base",
                                              headerTitle: "Membrete original")
        try AttendancePDF.render(organization: organization, event: event,
                                 entries: sourceEntries, template: sourceTemplate,
                                 mode: .blank, to: sourceFile)
        let source = try XCTUnwrap(PDFDocument(url: sourceFile))
        XCTAssertEqual(source.pageCount, 2)

        let inserted = AttendanceEntry(eventID: event.id, memberID: UUID(), status: .present,
                                       memberNameSnapshot: "Nueva persona")
        let template = DocumentTemplate(organizationID: organization.id, name: "Lista nueva",
                                        backgroundPDFData: try Data(contentsOf: sourceFile),
                                        listPageIndex: 1, tableTopOffset: 200)
        try AttendancePDF.render(organization: organization, event: event,
                                 entries: [inserted], template: template,
                                 mode: .blank, to: outputFile)
        let output = try XCTUnwrap(PDFDocument(url: outputFile))
        XCTAssertEqual(output.pageCount, 2)
        XCTAssertTrue(try XCTUnwrap(output.page(at: 0)?.string).contains("Original 01"))
        XCTAssertTrue(try XCTUnwrap(output.page(at: 1)?.string).contains("Nueva persona"))
    }

    func testDocumentHasNoAutomaticTopHeaderButKeepsColumnTitles() throws {
        let organization = Organization(name: "Asociación automática")
        let event = ActivityEvent(organizationID: organization.id, title: "Actividad automática",
                                  startsAt: .now, componentID: UUID())
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("vrr-header-test-\(UUID().uuidString).pdf")
        defer { try? FileManager.default.removeItem(at: file) }

        let plain = DocumentTemplate(organizationID: organization.id, name: "Sin encabezado")
        try AttendancePDF.render(organization: organization, event: event, entries: [],
                                 template: plain, mode: .blank, to: file)
        let plainText = try XCTUnwrap(PDFDocument(url: file)?.string)
        XCTAssertFalse(plainText.contains(organization.name))
        XCTAssertFalse(plainText.contains(event.title))
        XCTAssertFalse(plainText.contains("Página 1"))
        XCTAssertTrue(plainText.contains("Nombre"))

        let blankLabelFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("vrr-blank-label-test-\(UUID().uuidString).pdf")
        defer { try? FileManager.default.removeItem(at: blankLabelFile) }
        let blankLabels = DocumentTemplate(organizationID: organization.id,
                                           name: "Títulos necesarios",
                                           columnLabels: ["participant": "  ", "present": "\n"])
        try AttendancePDF.render(organization: organization, event: event, entries: [],
                                 template: blankLabels, mode: .blank, to: blankLabelFile)
        let blankLabelText = try XCTUnwrap(PDFDocument(url: blankLabelFile)?.string)
        XCTAssertTrue(blankLabelText.contains("Nombre"))
        XCTAssertTrue(blankLabelText.contains("Presente"))

        let customFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("vrr-custom-header-test-\(UUID().uuidString).pdf")
        defer { try? FileManager.default.removeItem(at: customFile) }
        #if canImport(AppKit)
        let bitmap = try XCTUnwrap(NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: 2, pixelsHigh: 2,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
            isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: 0, bitsPerPixel: 0
        ))
        for x in 0..<2 {
            for y in 0..<2 {
                bitmap.setColor(NSColor(deviceRed: 0.1, green: 0.3, blue: 0.8, alpha: 1),
                                atX: x, y: y)
            }
        }
        let imageData = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
        #else
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 2, height: 2))
        let imageData = renderer.pngData { context in
            UIColor(red: 0.1, green: 0.3, blue: 0.8, alpha: 1).setFill()
            context.fill(CGRect(x: 0, y: 0, width: 2, height: 2))
        }
        #endif
        let custom = DocumentTemplate(organizationID: organization.id, name: "Con encabezado",
                                      headerTitle: "Mi título", headerSubtitle: "Mi subtítulo",
                                      footerText: "Uso interno", showsPageNumber: true,
                                      columnLabels: ["participant": "Participante"],
                                      textBlocks: [TemplateTextBlock(text: "Aviso libre", x: 46, y: 420)],
                                      imageBlocks: [TemplateImageBlock(
                                        imageData: imageData,
                                        x: 450, y: 40, width: 80, height: 80)])
        try AttendancePDF.render(organization: organization, event: event, entries: [],
                                 template: custom, mode: .blank, to: customFile)
        let customText = try XCTUnwrap(PDFDocument(url: customFile)?.string)
        XCTAssertTrue(customText.contains("Mi título"))
        XCTAssertTrue(customText.contains("Mi subtítulo"))
        XCTAssertTrue(customText.contains("Participante"))
        XCTAssertTrue(customText.contains("Aviso libre"))
        XCTAssertTrue(customText.contains("Uso interno"))
        XCTAssertTrue(customText.contains("Página 1"))
    }

    func testExcludedPersonDoesNotAppearOnCompletedOrBlankSheet() throws {
        let organization = Organization(name: "Asociación")
        let event = ActivityEvent(organizationID: organization.id, title: "Jornada",
                                  startsAt: .now, componentID: UUID())
        let template = DocumentTemplate(organizationID: organization.id, name: "Registro")
        let included = AttendanceEntry(eventID: event.id, memberID: UUID(),
                                       status: .present, memberNameSnapshot: "Ana Incluida")
        let excluded = AttendanceEntry(eventID: event.id, memberID: UUID(),
                                       status: .absent, isVoided: true,
                                       memberNameSnapshot: "Bea Excluida")
        for mode in [AttendancePDFMode.blank, .completed] {
            let file = FileManager.default.temporaryDirectory
                .appendingPathComponent("vrr-pdf-test-\(UUID().uuidString).pdf")
            defer { try? FileManager.default.removeItem(at: file) }
            try AttendancePDF.render(organization: organization, event: event,
                                     entries: [included, excluded], template: template,
                                     mode: mode, to: file)
            let document = try XCTUnwrap(PDFDocument(url: file))
            let text = try XCTUnwrap(document.string)
            XCTAssertTrue(text.contains("Ana Incluida"))
            XCTAssertFalse(text.contains("Bea Excluida"))
        }
    }
}

@MainActor
final class LocalizedDocumentTests: XCTestCase {
    func testLanguageChangesGeneratedLabelsWithoutTranslatingCustomContent() throws {
        let org = Organization(name: "Asociación")
        let event = ActivityEvent(organizationID: org.id, title: "Actividad", startsAt: .now, componentID: UUID())
        var template = DocumentTemplate(organizationID: org.id, name: "Diseño", columns: [.participant, .signature])
        template.columnLabels = ["participant": "Nombre personalizado"]
        template.headerTitle = "Título de la asociación"
        template.showsPageNumber = true
        for language in ["en", "es"] {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("nexo-localized-\(UUID()).pdf")
            defer { try? FileManager.default.removeItem(at: url) }
            try AttendancePDF.render(organization: org, event: event, entries: [], template: template, mode: .blank, language: language, to: url)
            let text = try XCTUnwrap(PDFDocument(url: url)?.string)
            XCTAssertTrue(text.contains("Nombre personalizado"))
            XCTAssertTrue(text.contains("Título de la asociación"))
            XCTAssertTrue(text.contains(language == "en" ? "Signature" : "Firma"))
            XCTAssertTrue(text.contains(language == "en" ? "Page 1" : "Página 1"))
        }
    }
}
