// Renders the original ATLAS geometric mark into an .iconset (run via build script).
import Cocoa
let out = CommandLine.arguments[1]
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
for (size, scale) in [(16,1),(16,2),(32,1),(32,2),(128,1),(128,2),(256,1),(256,2),(512,1),(512,2)] {
    let px = size * scale
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px)
    let inset = s * 0.1
    let rect = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
    let shape = NSBezierPath(roundedRect: rect, xRadius: rect.width * 0.225, yRadius: rect.width * 0.225)
    // Flat black tile with the white Atlas monogram (same geometry as AtlasMark in the UI).
    NSColor(calibratedWhite: 0.0, alpha: 1).setFill(); shape.fill()
    NSColor(calibratedWhite: 1, alpha: 0.12).setStroke(); shape.lineWidth = max(1, s * 0.004); shape.stroke()
    let w = s * 0.52, h = w * 28 / 40, ox = (s - w) / 2, oy = (s - h) / 2 + s * 0.01
    func pt(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: ox + x / 40 * w, y: oy + (28 - y) / 28 * h) }
    NSColor(calibratedWhite: 0.96, alpha: 1).setFill()
    for poly in [[(0.0, 28.0), (13.0, 0.0), (21.0, 0.0), (8.0, 28.0)], [(23.6, 5.2), (39.0, 28.0), (29.6, 28.0), (19.9, 13.2)]] {
        let p = NSBezierPath(); p.move(to: pt(CGFloat(poly[0].0), CGFloat(poly[0].1)))
        for q in poly.dropFirst() { p.line(to: pt(CGFloat(q.0), CGFloat(q.1))) }
        p.close(); p.fill()
    }
    NSGraphicsContext.restoreGraphicsState()
    let name = scale == 1 ? "icon_\(size)x\(size).png" : "icon_\(size)x\(size)@2x.png"
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out).appendingPathComponent(name))
}
