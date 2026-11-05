// Atlas native shell.
// Starts the bundled Python backend on 127.0.0.1 with a per-launch token, then hosts the UI in a
// WKWebView over a translucent macOS sidebar material. Provides folder pickers, notifications,
// Finder reveal and window dragging to the web UI through a narrow message bridge.
import Cocoa
import WebKit
import UserNotifications
import Security

final class DragWebView: WKWebView {
    var lastMouseDown: NSEvent?
    override func mouseDown(with event: NSEvent) {
        lastMouseDown = event
        super.mouseDown(with: event)
    }
    override var mouseDownCanMoveWindow: Bool { false }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: DragWebView!
    var backend: Process?
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

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        startBackend()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

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
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 960, height: 620)
        window.setFrameAutosaveName("ATLASMainWindow")
        if !window.setFrameUsingName("ATLASMainWindow") { window.center() }
        window.isMovableByWindowBackground = false

        let effect = NSVisualEffectView(frame: frame)
        effect.material = .sidebar
        effect.blendingMode = .behindWindow
        effect.state = .followsWindowActiveState
        effect.autoresizingMask = [.width, .height]
        window.contentView = effect

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
        webView = DragWebView(frame: frame, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        effect.addSubview(webView)
        webView.loadHTMLString(statusPage("Starting Atlas…", detail: "Launching the local backend."), baseURL: nil)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func statusPage(_ title: String, detail: String, error: Bool = false) -> String {
        let esc = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
        return """
        <html><head><meta name="color-scheme" content="light dark"><style>
        body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font:13px -apple-system;color:\(error ? "#c4554d" : "#717782");background:transparent}
        .b{text-align:center;max-width:560px;padding:24px} h1{font-size:15px;font-weight:600;color:CanvasText;margin:0 0 6px}
        pre{white-space:pre-wrap;text-align:left;font:11px ui-monospace;opacity:.8;max-height:300px;overflow:auto}
        </style></head><body><div class="b"><h1>\(esc(title))</h1><pre>\(esc(detail))</pre></div></body></html>
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
        logHandle?.seekToEndOfFile()

        let p = Process()
        p.executableURL = python
        p.arguments = ["-m", "atlas.main", "--static", res.appendingPathComponent("ui").path]
        var env = ProcessInfo.processInfo.environment
        env["ATLAS_TOKEN"] = token
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
        switch type {
        case "drag":
            if let e = webView.lastMouseDown { window.performDrag(with: e) }
        case "zoom":
            window.zoom(nil)
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

    func reply(_ id: String?, _ value: Any?) {
        guard let id = id else { return }
        var json = "null"
        if let v = value, JSONSerialization.isValidJSONObject([v]), let d = try? JSONSerialization.data(withJSONObject: [v]),
           let s = String(data: d, encoding: .utf8) { json = String(s.dropFirst().dropLast()) }
        webView.evaluateJavaScript("window.__atlasNative && window.__atlasNative(\(String(reflecting: id)), \(json))")
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
