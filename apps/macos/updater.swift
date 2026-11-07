// Checks GitHub for a newer Atlas release, asks before updating, then swaps the app in place and relaunches.
// Downloads come only from this repository's release assets over HTTPS and must match the release's
// SHA256SUMS.txt and this app's bundle identifier before anything on disk is replaced.
import Cocoa
import CryptoKit

final class Updater: NSObject {
    static let repo = "ryuzrx/atlas-harness"
    private static let skippedKey = "updates.skippedVersion"
    private static let checkEvery: TimeInterval = 6 * 60 * 60

    let current: String
    private var busy = false
    private var timer: Timer?
    private var progress: NSPanel?

    init(current: String) { self.current = current }

    /// First check shortly after launch, then every few hours.
    func start() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.check(userInitiated: false) }
        timer = Timer.scheduledTimer(withTimeInterval: Self.checkEvery, repeats: true) { [weak self] _ in self?.check(userInitiated: false) }
    }

    // MARK: version check

    struct Release { let version: String; let notes: String; let zip: URL; let sums: URL?; let zipName: String }

    @objc func checkFromMenu() { check(userInitiated: true) }

    func check(userInitiated: Bool) {
        guard !busy else { return }
        busy = true
        var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(Self.repo)/releases/latest")!)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("Atlas-Updater", forHTTPHeaderField: "User-Agent")
        req.timeoutInterval = 20
        URLSession.shared.dataTask(with: req) { data, _, error in
            let release = data.flatMap { Self.parse($0) }
            DispatchQueue.main.async {
                self.busy = false
                guard let release else {
                    if userInitiated { self.inform("Couldn't check for updates", error?.localizedDescription ?? "GitHub didn't return a release for this Mac.") }
                    return
                }
                guard Self.isNewer(release.version, than: self.current) else {
                    if userInitiated { self.inform("Atlas is up to date", "You have the newest version, Atlas \(self.current).") }
                    return
                }
                if !userInitiated && UserDefaults.standard.string(forKey: Self.skippedKey) == release.version { return }
                self.ask(release)
            }
        }.resume()
    }

    static func parse(_ data: Data) -> Release? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tag = obj["tag_name"] as? String,
              (obj["draft"] as? Bool) != true, (obj["prerelease"] as? Bool) != true,
              let assets = obj["assets"] as? [[String: Any]] else { return nil }
        #if arch(arm64)
        let arch = "arm64"
        #else
        let arch = "x86_64"
        #endif
        func asset(_ match: (String) -> Bool) -> (String, URL)? {
            for a in assets {
                guard let name = a["name"] as? String, match(name),
                      let s = a["browser_download_url"] as? String, let url = URL(string: s),
                      url.scheme == "https", url.host == "github.com" || url.host?.hasSuffix(".githubusercontent.com") == true else { continue }
                return (name, url)
            }
            return nil
        }
        guard let zip = asset({ $0.hasSuffix("-macOS-\(arch).zip") }) else { return nil }
        let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
        return Release(version: version, notes: obj["body"] as? String ?? "", zip: zip.1,
                       sums: asset({ $0 == "SHA256SUMS.txt" })?.1, zipName: zip.0)
    }

    /// "0.5.10" > "0.5.9"; missing parts count as 0.
    static func isNewer(_ a: String, than b: String) -> Bool {
        let pa = a.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        let pb = b.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        for i in 0..<max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0, y = i < pb.count ? pb[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    // MARK: prompts

    private func ask(_ r: Release) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Atlas \(r.version) is available"
        alert.informativeText = "You have Atlas \(current).\n\n\(Self.summary(r.notes))\n\nAtlas restarts to finish updating. Anything running picks back up afterwards."
        alert.addButton(withTitle: "Update Now")
        alert.addButton(withTitle: "Later")
        alert.addButton(withTitle: "Skip This Version")
        switch alert.runModal() {
        case .alertFirstButtonReturn: install(r)
        case .alertThirdButtonReturn: UserDefaults.standard.set(r.version, forKey: Self.skippedKey)
        default: break
        }
    }

    /// Release notes as plain bullet text, short enough for an alert.
    static func summary(_ notes: String) -> String {
        let lines = notes.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("#") }
            .map { $0.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "`", with: "") }
        var out = "", count = 0
        for l in lines where count < 5 {
            out += (out.isEmpty ? "" : "\n") + (l.hasPrefix("- ") ? "• " + l.dropFirst(2) : l)
            count += 1
        }
        return out.count > 700 ? String(out.prefix(700)) + "…" : out
    }

    private func inform(_ title: String, _ text: String, critical: Bool = false) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.alertStyle = critical ? .critical : .informational
        alert.messageText = title
        alert.informativeText = text
        alert.runModal()
    }

    private func showProgress(_ text: String) {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 340, height: 96), styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
        panel.titlebarAppearsTransparent = true
        panel.isReleasedWhenClosed = false
        let spinner = NSProgressIndicator(frame: NSRect(x: 24, y: 38, width: 20, height: 20))
        spinner.style = .spinning; spinner.controlSize = .small; spinner.startAnimation(nil)
        let label = NSTextField(labelWithString: text)
        label.frame = NSRect(x: 56, y: 36, width: 270, height: 22)
        panel.contentView?.addSubview(spinner); panel.contentView?.addSubview(label)
        panel.center(); panel.makeKeyAndOrderFront(nil)
        progress = panel
    }

    // MARK: install

    private func install(_ r: Release) {
        busy = true
        showProgress("Downloading Atlas \(r.version)…")
        let fail: (String) -> Void = { msg in
            DispatchQueue.main.async {
                self.busy = false; self.progress?.close(); self.progress = nil
                self.inform("Atlas couldn't update", msg, critical: true)
            }
        }
        let work = FileManager.default.temporaryDirectory.appendingPathComponent("atlas-update-\(UUID().uuidString)")
        do { try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true) } catch { fail(error.localizedDescription); return }
        download(r.zip) { zipFile, err in
            guard let zipFile else { fail(err ?? "The download failed."); return }
            let checksum: (String?) -> Void = { expected in
                guard let data = try? Data(contentsOf: zipFile) else { fail("The download couldn't be read."); return }
                let actual = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                if let expected, expected.lowercased() != actual { fail("The download didn't match its checksum, so nothing was changed."); return }
                if expected == nil { fail("This release has no checksum file, so Atlas won't install it automatically."); return }
                self.unpackAndSwap(zipFile, release: r, work: work, fail: fail)
            }
            guard let sums = r.sums else { checksum(nil); return }
            URLSession.shared.dataTask(with: sums) { data, _, _ in
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let line = text.split(separator: "\n").first { $0.hasSuffix(" " + r.zipName) || $0.hasSuffix("*" + r.zipName) }
                checksum(line.map { String($0.split(separator: " ").first ?? "") })
            }.resume()
        }
    }

    private func download(_ url: URL, done: @escaping (URL?, String?) -> Void) {
        var req = URLRequest(url: url)
        req.setValue("Atlas-Updater", forHTTPHeaderField: "User-Agent")
        req.timeoutInterval = 120
        URLSession.shared.downloadTask(with: req) { tmp, response, error in
            guard let tmp, (response as? HTTPURLResponse)?.statusCode == 200 else { done(nil, error?.localizedDescription); return }
            let keep = FileManager.default.temporaryDirectory.appendingPathComponent("atlas-\(UUID().uuidString).zip")
            do { try FileManager.default.moveItem(at: tmp, to: keep); done(keep, nil) } catch { done(nil, error.localizedDescription) }
        }.resume()
    }

    private func unpackAndSwap(_ zip: URL, release r: Release, work: URL, fail: @escaping (String) -> Void) {
        let unzip = Process()
        unzip.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        unzip.arguments = ["-x", "-k", zip.path, work.path]
        do { try unzip.run(); unzip.waitUntilExit() } catch { fail(error.localizedDescription); return }
        let newApp = work.appendingPathComponent("Atlas.app")
        guard unzip.terminationStatus == 0, let info = NSDictionary(contentsOf: newApp.appendingPathComponent("Contents/Info.plist")) else {
            fail("The downloaded app couldn't be opened."); return
        }
        guard info["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier else { fail("The download isn't Atlas, so nothing was changed."); return }
        guard info["CFBundleShortVersionString"] as? String == r.version else { fail("The download's version doesn't match the release, so nothing was changed."); return }
        let target = Bundle.main.bundleURL
        guard FileManager.default.isWritableFile(atPath: target.deletingLastPathComponent().path) else {
            fail("Atlas can't replace itself in \(target.deletingLastPathComponent().path). Move Atlas to your Applications folder and try again."); return
        }
        // A small script finishes the swap after Atlas quits, then reopens it. If the move fails, the old app is put back.
        let script = """
        #!/bin/sh
        PID=\(ProcessInfo.processInfo.processIdentifier)
        TARGET=\(Self.shellQuote(target.path))
        NEW=\(Self.shellQuote(newApp.path))
        i=0; while kill -0 "$PID" 2>/dev/null && [ $i -lt 150 ]; do sleep 0.2; i=$((i+1)); done
        rm -rf "$TARGET.previous"
        if mv "$TARGET" "$TARGET.previous" && mv "$NEW" "$TARGET"; then
          rm -rf "$TARGET.previous"
          xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
        else
          [ -d "$TARGET.previous" ] && [ ! -d "$TARGET" ] && mv "$TARGET.previous" "$TARGET"
        fi
        open "$TARGET"
        rm -rf \(Self.shellQuote(work.path)) \(Self.shellQuote(zip.path))
        """
        let scriptURL = work.appendingPathComponent("finish-update.sh")
        do {
            try script.write(to: scriptURL, atomically: true, encoding: .utf8)
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/bin/sh")
            p.arguments = ["-c", "nohup /bin/sh \(Self.shellQuote(scriptURL.path)) >/dev/null 2>&1 &"]
            try p.run(); p.waitUntilExit()
        } catch { fail(error.localizedDescription); return }
        DispatchQueue.main.async {
            self.progress?.close()
            NSApp.terminate(nil)
        }
    }

    static func shellQuote(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
}
