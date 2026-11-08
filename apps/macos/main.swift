// Atlas native shell.
// Starts the bundled Python backend on 127.0.0.1 with a per-launch token, then hosts the UI in a
// WKWebView over a translucent macOS sidebar material. Provides folder pickers, notifications,
// Finder reveal and window dragging to the web UI through a narrow message bridge.
import Cocoa
import WebKit
import UserNotifications
import Security
import ImageIO
import UniformTypeIdentifiers
import CoreGraphics
import ApplicationServices
import ScreenCaptureKit

final class DragWebView: WKWebView {
    var lastMouseDown: NSEvent?
    override func mouseDown(with event: NSEvent) {
        lastMouseDown = event
        super.mouseDown(with: event)
    }
    override var mouseDownCanMoveWindow: Bool { false }
}

/// A small, separate browser window backed by macOS WebKit (no bundled Chromium runtime).
final class AtlasBrowserWindow: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let window: NSWindow
    private let webView: WKWebView
    private let address = NSTextField()
    private let backButton = NSButton(title: "‹", target: nil, action: nil)
    private let forwardButton = NSButton(title: "›", target: nil, action: nil)
    private let reloadButton = NSButton(title: "↻", target: nil, action: nil)

    override init() {
        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: config)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1120, height: 760),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        super.init()
        window.title = "Atlas Browser"
        window.minSize = NSSize(width: 640, height: 420)
        window.center()
        window.backgroundColor = NSColor.windowBackgroundColor

        let toolbar = NSStackView()
        toolbar.orientation = .horizontal
        toolbar.alignment = .centerY
        toolbar.spacing = 8
        toolbar.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        for (button, selector, label) in [(backButton, #selector(goBack), "Back"),
                                          (forwardButton, #selector(goForward), "Forward"),
                                          (reloadButton, #selector(reload), "Reload")] {
            button.target = self
            button.action = selector
            button.toolTip = label
            button.bezelStyle = .rounded
            button.setAccessibilityLabel(label)
            toolbar.addArrangedSubview(button)
        }
        address.placeholderString = "Search Google or enter a website"
        address.font = .systemFont(ofSize: 14)
        address.focusRingType = .default
        address.bezelStyle = .roundedBezel
        address.target = self
        address.action = #selector(submitAddress)
        address.setAccessibilityLabel("Search Google or enter a website")
        address.setContentHuggingPriority(.defaultLow, for: .horizontal)
        address.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        toolbar.addArrangedSubview(address)
        let go = NSButton(title: "Go", target: self, action: #selector(submitAddress))
        go.bezelStyle = .rounded
        go.setContentHuggingPriority(.required, for: .horizontal)
        toolbar.addArrangedSubview(go)

        webView.navigationDelegate = self
        webView.uiDelegate = self
        let root = NSView()
        root.translatesAutoresizingMaskIntoConstraints = false
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        webView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(toolbar)
        root.addSubview(webView)
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: root.topAnchor), toolbar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            address.widthAnchor.constraint(greaterThanOrEqualToConstant: 300),
            webView.topAnchor.constraint(equalTo: toolbar.bottomAnchor), webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor), webView.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])
        window.contentView = root
    }

    func open(_ raw: String?) {
        let value = String((raw ?? "").prefix(2048)).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            webView.load(URLRequest(url: URL(string: "https://www.google.com/")!))
            return
        }
        let target: URL
        if let url = URL(string: value), let scheme = url.scheme?.lowercased(),
           ["https", "http"].contains(scheme), url.host != nil {
            target = url
        } else if value.contains(".") && !value.contains(" "),
                  let url = URL(string: "https://" + value), url.host != nil {
            target = url
        } else {
            var components = URLComponents(string: "https://www.google.com/search")!
            components.queryItems = [URLQueryItem(name: "q", value: value)]
            target = components.url!
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        webView.load(URLRequest(url: target))
        updateControls()
    }

    @objc private func submitAddress() { open(address.stringValue) }
    @objc private func goBack() { webView.goBack() }
    @objc private func goForward() { webView.goForward() }
    @objc private func reload() { webView.reload() }

    private func updateControls() {
        backButton.isEnabled = webView.canGoBack
        forwardButton.isEnabled = webView.canGoForward
        if let url = webView.url { address.stringValue = url.absoluteString }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { updateControls() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { updateControls() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { updateControls() }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let scheme = navigationAction.request.url?.scheme?.lowercased(), ["https", "http"].contains(scheme) else {
            decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil, let url = navigationAction.request.url,
              ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        webView.load(URLRequest(url: url))
        return nil
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: DragWebView!
    var effectView: NSView!
    var backend: Process?
    var browserWindow: AtlasBrowserWindow?
    var port: Int = 0
    let token: String = {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }()
    var logHandle: FileHandle?
    var stdoutBuffer = ""
    var ready = false
    var terminating = false
    var lastCaptureSize: CGSize?
    var lastCaptureBounds: CGRect?
    var lastCaptureAt = Date.distantPast
    var companion: CompanionController?
    let updater = Updater(current: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0")

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        companion = CompanionController(token: token) { [weak self] in self?.showMainWindow() }
        companion?.state.openPath = { [weak self] path in
            self?.showMainWindow()
            self?.webView.evaluateJavaScript("location.hash = '#\(path)'")
        }
        companion?.state.openChat = { [weak self] id in
            self?.showMainWindow()
            self?.webView.evaluateJavaScript("location.hash = '#/chat/\(id)'")
        }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        startBackend()
        updater.start()
    }

    // The pet, island and menu bar keep working with the window closed; the Dock icon or menu reopens it.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showMainWindow() }
        return true
    }

    func showMainWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationWillTerminate(_ notification: Notification) {
        terminating = true
        if let p = backend, p.isRunning {
            p.terminate()
            let deadline = Date().addingTimeInterval(4)
            while p.isRunning && Date() < deadline { usleep(50_000) }
            if p.isRunning { kill(p.processIdentifier, SIGKILL) }
        }
    }

    // MARK: window
    func buildWindow() {
        let frame = NSRect(x: 0, y: 0, width: 1360, height: 860)
        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "Atlas"
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.backgroundColor = .windowBackgroundColor
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 960, height: 620)
        window.setFrameAutosaveName("ATLASMainWindow")
        if !window.setFrameUsingName("ATLASMainWindow") { window.center() }
        window.isMovableByWindowBackground = false

        // Solid, layer-backed root so a fast resize never exposes a grey system material while the
        // web view catches up. The page reports its real background colour (see "chrome" below).
        effectView = NSView(frame: frame)
        effectView.wantsLayer = true
        effectView.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        effectView.autoresizingMask = [.width, .height]
        window.contentView = effectView

        let config = WKWebViewConfiguration()
        let ucc = WKUserContentController()
        ucc.add(self, name: "atlas")
        // Window dragging + titlebar double-click for elements marked .drag (excluding interactive children).
        let js = """
        (function(){
          function isDrag(t){ while(t && t!==document.body){ if(t.classList&&(t.classList.contains('no-drag'))) return false;
            if(/^(BUTTON|INPUT|TEXTAREA|SELECT|A|KBD)$/.test(t.tagName)) return false;
            if(t.classList&&t.classList.contains('drag')) return true; t=t.parentElement;} return false; }
          document.addEventListener('mousedown', function(e){ if(e.button===0 && e.detail===1 && isDrag(e.target)) window.webkit.messageHandlers.atlas.postMessage({type:'drag'}); }, true);
          document.addEventListener('dblclick', function(e){ if(isDrag(e.target)) window.webkit.messageHandlers.atlas.postMessage({type:'zoom'}); }, true);
        })();
        """
        ucc.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController = ucc
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        webView = DragWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        effectView.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: effectView.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: effectView.trailingAnchor),
            webView.topAnchor.constraint(equalTo: effectView.topAnchor),
            webView.bottomAnchor.constraint(equalTo: effectView.bottomAnchor),
        ])
        webView.loadHTMLString(statusPage("Starting Atlas…", detail: "Preparing your workspace."), baseURL: nil)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func statusPage(_ title: String, detail: String, error: Bool = false) -> String {
        let esc = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
        return """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><style>
        :root{color-scheme:dark light;--base:#0c0c0c;--surface:#161616;--text:#f5f5f7;--muted:#a1a1a6;--line:#2a2a2a}
        @media(prefers-color-scheme:light){:root{--base:#fafafa;--surface:#fff;--text:#1d1d1f;--muted:#6e6e73;--line:#e5e5e5}}
        *{box-sizing:border-box}body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font:14px "Avenir Next",-apple-system,sans-serif;color:var(--text);background:var(--base)}
        .b{text-align:center;max-width:560px;padding:32px;animation:enter .45s cubic-bezier(.22,1,.36,1)}.mark{width:88px;height:88px;margin:auto;display:grid;place-items:center;border:1px solid var(--line);border-radius:24px;background:var(--surface)}svg{width:44px;height:31px;fill:currentColor}
        h1{font-size:28px;font-weight:600;letter-spacing:-1px;margin:24px 0 8px}p{font-size:14px;color:var(--muted);margin:0}pre{white-space:pre-wrap;text-align:left;font:12px ui-monospace;max-height:300px;overflow:auto;color:#df746c;margin-top:20px}
        .track{height:3px;width:120px;margin:28px auto 0;border-radius:9px;background:var(--line);overflow:hidden}.track span{display:block;height:100%;width:45%;border-radius:inherit;background:var(--muted);animation:travel 1.4s cubic-bezier(.4,0,.2,1) infinite}
        @keyframes travel{from{transform:translateX(-120%)}to{transform:translateX(340%)}}@keyframes enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        @media(prefers-reduced-motion:reduce){*{animation:none!important}.track span{width:100%;opacity:.6}}
        </style></head><body><div class="b"><div class="mark"><svg viewBox="0 0 40 28" aria-hidden="true"><path d="M0 28 L13 0 H21 L8 28 Z"/><path d="M23.6 5.2 L39 28 H29.6 L19.9 13.2 Z"/></svg></div><h1>\(error ? esc(title) : "Atlas")</h1>
        \(error ? "<p role=\"status\">Atlas couldn’t start. Quit and reopen the app. A fresh diagnostic log is saved locally.</p>" : "<p role=\"status\">" + esc(detail) + "</p><div class=\"track\" aria-hidden=\"true\"><span></span></div>")
        </div></body></html>
        """
    }

    // MARK: backend
    func resources() -> URL { Bundle.main.resourceURL! }

    func dataDir() -> URL {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ATLAS Harness")
        try? FileManager.default.createDirectory(at: d.appendingPathComponent("logs"), withIntermediateDirectories: true)
        return d
    }

    func startBackend() {
        let res = resources()
        let python = URL(fileURLWithPath: "/usr/bin/python3")
        guard FileManager.default.isExecutableFile(atPath: python.path),
              FileManager.default.fileExists(atPath: res.appendingPathComponent("pylib").path) else {
            fail("Python 3 is not available.", "Atlas needs the macOS Command Line Tools (xcode-select --install)."); return
        }
        let logURL = dataDir().appendingPathComponent("logs/backend.log")
        if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
        logHandle = try? FileHandle(forWritingTo: logURL)
        logHandle?.truncateFile(atOffset: 0)
        logHandle?.seekToEndOfFile()

        let p = Process()
        p.executableURL = python
        let backendPath = res.appendingPathComponent("backend").path
        let pythonLibPath = res.appendingPathComponent("pylib").path
        let bootstrap = "import sys, runpy; sys.path[:0] = sys.argv[1:3]; del sys.argv[1:3]; runpy.run_module('atlas.main', run_name='__main__')"
        p.arguments = ["-c", bootstrap, backendPath, pythonLibPath, "--static", res.appendingPathComponent("ui").path]
        var env = ProcessInfo.processInfo.environment
        env["ATLAS_TOKEN"] = token
        env["ATLAS_SUPERVISOR_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        env["PYTHONPATH"] = res.appendingPathComponent("backend").path + ":" + res.appendingPathComponent("pylib").path
        env["PYTHONNOUSERSITE"] = "1"
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        env["PYTHONUNBUFFERED"] = "1"
        let home = NSHomeDirectory()
        env["PATH"] = ["\(home)/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"].joined(separator: ":")
        p.environment = env
        p.currentDirectoryURL = dataDir()
        let out = Pipe(), err = Pipe()
        p.standardOutput = out
        p.standardError = err
        out.fileHandleForReading.readabilityHandler = { [weak self] h in
            let data = h.availableData
            guard !data.isEmpty, let self = self else { return }
            self.logHandle?.write(data)
            if let s = String(data: data, encoding: .utf8) { DispatchQueue.main.async { self.consume(s) } }
        }
        err.fileHandleForReading.readabilityHandler = { [weak self] h in
            let data = h.availableData
            if !data.isEmpty { self?.logHandle?.write(data) }
        }
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self = self, !self.terminating else { return }
                self.fail("The ATLAS backend stopped (exit \(proc.terminationStatus)).", "See \(logURL.path)\n\n" + self.tail(logURL))
            }
        }
        do { try p.run() } catch { fail("Could not start the backend.", "\(error)"); return }
        backend = p
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in
            guard let self = self, !self.ready else { return }
            self.fail("The backend did not start within 25 seconds.", self.tail(logURL))
        }
    }

    func consume(_ chunk: String) {
        stdoutBuffer += chunk
        while let r = stdoutBuffer.range(of: "\n") {
            let line = String(stdoutBuffer[..<r.lowerBound])
            stdoutBuffer.removeSubrange(..<r.upperBound)
            if line.hasPrefix("ATLAS_READY "), let p = Int(line.dropFirst(12).trimmingCharacters(in: .whitespaces)) {
                port = p
                ready = true
                companion?.start(port: p)
                webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(p)/#token=\(token)")!))
            }
        }
    }

    func tail(_ url: URL) -> String {
        guard let s = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return s.split(separator: "\n").suffix(25).joined(separator: "\n")
    }

    func fail(_ title: String, _ detail: String) {
        webView.loadHTMLString(statusPage(title, detail: detail, error: true), baseURL: nil)
    }

    // MARK: bridge
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let id = body["id"] as? String
        if type == "computer" {
            guard message.frameInfo.isMainFrame,
                  message.frameInfo.securityOrigin.host == "127.0.0.1",
                  message.frameInfo.securityOrigin.port == port,
                  let id, let action = body["action"] as? [String: Any] else {
                reply(id, ["error": "Computer requests must come from Atlas's local app window."])
                return
            }
            handleComputerRequest(id: id, action: action)
            return
        }
        switch type {
        case "browser":
            guard message.frameInfo.isMainFrame,
                  message.frameInfo.securityOrigin.host == "127.0.0.1",
                  message.frameInfo.securityOrigin.port == port else {
                reply(id, ["error": "Browser requests must come from Atlas's local app window."])
                return
            }
            if browserWindow == nil { browserWindow = AtlasBrowserWindow() }
            browserWindow?.open(body["url"] as? String)
            reply(id, true)
        case "drag":
            if let e = webView.lastMouseDown { window.performDrag(with: e) }
        case "zoom":
            window.zoom(nil)
        case "chrome":
            if let c = body["color"] as? [Double], c.count == 3 {
                let color = NSColor(srgbRed: c[0] / 255, green: c[1] / 255, blue: c[2] / 255, alpha: 1)
                window.backgroundColor = color
                effectView.layer?.backgroundColor = color.cgColor
                webView.underPageBackgroundColor = color
            }
        case "pageZoom":
            if let value = body["value"] as? Double, value >= 0.5, value <= 2 { webView.pageZoom = CGFloat(value) }
        case "pickFolder":
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.allowsMultipleSelection = false
            panel.prompt = body["prompt"] as? String ?? "Add Project"
            panel.message = body["message"] as? String ?? "Choose a project folder. Agents can only access folders you add."
            panel.beginSheetModal(for: window) { resp in
                self.reply(id, resp == .OK ? panel.url?.path : nil)
            }
        case "pickImage":
            let panel = NSOpenPanel()
            panel.canChooseDirectories = false
            panel.canChooseFiles = true
            panel.allowsMultipleSelection = false
            panel.allowedContentTypes = [.image]
            panel.prompt = "Choose Image"
            panel.beginSheetModal(for: window) { response in
                guard response == .OK, let url = panel.url else { self.reply(id, nil); return }
                let source = CGImageSourceCreateWithURL(url as CFURL, nil)
                var decoded = source.flatMap { CGImageSourceCreateThumbnailAtIndex($0, 0, [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: 192,
                      ] as CFDictionary) }
                if decoded == nil, let image = NSImage(contentsOf: url) {
                    var rect = CGRect(origin: .zero, size: image.size)
                    decoded = image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
                }
                guard let thumbnail = decoded else {
                    self.reply(id, ["error": "Could not read that image. Try exporting it as PNG or JPEG."])
                    return
                }
                guard let context = CGContext(data: nil, width: 192, height: 192, bitsPerComponent: 8, bytesPerRow: 0,
                                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
                    self.reply(id, ["error": "Could not process that image."])
                    return
                }
                let side = min(thumbnail.width, thumbnail.height)
                let crop = CGRect(x: (thumbnail.width - side) / 2, y: (thumbnail.height - side) / 2, width: side, height: side)
                guard let square = thumbnail.cropping(to: crop) else { self.reply(id, ["error": "Could not crop that image."]); return }
                context.interpolationQuality = .high
                context.draw(square, in: CGRect(x: 0, y: 0, width: 192, height: 192))
                guard let image = context.makeImage() else { self.reply(id, ["error": "Could not process that image."]); return }
                let data = NSMutableData()
                guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
                    self.reply(id, ["error": "Could not save the profile image."])
                    return
                }
                CGImageDestinationAddImage(destination, image, nil)
                guard CGImageDestinationFinalize(destination) else { self.reply(id, ["error": "Could not save the profile image."]); return }
                self.reply(id, "data:image/png;base64,\(data.base64EncodedString())")
            }
        case "notify":
            let c = UNMutableNotificationContent()
            c.title = body["title"] as? String ?? "Atlas"
            c.body = body["body"] as? String ?? ""
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
            reply(id, true)
        case "openURL":
            // Only web links, opened in the user's default browser. Never file:// or custom schemes.
            if let str = body["url"] as? String, let url = URL(string: str), ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                NSWorkspace.shared.open(url)
            }
            reply(id, true)
        case "reveal":
            if let path = body["path"] as? String { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)]) }
            reply(id, true)
        default:
            reply(id, nil)
        }
    }

    func handleComputerRequest(id: String, action: [String: Any]) {
        switch action["action"] as? String {
        case "capture":
            guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
                reply(id, ["error": "Allow Screen Recording for Atlas in System Settings → Privacy & Security, then restart Atlas."])
                return
            }
            let session = CGSessionCopyCurrentDictionary() as? [String: Any]
            if (session?["CGSSessionScreenIsLocked"] as? Bool) == true {
                reply(id, ["error": "Atlas Computer Use is paused while the Mac is locked."])
                return
            }
            guard #available(macOS 14.0, *) else {
                reply(id, ["error": "Screen capture requires macOS 14 or later."])
                return
            }
            Task { await captureMainDisplay(id: id) }
        case "open_preview":
            guard let value = action["url"] as? String,
                  let parts = URLComponents(string: value), parts.scheme == "http",
                  ["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"].contains(parts.host?.lowercased() ?? ""),
                  parts.user == nil, parts.password == nil, let url = parts.url,
                  NSWorkspace.shared.open(url) else {
                reply(id, ["error": "Atlas only opens local http://localhost preview URLs."])
                return
            }
            reply(id, ["message": "Opened the local preview in the default browser."])
        case "click":
            guard accessibilityAllowed(), let x = action["x"] as? Double, let y = action["y"] as? Double,
                  let point = computerPoint(x: x, y: y) else { reply(id, ["error": "Capture a fresh screenshot before clicking."]); return }
            let button = (action["button"] as? String) == "right" ? CGMouseButton.right : .left
            let down: CGEventType = button == .right ? .rightMouseDown : .leftMouseDown
            let up: CGEventType = button == .right ? .rightMouseUp : .leftMouseUp
            guard postMouse(down, point: point, button: button), postMouse(up, point: point, button: button) else {
                reply(id, ["error": "Allow Atlas under Accessibility in System Settings → Privacy & Security."]); return
            }
            reply(id, ["message": "Clicked the visible screen point."])
        case "type":
            guard accessibilityAllowed(), let text = action["text"] as? String, text.count <= 1000 else {
                reply(id, ["error": "Allow Atlas under Accessibility and keep text entries under 1000 characters."]); return
            }
            if focusedFieldIsSecure() {
                reply(id, ["error": "Atlas won't enter text into a password field."])
                return
            }
            let source = CGEventSource(stateID: .hidSystemState)
            for chunkStart in stride(from: 0, to: text.utf16.count, by: 20) {
                let start = text.utf16.index(text.utf16.startIndex, offsetBy: chunkStart)
                let end = text.utf16.index(start, offsetBy: min(20, text.utf16.count - chunkStart))
                let units = Array(text.utf16[start..<end])
                let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
                units.withUnsafeBufferPointer { buffer in
                    down?.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress)
                }
                down?.post(tap: .cghidEventTap)
                CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)?.post(tap: .cghidEventTap)
            }
            reply(id, ["message": "Typed text into the focused app."])
        case "key":
            guard accessibilityAllowed(), let key = action["key"] as? String, postKeyChord(key) else {
                reply(id, ["error": "Unsupported key chord or Accessibility permission is not enabled."]); return
            }
            reply(id, ["message": "Pressed the requested key."])
        case "scroll":
            guard accessibilityAllowed(), let x = action["x"] as? Double, let y = action["y"] as? Double,
                  let delta = action["delta_y"] as? Int, abs(delta) <= 1200,
                  let point = computerPoint(x: x, y: y),
                  let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(delta), wheel2: 0, wheel3: 0) else {
                reply(id, ["error": "Invalid scroll request or Accessibility permission is not enabled."]); return
            }
            event.location = point
            event.post(tap: .cghidEventTap)
            reply(id, ["message": "Scrolled the visible screen region."])
        default:
            reply(id, ["error": "Unsupported computer action."])
        }
    }

    @available(macOS 14.0, *)
    func captureMainDisplay(id: String) async {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else {
                DispatchQueue.main.async { self.reply(id, ["error": "No display is available to capture."]) }
                return
            }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let configuration = SCStreamConfiguration()
            configuration.width = display.width
            configuration.height = display.height
            configuration.showsCursor = true
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
            DispatchQueue.main.async {
                guard let bitmap = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.78]) else {
                    self.reply(id, ["error": "Could not encode the screen capture."])
                    return
                }
                self.lastCaptureSize = CGSize(width: image.width, height: image.height)
                self.lastCaptureBounds = CGDisplayBounds(display.displayID)
                self.lastCaptureAt = Date()
                self.reply(id, ["image": ["mime_type": "image/jpeg", "data": bitmap.base64EncodedString()],
                                "message": "Captured the main display."])
            }
        } catch {
            DispatchQueue.main.async {
                self.reply(id, ["error": "Screen capture failed. Check Atlas's Screen Recording permission and try again."])
            }
        }
    }

    func computerPoint(x: Double, y: Double) -> CGPoint? {
        guard let size = lastCaptureSize, let bounds = lastCaptureBounds, Date().timeIntervalSince(lastCaptureAt) < 30,
              x.isFinite, y.isFinite, x >= 0, y >= 0, x < size.width, y < size.height,
              CGDisplayBounds(CGMainDisplayID()) == bounds else { return nil }
        return CGPoint(x: bounds.minX + x * bounds.width / size.width,
                       y: bounds.minY + y * bounds.height / size.height)
    }

    func accessibilityAllowed() -> Bool {
        AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    }

    func focusedFieldIsSecure() -> Bool {
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute as CFString, &focused) == .success,
              let focused else { return false }
        var subrole: CFTypeRef?
        guard AXUIElementCopyAttributeValue(focused as! AXUIElement, kAXSubroleAttribute as CFString, &subrole) == .success else { return false }
        return (subrole as? String) == (kAXSecureTextFieldSubrole as String)
    }

    func postMouse(_ type: CGEventType, point: CGPoint, button: CGMouseButton) -> Bool {
        guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) else { return false }
        event.post(tap: .cghidEventTap)
        return true
    }

    func postKeyChord(_ value: String) -> Bool {
        let parts = value.uppercased().split(separator: "+").map(String.init)
        guard let name = parts.last, let code = ["ENTER": 36, "RETURN": 36, "TAB": 48, "ESC": 53, "SPACE": 49,
            "BACKSPACE": 51, "DELETE": 117, "LEFT": 123, "RIGHT": 124, "DOWN": 125, "UP": 126,
            "A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7, "C": 8, "V": 9,
            "B": 11, "Q": 12, "W": 13, "E": 14, "R": 15, "Y": 16, "T": 17, "O": 31, "U": 32,
            "I": 34, "P": 35, "L": 37, "J": 38, "K": 40, "N": 45, "M": 46][name] else { return false }
        guard parts.count <= 3, parts.dropLast().allSatisfy({ ["CMD", "COMMAND", "CTRL", "CONTROL", "ALT", "OPTION", "SHIFT"].contains($0) }) else { return false }
        var flags: CGEventFlags = []
        for modifier in parts.dropLast() {
            switch modifier {
            case "CMD", "COMMAND": flags.insert(.maskCommand)
            case "CTRL", "CONTROL": flags.insert(.maskControl)
            case "ALT", "OPTION": flags.insert(.maskAlternate)
            case "SHIFT": flags.insert(.maskShift)
            default: break
            }
        }
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(code), keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(code), keyDown: false) else { return false }
        down.flags = flags; up.flags = flags
        down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
        return true
    }

    func reply(_ id: String?, _ value: Any?) {
        guard let id = id else { return }
        var json = "null"
        if let v = value, JSONSerialization.isValidJSONObject([v]), let d = try? JSONSerialization.data(withJSONObject: [v]),
           let s = String(data: d, encoding: .utf8) { json = String(s.dropFirst().dropLast()) }
        webView.evaluateJavaScript("window.__atlasNative && window.__atlasNative(\(String(reflecting: id)), \(json))")
    }

    // The page's process can be killed (for example under memory pressure). Reload instead of
    // leaving a blank window; running work keeps going in the backend and the page picks it back up.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if ready, port > 0 {
            webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/#token=\(token)")!))
        } else {
            webView.loadHTMLString(statusPage("Starting Atlas…", detail: "Preparing your workspace."), baseURL: nil)
        }
    }

    // Keep navigation on the local backend; open anything else in the default browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "about" || (url.host == "127.0.0.1" && url.port == port) { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated, ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    // JS alert/confirm/prompt as native sheets.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.prompt = "Attach"
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK")
        a.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = prompt; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24)); field.stringValue = defaultText ?? ""
        a.accessoryView = field
        a.window.initialFirstResponder = field
        a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    // MARK: menu
    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let app = NSMenu()
        app.addItem(withTitle: "About Atlas", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        let updates = app.addItem(withTitle: "Check for Updates…", action: #selector(Updater.checkFromMenu), keyEquivalent: "")
        updates.target = updater
        app.addItem(.separator())
        app.addItem(withTitle: "Hide Atlas", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let other = app.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        other.keyEquivalentModifierMask = [.command, .option]
        app.addItem(.separator())
        app.addItem(withTitle: "Quit Atlas", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = app

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z"); redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload", action: #selector(reloadUI), keyEquivalent: "r")
        let fs = view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f"); fs.keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = view

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win
        NSApp.windowsMenu = win
        NSApp.mainMenu = main
    }

    @objc func reloadUI() { if ready { webView.reload() } }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
