#if canImport(AppKit)
import AppKit
private typealias PaperColor = NSColor
private typealias PaperFont = NSFont
#else
import UIKit
private typealias PaperColor = UIColor
private typealias PaperFont = UIFont
#endif
import CoreGraphics
import Foundation

public enum AttendancePDFMode: Sendable {
    case blank, completed
}

public enum AttendancePDFError: Error, Sendable {
    case unsupportedTemplate
    case cannotCreateDocument
    case invalidColumnLayout
    case invalidBackgroundPDF
}

/// The paper editor and the exported PDF use these same row heights and page breaks.
public struct AttendancePageLayout: Sendable {
    public let pageRanges: [Range<Int>]
    public let rowHeights: [CGFloat]
}

/// Renders the same attendance list as a blank signature sheet or a completed
/// record. Rendering never edits the underlying attendance entries.
public enum AttendancePDF {
    private static let defaultPage = CGRect(x: 0, y: 0, width: 612, height: 792)
    private static let margin: CGFloat = 46
    private static let bottom: CGFloat = 67
    // PDF pages are white regardless of the Mac's light or dark appearance.
    private static let ink = paperGray(0.10)
    private static let mutedInk = paperGray(0.38)
    private static let rule = paperGray(0.78)

    /// Shared by native PDF import and rendering; existing templates remain readable.
    public static func supportsListPage(
        _ pageSize: CGSize, minimumRowHeight: Double = 34, tableTopOffset: Double = 122
    ) -> Bool {
        pageSize.width.isFinite && pageSize.height.isFinite &&
            pageSize.width >= 260 && pageSize.height >= 350 &&
            minimumRowHeight.isFinite && minimumRowHeight > 0 &&
            tableTopOffset.isFinite && tableTopOffset >= 0 &&
            pageSize.height - CGFloat(tableTopOffset) - 30 - bottom >= CGFloat(minimumRowHeight)
    }

    /// Entries must already be in their intended display order.
    public static func pageLayout(
        entries: [AttendanceEntry], columns: [TemplateColumn],
        minimumRowHeight: Double, tableTopOffset: Double,
        pageSize: CGSize, mode: AttendancePDFMode
    ) throws -> AttendancePageLayout {
        guard columns.first == .participant, !columns.isEmpty,
              Set(columns).count == columns.count else {
            throw AttendancePDFError.invalidColumnLayout
        }
        let tableTop = pageSize.height - CGFloat(tableTopOffset)
        let availableHeight = tableTop - 30 - bottom
        guard supportsListPage(pageSize, minimumRowHeight: minimumRowHeight,
                               tableTopOffset: tableTopOffset) else {
            throw AttendancePDFError.invalidColumnLayout
        }
        let widths = columnWidths(columns, pageWidth: pageSize.width)
        let heights = entries.map {
            rowHeight(entry: $0, columns: columns, widths: widths,
                      minimum: CGFloat(minimumRowHeight), mode: mode)
        }
        guard (entries.isEmpty ? max(CGFloat(minimumRowHeight), 34) <= availableHeight
               : heights.allSatisfy { $0 <= availableHeight }) else {
            throw AttendancePDFError.invalidColumnLayout
        }
        guard !heights.isEmpty else {
            return AttendancePageLayout(pageRanges: [0..<0], rowHeights: [])
        }
        var ranges: [Range<Int>] = []
        var start = 0
        var used: CGFloat = 0
        for (index, height) in heights.enumerated() {
            if used + height > availableHeight {
                ranges.append(start..<index)
                start = index
                used = 0
            }
            used += height
        }
        ranges.append(start..<heights.count)
        return AttendancePageLayout(pageRanges: ranges, rowHeights: heights)
    }

    public static func render(
        organization: Organization, event: ActivityEvent,
        entries: [AttendanceEntry], template: DocumentTemplate,
        mode: AttendancePDFMode, language: String = "es", to destination: URL
    ) throws {
        guard template.format == .visual else { throw AttendancePDFError.unsupportedTemplate }
        guard template.columns.first == .participant,
              !template.columns.isEmpty,
              Set(template.columns).count == template.columns.count
        else { throw AttendancePDFError.invalidColumnLayout }
        let source: CGPDFDocument?
        if let data = template.backgroundPDFData {
            guard let provider = CGDataProvider(data: data as CFData),
                  let document = CGPDFDocument(provider), document.numberOfPages > 0
            else { throw AttendancePDFError.invalidBackgroundPDF }
            source = document
        } else {
            source = nil
        }
        let sourcePageIndex = template.listPageIndex ?? 0
        guard sourcePageIndex >= 0,
              source.map({ sourcePageIndex < $0.numberOfPages }) ?? true
        else { throw AttendancePDFError.invalidBackgroundPDF }
        let sourcePage = source?.page(at: sourcePageIndex + 1)
        let sourceBounds = sourcePage?.getBoxRect(.mediaBox) ?? defaultPage
        let page = CGRect(origin: .zero, size: sourceBounds.size)
        let tableTop = page.height - CGFloat(template.tableTopOffset ?? 122)
        let sorted = entries.filter { !$0.isVoided }.sorted {
            ($0.memberNameSnapshot ?? "").localizedCaseInsensitiveCompare($1.memberNameSnapshot ?? "") == .orderedAscending
        }
        let widths = columnWidths(template.columns, pageWidth: page.width)
        let layout = try pageLayout(entries: sorted, columns: template.columns,
                                    minimumRowHeight: template.rowHeight,
                                    tableTopOffset: template.tableTopOffset ?? 122,
                                    pageSize: page.size, mode: mode)
        guard let consumer = CGDataConsumer(url: destination as CFURL),
              let context = CGContext(consumer: consumer, mediaBox: nil, nil)
        else { throw AttendancePDFError.cannotCreateDocument }

        if let source, sourcePageIndex > 0 {
            for sourceIndex in 1...sourcePageIndex {
                guard let original = source.page(at: sourceIndex) else { continue }
                let bounds = CGRect(origin: .zero, size: original.getBoxRect(.mediaBox).size)
                beginPage(context, bounds: bounds, background: original)
                context.endPDFPage()
            }
        }

        for (pageIndex, range) in layout.pageRanges.enumerated() {
            let pageNumber = pageIndex + 1
            beginPage(context, bounds: page, background: pageNumber == 1 ? sourcePage : nil)
            #if canImport(AppKit)
            let graphics = NSGraphicsContext(cgContext: context, flipped: false)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = graphics
            defer { NSGraphicsContext.restoreGraphicsState() }
            #else
            UIGraphicsPushContext(context)
            defer { UIGraphicsPopContext() }
            #endif

            drawHeader(template, page: page)
            var y = drawTableHeader(context, columns: template.columns, widths: widths,
                                    accent: color(template.accentHex), labels: template.columnLabels,
                                    top: tableTop, pageWidth: page.width, language: language)
            if sorted.isEmpty {
                y -= max(CGFloat(template.rowHeight), 34)
                drawRow(context, entry: nil, columns: template.columns, widths: widths,
                        top: y + max(CGFloat(template.rowHeight), 34), height: max(CGFloat(template.rowHeight), 34),
                        mode: mode, pageWidth: page.width)
            }
            for index in range {
                let entry = sorted[index]
                let height = layout.rowHeights[index]
                drawRow(context, entry: entry, columns: template.columns, widths: widths,
                        top: y, height: height, mode: mode, pageWidth: page.width)
                y -= height
            }
            for block in template.imageBlocks ?? [] {
                #if canImport(AppKit)
                guard let image = NSImage(data: block.imageData),
                      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
                #else
                guard let cgImage = UIImage(data: block.imageData)?.cgImage else { continue }
                #endif
                context.draw(cgImage,
                             in: CGRect(x: block.x, y: page.height - block.y - block.height,
                                        width: block.width, height: block.height))
            }
            for block in template.textBlocks ?? [] where !block.text.isEmpty {
                draw(block.text,
                     in: CGRect(x: block.x, y: page.height - block.y - block.fontSize * 2.5,
                                width: block.width, height: block.fontSize * 2.5),
                     font: .systemFont(ofSize: block.fontSize), color: ink)
            }
            drawFooter(template: template, pageNumber: sourcePageIndex + pageNumber,
                       pageWidth: page.width, language: language)
            context.endPDFPage()
        }

        if let source, sourcePageIndex + 1 < source.numberOfPages {
            for sourceIndex in (sourcePageIndex + 2)...source.numberOfPages {
                guard let original = source.page(at: sourceIndex) else { continue }
                let bounds = CGRect(origin: .zero, size: original.getBoxRect(.mediaBox).size)
                beginPage(context, bounds: bounds, background: original)
                context.endPDFPage()
            }
        }

        context.closePDF()
    }

    private static func beginPage(_ context: CGContext, bounds: CGRect, background: CGPDFPage?) {
        var mediaBox = bounds
        let mediaBoxData = withUnsafeBytes(of: &mediaBox) { Data($0) }
        context.beginPDFPage([kCGPDFContextMediaBox as String: mediaBoxData] as CFDictionary)
        if let background {
            context.saveGState()
            context.concatenate(background.getDrawingTransform(.mediaBox, rect: bounds,
                                                               rotate: 0, preserveAspectRatio: true))
            context.drawPDFPage(background)
            context.restoreGState()
        }
    }

    private static func columnWidths(_ columns: [TemplateColumn], pageWidth: CGFloat) -> [CGFloat] {
        let weights = columns.map { column -> CGFloat in
            switch column {
            case .participant: 3.8
            case .signature: 2.2
            case .notes: 2.1
            case .present, .absent, .excused: 1.05
            }
        }
        let total = weights.reduce(0, +)
        return weights.map { ($0 / total) * (pageWidth - margin * 2) }
    }

    private static func drawHeader(_ template: DocumentTemplate, page: CGRect) {
        if let title = template.headerTitle, !title.isEmpty {
            draw(title, in: CGRect(x: margin, y: page.height - 86,
                                   width: page.width - margin * 2, height: 31),
                 font: .systemFont(ofSize: 22, weight: .semibold), color: ink)
        }
        if let subtitle = template.headerSubtitle, !subtitle.isEmpty {
            draw(subtitle, in: CGRect(x: margin, y: page.height - 108,
                                      width: page.width - margin * 2, height: 17),
                 font: .systemFont(ofSize: 10, weight: .regular), color: mutedInk)
        }
    }

    @discardableResult
    private static func drawTableHeader(
        _ context: CGContext, columns: [TemplateColumn], widths: [CGFloat], accent: PaperColor,
        labels: [String: String]?, top: CGFloat, pageWidth: CGFloat, language: String
    ) -> CGFloat {
        let height: CGFloat = 30
        let bottom = top - height
        context.setFillColor(accent.cgColor)
        context.fill(CGRect(x: margin, y: bottom, width: pageWidth - margin * 2, height: height))
        let titleColor = headerTextColor(for: accent)
        var x = margin
        for (column, width) in zip(columns, widths) {
            let defaultTitle: String
            switch column {
            case .participant: defaultTitle = language == "es" ? "Nombre" : "Name"
            case .present: defaultTitle = language == "es" ? "Presente" : "Present"
            case .absent: defaultTitle = language == "es" ? "Ausente" : "Absent"
            case .excused: defaultTitle = language == "es" ? "Excusado" : "Excused"
            case .signature: defaultTitle = language == "es" ? "Firma" : "Signature"
            case .notes: defaultTitle = language == "es" ? "Notas" : "Notes"
            }
            let customTitle = labels?[column.rawValue]?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let title = customTitle.flatMap { $0.isEmpty ? nil : $0 } ?? defaultTitle
            draw(title, in: CGRect(x: x + 5, y: bottom + 7, width: width - 10, height: 16),
                 font: .systemFont(ofSize: 9, weight: .semibold), color: titleColor,
                 alignment: column == .participant ? .left : .center)
            x += width
        }
        return bottom
    }

    private static func rowHeight(
        entry: AttendanceEntry, columns: [TemplateColumn], widths: [CGFloat],
        minimum: CGFloat, mode: AttendancePDFMode
    ) -> CGFloat {
        let nameWidth = (widths.first ?? 170) - 12
        let name = entry.memberNameSnapshot ?? ""
        let nameBounds = (name as NSString).boundingRect(
            with: CGSize(width: nameWidth, height: 10_000),
            options: [.usesLineFragmentOrigin],
            attributes: [.font: PaperFont.systemFont(ofSize: 10, weight: .medium)], context: nil
        )
        var needed = nameBounds.height + 12
        if mode == .completed, let notesIndex = columns.firstIndex(of: .notes) {
            let noteBounds = (entry.note as NSString).boundingRect(
                with: CGSize(width: widths[notesIndex] - 12, height: 10_000),
                options: [.usesLineFragmentOrigin],
                attributes: [.font: PaperFont.systemFont(ofSize: 9)], context: nil
            )
            needed = max(needed, noteBounds.height + 12)
        }
        return max(minimum, needed)
    }

    private static func drawRow(
        _ context: CGContext, entry: AttendanceEntry?, columns: [TemplateColumn],
        widths: [CGFloat], top: CGFloat, height: CGFloat, mode: AttendancePDFMode,
        pageWidth: CGFloat
    ) {
        let bottom = top - height
        context.setStrokeColor(rule.cgColor)
        context.setLineWidth(0.5)
        context.move(to: CGPoint(x: margin, y: bottom))
        context.addLine(to: CGPoint(x: pageWidth - margin, y: bottom))
        context.strokePath()
        var x = margin
        for (column, width) in zip(columns, widths) {
            let value: String
            switch column {
            case .participant: value = entry?.memberNameSnapshot ?? ""
            case .present: value = mode == .completed && entry?.status == .present ? "X" : ""
            case .absent: value = mode == .completed && entry?.status == .absent ? "X" : ""
            case .excused: value = mode == .completed && entry?.status == .excused ? "X" : ""
            case .signature: value = ""
            case .notes: value = mode == .completed ? (entry?.note ?? "") : ""
            }
            draw(value, in: CGRect(x: x + 6, y: bottom + 5, width: width - 12, height: height - 10),
                 font: .systemFont(ofSize: column == .notes ? 9 : 10,
                                   weight: column == .participant ? .medium : .regular),
                 color: ink,
                 alignment: column == .participant || column == .notes ? .left : .center)
            x += width
            if x < pageWidth - margin - 0.5 {
                context.move(to: CGPoint(x: x, y: bottom))
                context.addLine(to: CGPoint(x: x, y: top))
                context.strokePath()
            }
        }
    }

    private static func drawFooter(template: DocumentTemplate, pageNumber: Int,
                                   pageWidth: CGFloat, language: String) {
        if let footer = template.footerText, !footer.isEmpty {
            draw(footer, in: CGRect(x: margin, y: 38,
                                    width: max(100, pageWidth - margin * 2 - 90), height: 16),
                 font: .systemFont(ofSize: 9), color: mutedInk)
        }
        if template.showsPageNumber == true {
            draw("\(language == "es" ? "Página" : "Page") \(pageNumber)", in: CGRect(x: margin, y: 38,
                                                     width: pageWidth - margin * 2, height: 16),
                 font: .systemFont(ofSize: 9), color: mutedInk, alignment: .right)
        }
    }

    private static func draw(
        _ text: String, in rect: CGRect, font: PaperFont,
        color: PaperColor, alignment: NSTextAlignment = .left
    ) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byWordWrapping
        #if canImport(UIKit)
        guard let context = UIGraphicsGetCurrentContext() else { return }
        context.saveGState()
        defer { context.restoreGState() }
        context.translateBy(x: rect.minX, y: rect.maxY)
        context.scaleBy(x: 1, y: -1)
        let textRect = CGRect(origin: .zero, size: rect.size)
        #else
        let textRect = rect
        #endif
        (text as NSString).draw(in: textRect, withAttributes: [
            .font: font, .foregroundColor: color, .paragraphStyle: paragraph
        ])
    }

    private static func color(_ hex: String) -> PaperColor {
        let text = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        guard text.count == 6, let value = Int(text, radix: 16) else {
            return paperRGB(0.19, green: 0.37, blue: 0.68, alpha: 1)
        }
        return paperRGB(CGFloat((value >> 16) & 0xFF) / 255,
                       green: CGFloat((value >> 8) & 0xFF) / 255,
                       blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }

    private static func headerTextColor(for accent: PaperColor) -> PaperColor {
        #if canImport(AppKit)
        guard let rgb = accent.usingColorSpace(.sRGB) else { return .white }
        let red = rgb.redComponent, green = rgb.greenComponent, blue = rgb.blueComponent
        #else
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        guard accent.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return .white }
        #endif
        func linear(_ component: CGFloat) -> CGFloat {
            component <= 0.04045 ? component / 12.92 : pow((component + 0.055) / 1.055, 2.4)
        }
        let luminance = 0.2126 * linear(red)
            + 0.7152 * linear(green)
            + 0.0722 * linear(blue)
        return luminance > 0.179 ? ink : .white
    }
}

private func paperGray(_ value: CGFloat) -> PaperColor {
    #if canImport(AppKit)
    PaperColor(calibratedWhite: value, alpha: 1)
    #else
    PaperColor(white: value, alpha: 1)
    #endif
}
private func paperRGB(_ red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) -> PaperColor {
    #if canImport(AppKit)
    PaperColor(calibratedRed: red, green: green, blue: blue, alpha: alpha)
    #else
    PaperColor(red: red, green: green, blue: blue, alpha: alpha)
    #endif
}
