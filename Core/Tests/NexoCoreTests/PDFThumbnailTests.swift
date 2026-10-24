import AppKit
import CoreGraphics
import Foundation
import XCTest
@testable import NexoCore

final class PDFThumbnailTests: XCTestCase {
    func testImportedPDFPageBecomesAWhiteBackedThumbnail() throws {
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("vrr-thumbnail-\(UUID().uuidString).pdf")
        defer { try? FileManager.default.removeItem(at: file) }
        let consumer = try XCTUnwrap(CGDataConsumer(url: file as CFURL))
        let context = try XCTUnwrap(CGContext(consumer: consumer, mediaBox: nil, nil))
        let page = CGRect(x: 0, y: 0, width: 100, height: 100)
        var mediaBox = page
        let mediaBoxData = withUnsafeBytes(of: &mediaBox) { Data($0) }
        context.beginPDFPage([kCGPDFContextMediaBox as String: mediaBoxData] as CFDictionary)
        context.setFillColor(CGColor(red: 0.1, green: 0.3, blue: 0.8, alpha: 1))
        context.fill(page)
        context.endPDFPage()
        context.closePDF()

        let data = try Data(contentsOf: file)
        let png = try XCTUnwrap(PDFThumbnail.png(data: data, pageIndex: 0,
                                                  pixelWidth: 80, pixelHeight: 100))
        let bitmap = try XCTUnwrap(NSBitmapImageRep(data: png))
        XCTAssertEqual(bitmap.pixelsWide, 80)
        XCTAssertEqual(bitmap.pixelsHigh, 100)
        let center = try XCTUnwrap(bitmap.colorAt(x: 40, y: 50)?.usingColorSpace(.deviceRGB))
        let corner = try XCTUnwrap(bitmap.colorAt(x: 1, y: 1)?.usingColorSpace(.deviceRGB))
        XCTAssertGreaterThan(center.blueComponent, 0.7)
        XCTAssertGreaterThan(corner.redComponent, 0.9)
        XCTAssertNil(PDFThumbnail.png(data: data, pageIndex: 1,
                                      pixelWidth: 80, pixelHeight: 100))
    }
}
