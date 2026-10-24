import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Creates a white-backed preview without opening PDFKit on the UI thread.
public enum PDFThumbnail {
    public static func png(data: Data, pageIndex: Int, pixelWidth: Int, pixelHeight: Int) -> Data? {
        guard pixelWidth > 0, pixelHeight > 0,
              pixelWidth <= 4_096, pixelHeight <= 4_096,
              let provider = CGDataProvider(data: data as CFData),
              let document = CGPDFDocument(provider),
              pageIndex >= 0, pageIndex < document.numberOfPages,
              let page = document.page(at: pageIndex + 1),
              let context = CGContext(data: nil, width: pixelWidth, height: pixelHeight,
                                      bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }

        let bounds = CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight)
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(bounds)
        context.concatenate(page.getDrawingTransform(.mediaBox, rect: bounds,
                                                     rotate: 0, preserveAspectRatio: true))
        context.drawPDFPage(page)
        guard let image = context.makeImage() else { return nil }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output, UTType.png.identifier as CFString, 1, nil
        ) else { return nil }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }
}
