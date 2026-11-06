// Dynamic Island checks: the hover state machine, and the real panel's placement and hit-testing on
// this Mac's screen (shown invisibly). Run: scripts/test_island.sh
import Cocoa
import SwiftUI

var failures = 0
func check(_ ok: Bool, _ what: String) { print(ok ? "PASS" : "FAIL", what); if !ok { failures += 1 } }

// 1) hover state machine
var h = IslandHover()
let t0 = Date()
check(h.update(pointerInside: true, expanded: false, holding: false, now: t0) == .none, "enter: no instant open")
check(h.update(pointerInside: true, expanded: false, holding: false, now: t0 + 0.1) == .none, "brief hover: stays closed")
check(h.update(pointerInside: true, expanded: false, holding: false, now: t0 + 0.25) == .open, "rest 0.25s: opens")
check(h.update(pointerInside: false, expanded: true, holding: false, now: t0 + 1) == .none, "leave: not instant close")
check(h.update(pointerInside: false, expanded: true, holding: false, now: t0 + 1.2) == .none, "0.2s away: still open")
check(h.update(pointerInside: false, expanded: true, holding: false, now: t0 + 1.45) == .close, "0.45s away: closes")
var h2 = IslandHover()
_ = h2.update(pointerInside: false, expanded: true, holding: true, now: t0)
check(h2.update(pointerInside: false, expanded: true, holding: true, now: t0 + 5) == .none, "holding (typing/approval): never closes")
var h3 = IslandHover()
_ = h3.update(pointerInside: true, expanded: false, holding: false, now: t0)
_ = h3.update(pointerInside: true, expanded: false, holding: false, now: t0 + 0.3)
h3.userClosed()
check(h3.update(pointerInside: true, expanded: false, holding: false, now: t0 + 2) == .none, "user closed while hovering: no reopen")
_ = h3.update(pointerInside: false, expanded: false, holding: false, now: t0 + 3)
_ = h3.update(pointerInside: true, expanded: false, holding: false, now: t0 + 4)
check(h3.update(pointerInside: true, expanded: false, holding: false, now: t0 + 4.3) == .open, "re-enter after leaving: opens again")
var h4 = IslandHover()
_ = h4.update(pointerInside: true, expanded: false, holding: false, now: t0)
_ = h4.update(pointerInside: false, expanded: false, holding: false, now: t0 + 0.1)
check(h4.update(pointerInside: false, expanded: false, holding: false, now: t0 + 0.4) == .none, "passing over quickly: never opens")

// 2) real panel on this Mac's screen
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let c = Companion(token: "x")
let screen = IslandGeometry.screen()!
let n = IslandGeometry.notch(on: screen)
c.notchWidth = n.width; c.notchHeight = n.height
print("screen", screen.frame, "notch", n, "real notch:", screen.safeAreaInsets.top > 0)
let panel = IslandPanel(companion: c)
panel.alphaValue = 0          // invisible, but laid out like the real thing
panel.orderFrontRegardless()
func settle() { RunLoop.main.run(until: Date() + 0.4); panel.contentView?.layoutSubtreeIfNeeded(); RunLoop.main.run(until: Date() + 0.2) }
settle()
func snapshot(_ name: String) {
    guard let v = panel.contentView, let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) else { return }
    v.cacheDisplay(in: v.bounds, to: rep)
    try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: NSTemporaryDirectory() + "atlas-island-\(name).png"))
}
for (label, setup) in [("resting", { c.expanded = false; c.mood = .idle; c.peek = false }),
                       ("working", { c.mood = .working; c.status = "Build the site"; c.ticker = "Ran npm test" }),
                       ("open", { c.mood = .idle; c.peek = true; c.expanded = true })] as [(String, () -> Void)] {
    setup(); settle()
    let r = panel.islandRectOnScreen
    print(label, "island on screen:", r)
    check(r != .zero, "\(label): island has a frame")
    check(abs(r.midX - screen.frame.midX) < 1.5, "\(label): centered under the notch")
    check(abs(r.maxY - screen.frame.maxY) < 1.5, "\(label): attached to the top edge")
    // expected widths (virtual notch 190 + flare 2x10): resting ~210, working wings 190+236+20, open 460+20
    if label == "working" { check(abs(r.width - (n.width + 236 + 20)) < 2, "working: wings out (\(r.width))") }
    if label == "open" { check(abs(r.width - 480) < 2 && r.height > 100, "open: full card (\(r.width)x\(r.height))") }
    if label == "resting" { check(r.width >= n.width && r.width <= n.width + 24, "resting: about notch-sized (\(r.width))") }
    // hit-testing: inside the island takes clicks, the empty canvas does not
    if let host = panel.contentView {
        let inside = NSPoint(x: r.midX - panel.frame.minX, y: r.midY - panel.frame.minY)
        let outside = NSPoint(x: 5, y: 5)
        check(host.hitTest(inside) != nil, "\(label): click inside the island is taken")
        check(host.hitTest(outside) == nil, "\(label): click outside the island passes through")
    }
    snapshot(label)
}
print(failures == 0 ? "ALL PASS" : "\(failures) FAILED")
exit(failures == 0 ? 0 : 1)
