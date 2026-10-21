import AppKit
let destination = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
for size in [512] {
    for scale in [2] {
        let pixels = size * scale
        let context = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: pixels * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        context.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
        let tile = NSBezierPath(rect: NSRect(x: 0, y: 0, width: 1024, height: 1024))
        let gradient = NSGradient(starting: NSColor(calibratedWhite: 0.99, alpha: 1), ending: NSColor(calibratedWhite: 0.85, alpha: 1))!
        gradient.draw(in: tile, angle: -90)
        NSColor(calibratedWhite: 0.78, alpha: 0.6).setStroke(); tile.lineWidth = 2; tile.stroke()
        NSColor(calibratedWhite: 0.16, alpha: 1).setStroke()
        let mark = NSBezierPath(); mark.lineWidth = 91; mark.lineCapStyle = .round; mark.lineJoinStyle = .round
        mark.move(to: NSPoint(x: 300, y: 300)); mark.line(to: NSPoint(x: 300, y: 650))
        mark.curve(to: NSPoint(x: 439, y: 687), controlPoint1: NSPoint(x: 300, y: 742), controlPoint2: NSPoint(x: 394, y: 752))
        mark.line(to: NSPoint(x: 570, y: 487))
        mark.move(to: NSPoint(x: 724, y: 724)); mark.line(to: NSPoint(x: 724, y: 374))
        mark.curve(to: NSPoint(x: 585, y: 337), controlPoint1: NSPoint(x: 724, y: 282), controlPoint2: NSPoint(x: 630, y: 272))
        mark.line(to: NSPoint(x: 454, y: 537)); mark.stroke()
        NSGraphicsContext.restoreGraphicsState()
        let url = destination.appendingPathComponent("AppIcon.png")
        let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
        try bitmap.representation(using: .png, properties: [:])!.write(to: url)
    }
}
