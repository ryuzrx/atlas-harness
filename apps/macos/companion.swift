// Atlas companion: a notch Dynamic Island with a glowing orb, and a menu bar menu.
// All three read the same live state from the local backend (pending approvals/questions, running
// tasks and their latest tool steps), so approving in one place clears it everywhere.
//
// Pairing with other notch apps:
//  * Coucou (github.com/Louis-CFM/coucou, MIT code): Atlas runs are reported to its local hook socket
//    as the third-party agent "atlas" (docs/AGENTS.md), so they appear in Coucou's notch.
//  * Vorssaint: reads only Claude Code / Codex / OpenCode / Copilot logs. Atlas runs that use those
//    CLIs show there on their own; nothing else is sent.
//  * While either app is running, Atlas's own island leaves the notch to it and shows approvals as
//    a card under the menu bar instead.
import Cocoa
import Combine
import SwiftUI

// MARK: - State

enum Mood: Equatable { case idle, thinking, working, done, needsYou }

struct ChatModel: Identifiable, Hashable {
    let provider: String
    let providerName: String
    let name: String
    var id: String { "\(provider)::\(name)" }
    /// "anthropic/claude-opus-5.5" -> "claude-opus-5.5"; "llama3.2:3b" stays.
    var short: String { name.split(separator: "/").last.map(String.init) ?? name }
}

struct PendingItem: Identifiable, Equatable {
    let id: String
    let taskId: String
    let kind: String
    let title: String      // what needs a decision, e.g. the command
    let command: String?   // set for shell-command approvals ("Always" adds it to the allowlist)
    let context: String    // task / agent it came from
    let reason: String
    let isQuestion: Bool
    let choices: [String]
}

final class Companion: ObservableObject {
    @Published var mood: Mood = .idle
    @Published var items: [PendingItem] = []
    @Published var status: String = "All quiet"
    @Published var ticker: String = ""          // latest step, e.g. "Ran npm test"
    @Published var expanded = false
    var openedAt = Date.distantPast
    var onUserClose: (() -> Void)?
    @Published var peek = false                 // pointer resting on the notch while idle
    @Published var busyId: String?
    @Published var pokedAt = Date.distantPast
    @Published var doneAt = Date.distantPast
    // layout of the current screen, set by the controller
    @Published var notchWidth: CGFloat = 0
    @Published var notchHeight: CGFloat = 0
    @Published var cornerMode = false           // another island owns the notch: show as a card under the menu bar
    @Published var hovering = false
    // talk to Atlas from the island
    @Published var draft = ""
    @Published var chatAsked = ""
    @Published var chatReply = ""
    @Published var chatBusy = false
    var chatId: String?
    @Published var models: [ChatModel] = []
    @Published var chosenModel: ChatModel? {
        didSet { if let m = chosenModel { UserDefaults.standard.set(m.id, forKey: "island.model") } }
    }
    private var modelsAt = Date.distantPast
    var openChat: ((String) -> Void)?
    private var chatTimer: Timer?

    var onChange: (() -> Void)?
    var openApp: (() -> Void)?
    var islandOrbAnchor: (() -> CGPoint?)?
    let coucou = CoucouBridge()

    private var base: URL?
    private let token: String
    private var timer: Timer?
    private var polling = false
    private var tasks: [String: (status: String, title: String, project: String?)] = [:]
    private var lastEvent: [String: Int] = [:]
    private var projects: [String: String] = [:]
    private var projectsAt = Date.distantPast
    private var notified: Set<String> = []

    init(token: String) { self.token = token }

    func start(port: Int) {
        base = URL(string: "http://127.0.0.1:\(port)")
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { [weak self] _ in self?.poll() }
        poll()
    }

    func request(_ path: String, method: String = "GET", body: [String: Any]? = nil, done: @escaping (Any?) -> Void) {
        guard let base, let url = URL(string: path, relativeTo: base) else { done(nil); return }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.timeoutInterval = 5
        r.setValue(token, forHTTPHeaderField: "x-atlas-token")
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        URLSession.shared.dataTask(with: r) { data, _, _ in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) }
            DispatchQueue.main.async { done(json) }
        }.resume()
    }

    func poll() {
        guard !polling, base != nil else { return }
        polling = true
        let refreshProjects = Date().timeIntervalSince(projectsAt) > 30
        let finish = { [weak self] (approvals: [[String: Any]], taskRows: [[String: Any]]) in
            guard let self else { return }
            let active = taskRows.filter { Companion.activeStatuses.contains($0["status"] as? String ?? "") }
                .compactMap { $0["id"] as? String }.prefix(4)
            self.fetchSteps(Array(active)) { steps in
                self.polling = false
                self.apply(approvals, taskRows, steps)
            }
        }
        request("/api/approvals") { [weak self] approvals in
            self?.request("/api/tasks?limit=30") { taskRows in
                let a = approvals as? [[String: Any]] ?? [], t = taskRows as? [[String: Any]] ?? []
                if refreshProjects {
                    self?.request("/api/projects") { rows in
                        self?.projectsAt = Date()
                        for p in rows as? [[String: Any]] ?? [] {
                            if let id = p["id"] as? String, let path = p["path"] as? String { self?.projects[id] = path }
                        }
                        finish(a, t)
                    }
                } else { finish(a, t) }
            }
        }
    }

    static let activeStatuses: Set<String> = ["running", "reviewing", "ready", "queued", "waiting_approval", "planning"]

    /// New tool steps (oldest first) for the active tasks, tagged with their task id.
    private func fetchSteps(_ ids: [String], done: @escaping ([(String, [String: Any])]) -> Void) {
        guard !ids.isEmpty else { done([]); return }
        var out: [(String, [String: Any])] = []
        var left = ids.count
        for id in ids {
            request("/api/events?task_id=\(id)&type=tool_call,tool_result&limit=25") { [weak self] rows in
                let events = (rows as? [[String: Any]] ?? []).sorted { ($0["id"] as? Int ?? 0) < ($1["id"] as? Int ?? 0) }
                if let self {
                    let seen = self.lastEvent[id]
                    let fresh = events.filter { ($0["id"] as? Int ?? 0) > (seen ?? Int.min) }
                    if let maxId = events.last?["id"] as? Int { self.lastEvent[id] = maxId }
                    // first sight of a task: only its latest step feeds the ticker; nothing old is replayed
                    out += (seen == nil ? Array(fresh.suffix(1)) : fresh).map { (id, $0) }
                }
                left -= 1
                if left == 0 { done(out) }
            }
        }
    }

    private func apply(_ approvals: [[String: Any]], _ taskRows: [[String: Any]], _ steps: [(String, [String: Any])]) {
        let next: [PendingItem] = approvals.compactMap { a in
            guard let id = a["id"] as? String else { return nil }
            let kind = a["kind"] as? String ?? "approval"
            let p = a["payload"] as? [String: Any] ?? [:]
            let question = kind == "user_question"
            let command = kind == "command" ? p["command"] as? String : nil
            var title = (p["question"] as? String) ?? command ?? (p["title"] as? String) ?? ""
            if title.isEmpty, kind == "plan" { title = "Approve the plan for \(a["task_title"] as? String ?? "this objective")" }
            if title.isEmpty, kind == "git_commit" { title = "Commit: \(p["message"] as? String ?? "changes")" }
            if title.isEmpty, kind == "computer_action" { title = "Mac input: \((p["action"] as? [String: Any])?["action"] as? String ?? "action")" }
            if title.isEmpty, kind == "mcp" { title = "Connector tool: \(p["tool"] as? String ?? "tool")" }
            if title.isEmpty { title = kind.replacingOccurrences(of: "_", with: " ").capitalized }
            let context = [a["agent_name"] as? String, a["task_title"] as? String].compactMap { $0 }.joined(separator: " · ")
            return PendingItem(id: id, taskId: a["task_id"] as? String ?? "", kind: kind, title: title, command: command,
                               context: context, reason: p["reason"] as? String ?? "", isQuestion: question,
                               choices: p["choices"] as? [String] ?? [])
        }

        // task lifecycle -> mood, "done" hop, Coucou session events
        var planning: String?, running: String?
        for t in taskRows {
            guard let id = t["id"] as? String else { continue }
            let status = t["status"] as? String ?? "", title = t["title"] as? String ?? "Task"
            let project = (t["project_id"] as? String).flatMap { projects[$0] }
            let before = tasks[id]
            if Companion.activeStatuses.contains(status) {
                if status == "planning" { planning = planning ?? title } else { running = running ?? title }
                if before == nil || !Companion.activeStatuses.contains(before!.status) {
                    coucou.session(id, "SessionStart", cwd: project)
                    coucou.session(id, "UserPromptSubmit", cwd: project, extra: ["prompt": title])
                }
            } else if let before, Companion.activeStatuses.contains(before.status) {
                switch status {
                case "completed":
                    doneAt = Date()
                    coucou.session(id, "Stop", cwd: project, extra: ["last_assistant_message": String((t["result"] as? String ?? "Done.").prefix(400))])
                case "failed":
                    coucou.session(id, "StopFailure", cwd: project, extra: ["message": String((t["error"] as? String ?? "Failed").prefix(300))])
                default:
                    coucou.session(id, "SessionEnd", cwd: project)
                }
            }
            tasks[id] = (status, title, t["project_id"] as? String)
        }
        for item in next where !notified.contains(item.id) {
            notified.insert(item.id)
            coucou.session(item.taskId, "Notification", cwd: nil,
                           extra: ["message": item.isQuestion ? "Atlas asks: \(item.title)" : "Atlas needs approval: \(item.title)"])
        }

        // steps -> ticker + Coucou tool events
        for (taskId, e) in steps {
            let d = e["data"] as? [String: Any] ?? [:]
            let tool = d["tool"] as? String ?? ""
            if tool == "finish" || tool == "ask_user" { continue }
            let args = d["args"] as? [String: Any] ?? [:]
            let project = tasks[taskId]?.project.flatMap { projects[$0] }
            if e["type"] as? String == "tool_call" {
                ticker = Companion.describe(tool, args, running: true)
                coucou.tool(taskId, "PreToolUse", tool: tool, args: args, cwd: project)
            } else {
                let failed = (d["ok"] as? Bool) == false || (d["is_error"] as? Bool) == true
                // results carry no arguments: reuse the target from the "Running …" line
                let parts = ticker.split(separator: " ", maxSplits: 1)
                let target = parts.count == 2 ? " " + parts[1] : ""
                ticker = (failed ? "Failed: " : "") + Companion.pastTense(tool) + target
                coucou.tool(taskId, failed ? "PostToolUseFailure" : "PostToolUse", tool: tool, args: args, cwd: project)
            }
        }

        let mood: Mood
        let status: String
        if !next.isEmpty {
            mood = .needsYou
            status = next.count == 1 ? (next[0].isQuestion ? "Atlas has a question" : "Approval needed") : "\(next.count) things need you"
        } else if let t = planning {
            mood = .thinking; status = "Planning · \(t)"
        } else if let t = running {
            mood = .working; status = t
        } else if Date().timeIntervalSince(doneAt) < 4 {
            mood = .done; status = "Done"
        } else {
            mood = .idle; status = "All quiet"; if ticker != "" { ticker = "" }
        }
        let changed = next != items || mood != self.mood || status != self.status
        if next.isEmpty && !items.isEmpty && expanded && !chatBusy && chatAsked.isEmpty { expanded = false }   // decision made
        if next.count > items.count { openedAt = Date(); expanded = true }   // a new question/approval opens the island
        if next != items { items = next }
        if mood != self.mood { self.mood = mood }
        if status != self.status { self.status = status }
        if changed { onChange?() }
    }

    static func describe(_ tool: String, _ args: [String: Any], running: Bool) -> String {
        let target = (args["command"] as? String) ?? (args["path"] as? String).map { ($0 as NSString).lastPathComponent }
            ?? (args["query"] as? String) ?? (args["pattern"] as? String) ?? ""
        let verb: String
        switch tool {
        case "run_command": verb = running ? "Running" : "Ran"
        case "read_file": verb = running ? "Reading" : "Read"
        case "list_dir": verb = running ? "Listing" : "Listed"
        case "search": verb = running ? "Searching" : "Searched"
        case "write_file": verb = running ? "Writing" : "Wrote"
        case "edit_file", "apply_patch": verb = running ? "Editing" : "Edited"
        case "git": verb = "Git"
        default: verb = tool.replacingOccurrences(of: "_", with: " ").capitalized
        }
        return target.isEmpty ? verb : "\(verb) \(target)"
    }

    static func pastTense(_ tool: String) -> String { describe(tool, [:], running: false) }

    func decide(_ item: PendingItem, approved: Bool) {
        busyId = item.id
        request("/api/approvals/\(item.id)", method: "POST", body: ["approved": approved]) { [weak self] _ in
            self?.busyId = nil; self?.poll()
        }
    }

    /// Approve now and never ask again for this exact command (remembered by Atlas, not the allowlist).
    func alwaysAllow(_ item: PendingItem) {
        busyId = item.id
        request("/api/approvals/\(item.id)", method: "POST", body: ["approved": true, "always": item.command != nil]) { [weak self] _ in
            self?.busyId = nil; self?.poll()
        }
    }

    /// Models you can chat with (refreshed at most once a minute). The choice is remembered; with no
    /// choice yet, the model of your most recent conversation is used.
    func loadModels(force: Bool = false) {
        guard force || Date().timeIntervalSince(modelsAt) > 60 else { return }
        modelsAt = Date()
        request("/api/models") { [weak self] rows in
            guard let self else { return }
            let list = (rows as? [[String: Any]] ?? []).compactMap { r -> ChatModel? in
                guard let name = r["name"] as? String, let pid = r["provider_id"] as? String,
                      (r["state"] as? String) != "error" else { return nil }
                return ChatModel(provider: pid, providerName: r["provider_name"] as? String ?? "Models", name: name)
            }
            if list != self.models { self.models = list }
            if self.chosenModel == nil {
                let saved = UserDefaults.standard.string(forKey: "island.model")
                if let m = list.first(where: { $0.id == saved }) { self.chosenModel = m; return }
                self.request("/api/conversations?limit=40") { rows in
                    let recent = (rows as? [[String: Any]] ?? []).compactMap { $0["config"] as? [String: Any] }
                    if let cfg = recent.first(where: { $0["provider_id"] is String && $0["model"] is String }),
                       let m = list.first(where: { $0.provider == cfg["provider_id"] as? String && $0.name == cfg["model"] as? String }) {
                        self.chosenModel = m
                    } else if self.chosenModel == nil {
                        self.chosenModel = list.first
                    }
                }
            }
        }
    }

    /// Send a message from the island with the chosen model. Continues the island's chat (switching
    /// models mid-chat is fine: each message carries its model).
    func ask(_ text: String) {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !chatBusy else { return }
        guard let model = chosenModel else { loadModels(force: true); fail("Choose a model above, then ask again."); return }
        draft = ""; chatAsked = value; chatReply = ""; chatBusy = true
        let config: [String: Any] = ["mode": "model", "provider_id": model.provider, "model": model.name]
        let send = { [weak self] (id: String) in
            self?.request("/api/conversations/\(id)/messages", method: "POST", body: ["content": value, "config": config]) { resp in
                if let detail = (resp as? [String: Any])?["detail"] { self?.fail("\(detail)"); return }
                self?.watchChat(id)
            }
        }
        if let id = chatId { send(id); return }
        request("/api/conversations", method: "POST", body: ["config": config]) { [weak self] conv in
            guard let id = (conv as? [String: Any])?["id"] as? String else { self?.fail("Atlas could not start a chat."); return }
            self?.chatId = id
            send(id)
        }
    }

    private func fail(_ message: String) { chatReply = message; chatBusy = false }

    private func watchChat(_ id: String) {
        chatTimer?.invalidate()
        chatTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] timer in
            self?.request("/api/conversations/\(id)") { conv in
                guard let self, let msgs = (conv as? [String: Any])?["messages"] as? [[String: Any]],
                      let last = msgs.last, last["role"] as? String == "assistant" else { return }
                let status = last["status"] as? String ?? ""
                let content = last["content"] as? String ?? ""
                let error = (last["data"] as? [String: Any])?["error"] as? String
                if !content.isEmpty { self.chatReply = content }
                if !["streaming", "running"].contains(status) {
                    if content.isEmpty { self.chatReply = error ?? "No reply." }
                    self.chatBusy = false
                    timer.invalidate()
                }
            }
        }
    }

    /// Click on the island: open it, or close it once it has been open long enough that the click
    /// can't be the same gesture that hover-opened it.
    func tapIsland() {
        pokedAt = Date()
        guard !cornerMode else { return }
        if !expanded { openedAt = Date(); expanded = true }
        else if Date().timeIntervalSince(openedAt) > 0.6 { expanded = false; onUserClose?() }
    }

    func newChat() { chatTimer?.invalidate(); chatId = nil; chatAsked = ""; chatReply = ""; chatBusy = false; draft = "" }

    func answer(_ item: PendingItem, _ text: String) {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        busyId = item.id
        request("/api/approvals/\(item.id)/answer", method: "POST", body: ["answer": value]) { [weak self] _ in
            self?.busyId = nil; self?.poll()
        }
    }
}

// MARK: - Coucou bridge

/// Sends Atlas runs to Coucou's hook socket: newline-terminated JSON, one object per connection,
/// tagged `coucou_agent: "atlas"` (Coucou docs/AGENTS.md). Silent no-op when Coucou isn't running.
final class CoucouBridge {
    var enabled = true
    var available = false   // set by the controller when Coucou is running
    private let queue = DispatchQueue(label: "atlas.coucou-bridge")
    private let sockets = [
        NSHomeDirectory() + "/Library/Application Support/NotchBuddy/nb.sock",
        NSHomeDirectory() + "/Library/Containers/fr.louisraille.Coucou/Data/nb.sock",
    ]

    func session(_ taskId: String, _ event: String, cwd: String?, extra: [String: Any] = [:]) {
        var p: [String: Any] = ["hook_event_name": event, "session_id": "atlas-\(taskId)", "coucou_agent": "atlas"]
        if let cwd { p["cwd"] = cwd }
        p.merge(extra) { _, new in new }
        send(p)
    }

    func tool(_ taskId: String, _ event: String, tool: String, args: [String: Any], cwd: String?) {
        // Claude Code tool names render best in Coucou's ticker
        let names = ["run_command": "Bash", "read_file": "Read", "write_file": "Write", "edit_file": "Edit",
                     "apply_patch": "Edit", "search": "Grep", "list_dir": "LS", "git": "Bash"]
        var input: [String: Any] = [:]
        if let c = args["command"] as? String { input["command"] = tool == "git" ? "git \(c)" : c }
        if let path = args["path"] as? String { input["file_path"] = path }
        if let q = (args["query"] as? String) ?? (args["pattern"] as? String) { input["pattern"] = q }
        session(taskId, event, cwd: cwd, extra: ["tool_name": names[tool] ?? tool, "tool_input": input])
    }

    private func send(_ payload: [String: Any]) {
        guard enabled, available, var data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        data.append(0x0A)
        let paths = sockets
        queue.async {
            guard let path = paths.first(where: { FileManager.default.fileExists(atPath: $0) }) else { return }
            let fd = socket(AF_UNIX, SOCK_STREAM, 0)
            guard fd >= 0 else { return }
            defer { close(fd) }
            var tv = timeval(tv_sec: 2, tv_usec: 0)
            setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
            setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
            var addr = sockaddr_un()
            addr.sun_family = sa_family_t(AF_UNIX)
            let bytes = Array(path.utf8)
            guard bytes.count < MemoryLayout.size(ofValue: addr.sun_path) else { return }
            withUnsafeMutableBytes(of: &addr.sun_path) { raw in
                raw.copyBytes(from: bytes)
                raw[bytes.count] = 0
            }
            let ok = withUnsafePointer(to: &addr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) == 0
                }
            }
            guard ok else { return }
            _ = data.withUnsafeBytes { write(fd, $0.baseAddress, data.count) }
            var reply = [UInt8](repeating: 0, count: 256)
            _ = read(fd, &reply, reply.count)   // {"ok":true}
        }
    }
}

// MARK: - Orb

struct OrbView: View {
    @ObservedObject var c: Companion
    let size: CGFloat
    var anchor: (() -> CGPoint?)?
    private let still = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

    var body: some View {
        TimelineView(.animation(paused: still)) { timeline in
            let now = timeline.date
            let t = still ? 0 : now.timeIntervalSinceReferenceDate
            let mood = c.mood
            let p = OrbView.params(mood)
            let breathe = 1 + p.amp * sin(t * p.speed)
            // happy hop after a run finishes; quick squish when poked
            let sinceDone = now.timeIntervalSince(c.doneAt)
            let hop = (!still && sinceDone < 1.2) ? -size * 0.22 * abs(sin(sinceDone * .pi * 2.5)) * (1 - sinceDone / 1.2) : 0
            let sincePoke = now.timeIntervalSince(c.pokedAt)
            let squish = (!still && sincePoke < 0.45) ? sin(sincePoke / 0.45 * .pi) * 0.14 : 0
            ZStack {
                Circle().fill(Color.white.opacity(0.2 * p.glow))
                    .blur(radius: size * 0.2).scaleEffect(1.2 * breathe)
                Circle().fill(RadialGradient(colors: [.white, Color(white: 0.92), Color(white: 0.66)],
                                             center: UnitPoint(x: 0.38, y: 0.3), startRadius: 0, endRadius: size * 0.5))
                    .frame(width: size * 0.66, height: size * 0.66)
                    .overlay(eyes(t: t, mood: mood))
                    .scaleEffect(x: breathe * (1 + squish), y: breathe * (1 - squish))
                    .opacity(p.bright)
                if mood == .thinking || mood == .working {
                    Circle().trim(from: 0, to: mood == .working ? 0.42 : 0.24)
                        .stroke(Color.white.opacity(0.85), style: StrokeStyle(lineWidth: max(1.2, size * 0.035), lineCap: .round))
                        .frame(width: size * 0.86, height: size * 0.86)
                        .rotationEffect(.radians(t * (mood == .working ? 4.2 : 2.2)))
                }
                if mood == .needsYou {
                    let phase = t.truncatingRemainder(dividingBy: 1.4) / 1.4
                    Circle().stroke(Color.white.opacity(0.7 * (1 - phase)), lineWidth: max(1, size * 0.03))
                        .frame(width: size * 0.66, height: size * 0.66)
                        .scaleEffect(1 + phase * 0.55)
                }
            }
            .offset(y: hop)
            .frame(width: size, height: size)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(OrbView.label(c.mood)))
    }

    /// Two dark eyes that blink, follow the pointer and change with the mood.
    @ViewBuilder private func eyes(t: Double, mood: Mood) -> some View {
        let s = size * 0.66
        let look = gaze(limit: s * 0.07, mood: mood)
        let blink = !still && t.truncatingRemainder(dividingBy: 4.1) < 0.13
        let openness: CGFloat = blink ? 0.12 : mood == .idle ? 0.75 : mood == .needsYou ? 1.15 : 1
        let eyeW = s * 0.12, eyeH = s * 0.2
        HStack(spacing: s * 0.16) {
            ForEach(0..<2, id: \.self) { _ in
                if mood == .done {
                    HappyEye().stroke(Color(white: 0.1), style: StrokeStyle(lineWidth: max(1, s * 0.05), lineCap: .round))
                        .frame(width: eyeW * 1.3, height: eyeH * 0.5)
                } else {
                    Capsule().fill(Color(white: 0.08))
                        .frame(width: eyeW, height: max(1, eyeH * openness))
                }
            }
        }
        .offset(x: look.width, y: look.height - s * 0.04)
    }

    private func gaze(limit: CGFloat, mood: Mood) -> CGSize {
        if mood == .thinking { return CGSize(width: limit * 0.7, height: -limit * 0.7) }   // looks up, pondering
        guard let a = anchor?() else { return .zero }
        let m = NSEvent.mouseLocation
        let dx = m.x - a.x, dy = m.y - a.y
        let len = max(1, sqrt(dx * dx + dy * dy))
        let k = min(1, len / 240) * limit
        return CGSize(width: dx / len * k, height: -dy / len * k)
    }

    static func params(_ mood: Mood) -> (speed: Double, amp: Double, glow: Double, bright: Double) {
        switch mood {
        case .idle: return (1.1, 0.03, 0.5, 0.8)
        case .thinking: return (2.2, 0.045, 0.85, 0.94)
        case .working: return (3.4, 0.05, 1.0, 1.0)
        case .done: return (5.0, 0.07, 1.25, 1.0)
        case .needsYou: return (4.4, 0.07, 1.35, 1.0)
        }
    }

    static func label(_ mood: Mood) -> String {
        switch mood {
        case .idle: return "Atlas is idle"
        case .thinking: return "Atlas is planning"
        case .working: return "Atlas is working"
        case .done: return "Atlas finished"
        case .needsYou: return "Atlas needs you"
        }
    }
}

/// "^" eye for the happy face after a finished run.
struct HappyEye: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.maxY))
        p.addQuadCurve(to: CGPoint(x: r.maxX, y: r.maxY), control: CGPoint(x: r.midX, y: r.minY - r.height * 0.6))
        return p
    }
}

// MARK: - Dynamic Island

/// The island's outline. On a notched display the top corners flare outward so it reads as part of
/// the notch; elsewhere it is a continuous-corner pill like the iPhone's Dynamic Island.
struct IslandShape: Shape {
    var notched: Bool
    var radius: CGFloat
    var flare: CGFloat
    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(radius, flare) }
        set { radius = newValue.first; flare = newValue.second }
    }
    func path(in r: CGRect) -> Path {
        guard notched else {
            return RoundedRectangle(cornerRadius: min(radius, r.height / 2), style: .continuous).path(in: r)
        }
        let f = min(flare, r.width / 4), b = min(radius, r.height / 2, (r.width - 2 * f) / 2)
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addQuadCurve(to: CGPoint(x: r.minX + f, y: r.minY + f), control: CGPoint(x: r.minX + f, y: r.minY))
        p.addLine(to: CGPoint(x: r.minX + f, y: r.maxY - b))
        p.addQuadCurve(to: CGPoint(x: r.minX + f + b, y: r.maxY), control: CGPoint(x: r.minX + f, y: r.maxY))
        p.addLine(to: CGPoint(x: r.maxX - f - b, y: r.maxY))
        p.addQuadCurve(to: CGPoint(x: r.maxX - f, y: r.maxY - b), control: CGPoint(x: r.maxX - f, y: r.maxY))
        p.addLine(to: CGPoint(x: r.maxX - f, y: r.minY + f))
        p.addQuadCurve(to: CGPoint(x: r.maxX, y: r.minY), control: CGPoint(x: r.maxX - f, y: r.minY))
        p.closeSubpath()
        return p
    }
}

struct IslandView: View {
    @ObservedObject var c: Companion
    var canvas = true   // false: just the island, used to measure its size
    @State private var answer = ""
    // a touch of bounce, like the iPhone island
    private let morph = Animation.spring(response: 0.5, dampingFraction: 0.74)
    private let flare: CGFloat = 10

    var body: some View {
        if canvas {
            animated
                .frame(width: IslandPanel.size.width, height: IslandPanel.size.height,
                       alignment: c.cornerMode ? .topTrailing : .top)
        } else {
            island.fixedSize(horizontal: false, vertical: true)
        }
    }

    private var animated: some View {
        island
            .fixedSize(horizontal: false, vertical: true)
            .animation(morph, value: c.expanded)
            .animation(morph, value: c.items)
            .animation(morph, value: c.peek)
            .animation(morph, value: c.mood)
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: c.hovering)
            .animation(.easeOut(duration: 0.2), value: c.ticker)
            .animation(.easeOut(duration: 0.2), value: c.chatReply)
    }

    private var notched: Bool { !c.cornerMode }   // a real notch, or the virtual one drawn on other displays
    private var open: Bool { c.expanded || c.cornerMode }
    private var resting: Bool { c.mood == .idle && !c.peek && !open }

    private var island: some View {
        let f: CGFloat = notched ? flare : 0
        let wing: CGFloat = 118
        let width: CGFloat = open ? 460 : resting ? (notched ? c.notchWidth : 128) : (notched ? c.notchWidth + wing * 2 : 300)
        let radius: CGFloat = open ? 34 : notched ? 12 : 17
        return VStack(alignment: .leading, spacing: 12) {
            if resting {
                Color.clear.frame(height: notched ? max(24, c.notchHeight) : 32)
                    .contentShape(Rectangle()).onTapGesture(perform: toggle)
            } else {
                compactRow(wing: wing)
                // content arrives just after the shape has grown, and leaves before it shrinks
                if open {
                    openContent.transition(.asymmetric(
                        insertion: .opacity.combined(with: .scale(scale: 0.97, anchor: .top)).animation(.easeOut(duration: 0.26).delay(0.12)),
                        removal: .opacity.animation(.easeIn(duration: 0.1))))
                }
            }
        }
        .padding(.horizontal, resting ? 0 : 14 + f)
        .padding(.top, open && notched ? c.notchHeight + 2 : 0)
        .padding(.bottom, open ? 16 : 0)
        .frame(width: width + 2 * f, alignment: .leading)
        .background(IslandShape(notched: notched, radius: radius, flare: f).fill(Color.black))
        .overlay(notched ? nil : IslandShape(notched: false, radius: radius, flare: 0).stroke(Color.white.opacity(0.08)))
        .scaleEffect(c.hovering && !open ? 1.045 : 1, anchor: .top)
    }

    private func toggle() { c.tapIsland() }

    /// Closed island: orb in the left wing, the latest step or a badge in the right wing.
    /// Open: orb + title (tap to close), and the model picker while chatting.
    @ViewBuilder private func compactRow(wing: CGFloat) -> some View {
        let height = notched && !open ? max(28, c.notchHeight) : 34
        if notched && !open {
            HStack(spacing: 8) {
                OrbView(c: c, size: 22, anchor: c.islandOrbAnchor)
                Spacer(minLength: c.notchWidth)
                rightWing.frame(maxWidth: wing - 18, alignment: .trailing)
            }
            .frame(height: height)
            .contentShape(Rectangle()).onTapGesture(perform: toggle)
        } else {
            HStack(spacing: 8) {
                HStack(spacing: 10) {
                    OrbView(c: c, size: 24, anchor: c.islandOrbAnchor)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(open && c.items.isEmpty && c.mood == .idle ? "Ask Atlas" : c.status)
                            .font(.system(size: 14, weight: .semibold)).foregroundColor(.white).lineLimit(1)
                        if !c.ticker.isEmpty && c.items.isEmpty {
                            Text(c.ticker).font(.system(size: 11, design: .monospaced)).foregroundColor(Color(white: 0.55)).lineLimit(1)
                                .truncationMode(.middle).transition(.opacity)
                        }
                    }
                }
                .contentShape(Rectangle()).onTapGesture(perform: toggle)
                Spacer(minLength: 6)
                if c.items.count > 1 { badge("\(c.items.count)") }
                if open && c.items.isEmpty { modelPicker }
            }
            .frame(height: height)
        }
    }

    private var modelPicker: some View {
        let groups = Dictionary(grouping: c.models, by: { $0.providerName }).sorted { $0.key < $1.key }
        return Menu {
            if c.models.isEmpty { Text("No models yet: add one in Atlas") }
            ForEach(groups, id: \.key) { provider, models in
                Section(provider) {
                    ForEach(models) { m in
                        Button { c.chosenModel = m } label: {
                            if m == c.chosenModel { Label(m.short, systemImage: "checkmark") } else { Text(m.short) }
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "cpu").font(.system(size: 10, weight: .semibold))
                Text(c.chosenModel?.short ?? "Choose model").font(.system(size: 11.5, weight: .medium)).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 8.5, weight: .bold))
            }
            .foregroundColor(Color(white: 0.85))
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Capsule().fill(Color.white.opacity(0.1)))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Model for chats from the island")
    }

    @ViewBuilder private var rightWing: some View {
        if !c.items.isEmpty {
            badge(c.items.count > 1 ? "\(c.items.count)" : "!")
        } else if c.mood == .done {
            Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundColor(.white)
        } else if !c.ticker.isEmpty {
            HStack(spacing: 5) {
                Image(systemName: IslandView.icon(for: c.ticker)).font(.system(size: 10, weight: .semibold))
                Text(IslandView.short(c.ticker)).font(.system(size: 11, weight: .medium)).lineLimit(1).truncationMode(.tail)
            }
            .foregroundColor(Color(white: 0.78)).id(c.ticker).transition(.opacity.combined(with: .move(edge: .bottom)))
        } else {
            Text("Ask").font(.system(size: 11, weight: .medium)).foregroundColor(Color(white: 0.7))
        }
    }

    static func icon(for ticker: String) -> String {
        let t = ticker.lowercased()
        if t.hasPrefix("fail") { return "exclamationmark.triangle" }
        if t.hasPrefix("ran") || t.hasPrefix("running") || t.hasPrefix("git") { return "terminal" }
        if t.hasPrefix("edit") || t.hasPrefix("wrote") || t.hasPrefix("writing") { return "pencil" }
        if t.hasPrefix("search") { return "magnifyingglass" }
        if t.hasPrefix("read") || t.hasPrefix("list") { return "doc.text" }
        return "sparkle"
    }

    /// "Ran npm run build" -> "npm run…", "Edited src/App.tsx" -> "App.tsx": what fits beside the camera.
    static func short(_ ticker: String) -> String {
        let parts = ticker.split(separator: " ", maxSplits: 1)
        guard parts.count == 2 else { return ticker }
        let target = String(parts[1])
        if target.contains("/") { return (target as NSString).lastPathComponent }
        return target.count > 12 ? String(target.prefix(11)) + "…" : target
    }

    @ViewBuilder private var openContent: some View {
        if let item = c.items.first { detail(item) } else { chat }
    }

    private func badge(_ text: String) -> some View {
        Text(text).font(.system(size: 11, weight: .semibold)).foregroundColor(.black)
            .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(Color.white))
    }

    // MARK: talk to Atlas

    private var chat: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !c.chatAsked.isEmpty {
                HStack {
                    Spacer(minLength: 48)
                    Text(c.chatAsked).font(.system(size: 13)).foregroundColor(.white)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.13)))
                }
                HStack(alignment: .top, spacing: 0) {
                    if c.chatReply.isEmpty {
                        Text("Thinking…").font(.system(size: 13)).foregroundColor(Color(white: 0.5))
                    } else {
                        Text(c.chatReply)
                            .font(.system(size: 13)).foregroundColor(Color(white: 0.92)).lineSpacing(3)
                            .lineLimit(10).truncationMode(.head)   // long replies keep their newest lines
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                    Spacer(minLength: 0)
                }
            }
            inputField
            HStack(spacing: 4) {
                quietButton("Open in Atlas", icon: "arrow.up.forward.app") {
                    if let id = c.chatId { c.openChat?(id) } else { c.openApp?() }
                }
                Spacer()
                if !c.chatAsked.isEmpty { quietButton("New chat", icon: "square.and.pencil") { c.newChat() } }
            }
        }
        .onAppear { c.loadModels() }
    }

    private var inputField: some View {
        let empty = c.draft.trimmingCharacters(in: .whitespaces).isEmpty
        return HStack(spacing: 6) {
            TextField(c.chatAsked.isEmpty ? "Ask Atlas anything…" : "Reply…", text: $c.draft, onCommit: { c.ask(c.draft) })
                .textFieldStyle(.plain).font(.system(size: 13.5)).foregroundColor(.white)
            Button { c.ask(c.draft) } label: {
                Group {
                    if c.chatBusy { ProgressView().controlSize(.small).tint(.black) }
                    else { Image(systemName: "arrow.up").font(.system(size: 12, weight: .bold)) }
                }
                .foregroundColor(.black)
                .frame(width: 26, height: 26)
                .background(Circle().fill(Color.white.opacity(empty && !c.chatBusy ? 0.35 : 1)))
            }
            .buttonStyle(PressableStyle())
            .disabled(empty || c.chatBusy)
            .help("Send (Return)")
        }
        .padding(.leading, 14).padding(.trailing, 5).padding(.vertical, 5)
        .background(Capsule().fill(Color.white.opacity(0.09)))
        .overlay(Capsule().stroke(Color.white.opacity(0.08)))
    }

    private func quietButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 11, weight: .medium))
                Text(title).font(.system(size: 12, weight: .medium))
            }
            .foregroundColor(Color(white: 0.62))
            .padding(.horizontal, 8).padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: approvals & questions

    @ViewBuilder private func detail(_ item: PendingItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !item.context.isEmpty {
                Text(item.context).font(.system(size: 11)).foregroundColor(Color(white: 0.55)).lineLimit(1)
            }
            if item.isQuestion {
                Text(item.title).font(.system(size: 14)).foregroundColor(.white)
                    .lineLimit(6).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
            } else {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: item.command != nil ? "terminal" : "checkmark.shield")
                        .font(.system(size: 11, weight: .semibold)).foregroundColor(Color(white: 0.6)).padding(.top, 2)
                    Text(item.title).font(.system(size: 12.5, design: .monospaced)).foregroundColor(.white)
                        .lineLimit(6).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                    Spacer(minLength: 0)
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.07)))
            }
            if !item.reason.isEmpty {
                Text(item.reason).font(.system(size: 11)).foregroundColor(Color(white: 0.55)).lineLimit(2)
            }
            if item.isQuestion { questionControls(item) } else { approvalControls(item) }
        }
    }

    private func approvalControls(_ item: PendingItem) -> some View {
        HStack(spacing: 8) {
            quietButton("Open Atlas", icon: "arrow.up.forward.app") { c.openApp?() }
            Spacer()
            islandButton("Deny", style: .secondary) { c.decide(item, approved: false) }
            if item.command != nil {
                islandButton("Always", style: .secondary) { c.alwaysAllow(item) }
                    .help("Approve and stop asking for this exact command")
            }
            islandButton(c.busyId == item.id ? "…" : "Allow", style: .primary) { c.decide(item, approved: true) }
        }
        .padding(.top, 4)
        .disabled(c.busyId == item.id)
    }

    private func questionControls(_ item: PendingItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !item.choices.isEmpty {
                HStack(spacing: 6) {
                    ForEach(item.choices.prefix(4), id: \.self) { choice in
                        islandButton(choice, style: answer == choice ? .primary : .secondary) { answer = choice }
                    }
                }
            }
            HStack(spacing: 8) {
                TextField("Your answer", text: $answer, onCommit: { send(item) })
                    .textFieldStyle(.plain).font(.system(size: 13)).foregroundColor(.white)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Capsule().fill(Color.white.opacity(0.1)))
                islandButton("Send", style: .primary) { send(item) }
                    .disabled(answer.trimmingCharacters(in: .whitespaces).isEmpty || c.busyId == item.id)
            }
        }
        .padding(.top, 4)
    }

    private func send(_ item: PendingItem) {
        c.answer(item, answer)
        answer = ""
    }

    enum Kind { case primary, secondary, quiet }

    private func islandButton(_ title: String, style: Kind, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.system(size: 12.5, weight: .medium))
                .foregroundColor(style == .primary ? .black : .white)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(Capsule().fill(style == .primary ? Color.white : style == .secondary ? Color.white.opacity(0.14) : Color.clear))
        }
        .buttonStyle(PressableStyle())
    }
}

/// Press feedback on pointer-down, like system buttons.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.spring(response: 0.2, dampingFraction: 0.9), value: configuration.isPressed)
    }
}

/// Hosting view for the notch panel: buttons answer the very first click (no "activate first"),
/// and nothing outside the island's shape takes a click.
final class NotchHostingView<Content: View>: NSHostingView<Content> {
    var islandRect: () -> CGRect = { .zero }   // in this view's (flipped, top-left) coordinates
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        let topLeft = NSPoint(x: local.x, y: isFlipped ? local.y : bounds.height - local.y)
        return islandRect().insetBy(dx: -4, dy: -4).contains(topLeft) ? super.hitTest(point) : nil
    }
}


/// A fixed, transparent canvas at the top of the screen. The island morphs inside it (centered under
/// the notch, never clipped, no window resizing mid-animation); the controller lets clicks through
/// everywhere except the island itself.
final class IslandPanel: NSPanel {
    static let size = NSSize(width: 620, height: 440)
    private weak var companion: Companion?
    private var measurer: NSHostingView<IslandView>!
    private var cachedSize: CGSize?
    private var invalidate: AnyCancellable?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    init(companion: Companion) {
        super.init(contentRect: NSRect(origin: .zero, size: IslandPanel.size),
                   styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        self.companion = companion
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 2)   // over the menu bar, like the notch
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        isMovable = false
        hidesOnDeactivate = false
        ignoresMouseEvents = true
        becomesKeyOnlyIfNeeded = true     // buttons don't steal focus; clicking a text field does
        acceptsMouseMovedEvents = true
        let host = NotchHostingView(rootView: IslandView(c: companion))
        host.frame = NSRect(origin: .zero, size: IslandPanel.size)
        measurer = NotchHostingView(rootView: IslandView(c: companion, canvas: false))
        host.islandRect = { [weak self] in self?.islandRectInCanvas ?? .zero }
        contentView = host
        // objectWillChange fires before the change lands: re-measure on the next turn of the run loop
        invalidate = companion.objectWillChange.sink { [weak self] in
            self?.cachedSize = nil
            DispatchQueue.main.async { self?.cachedSize = nil }
        }
        // called while SwiftUI renders the orb: read the last measurement, never measure here
        companion.islandOrbAnchor = { [weak self, weak companion] in
            guard let self, let c = companion, let f = self.lastRect else { return nil }
            let r = self.screenRect(f)
            return CGPoint(x: r.minX + (c.cornerMode ? 0 : 10) + 14 + 11, y: r.maxY - 17)
        }
        place()
    }

    /// The island's size, measured from the same view it draws (current state, no animation).
    private var islandSize: CGSize {
        if let cachedSize { return cachedSize }
        guard let c = companion else { return .zero }
        measurer.rootView = IslandView(c: c, canvas: false)   // re-read state now, not on SwiftUI's next pass
        measurer.layoutSubtreeIfNeeded()
        let size = measurer.fittingSize
        cachedSize = size
        return size
    }

    private(set) var lastRect: CGRect?

    /// Top-left-origin rect of the island inside the canvas: top-centered (top-right as a card).
    /// Measures; call only outside SwiftUI rendering (pointer sampler, event handling).
    var islandRectInCanvas: CGRect {
        let s = islandSize
        guard s.width > 0, s.height > 0 else { return .zero }
        let x = companion?.cornerMode == true ? IslandPanel.size.width - s.width : (IslandPanel.size.width - s.width) / 2
        let r = CGRect(x: x, y: 0, width: s.width, height: s.height)
        lastRect = r
        return r
    }

    private func screenRect(_ f: CGRect) -> NSRect {
        NSRect(x: frame.minX + f.minX, y: frame.maxY - f.maxY, width: f.width, height: f.height)
    }

    /// The island's rectangle in screen coordinates.
    var islandRectOnScreen: NSRect {
        let f = islandRectInCanvas
        return f == .zero ? .zero : screenRect(f)
    }

    func place() {
        guard let screen = IslandGeometry.screen(), let c = companion else { return }
        let size = IslandPanel.size
        let origin: NSPoint
        if c.cornerMode {
            // another app owns the notch: drop in as a card at the top right, under the menu bar
            origin = NSPoint(x: screen.visibleFrame.maxX - size.width - 12, y: screen.visibleFrame.maxY - size.height - 8)
        } else {
            origin = NSPoint(x: (screen.frame.midX - size.width / 2).rounded(), y: screen.frame.maxY - size.height)
        }
        if frame.origin != origin { setFrameOrigin(origin) }
    }
}

// MARK: - Geometry & hover

enum IslandGeometry {
    /// The island lives on the built-in notch display; otherwise on the menu bar screen. Never follows
    /// focus between displays.
    static func screen() -> NSScreen? {
        NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.screens.first
    }

    /// Notch size: the real one, or a virtual notch the height of the menu bar (as Vorssaint draws
    /// on displays without one).
    static func notch(on screen: NSScreen) -> CGSize {
        if screen.safeAreaInsets.top > 0, let l = screen.auxiliaryTopLeftArea, let r = screen.auxiliaryTopRightArea {
            return CGSize(width: max(120, screen.frame.width - l.width - r.width), height: screen.safeAreaInsets.top)
        }
        return CGSize(width: 190, height: max(24, screen.frame.maxY - screen.visibleFrame.maxY))
    }

    /// The notch strip in screen coordinates (where the resting island hides).
    static func notchRect(on screen: NSScreen) -> NSRect {
        let n = notch(on: screen)
        return NSRect(x: screen.frame.midX - n.width / 2, y: screen.frame.maxY - n.height, width: n.width, height: n.height)
    }
}

/// Hover -> open/close decisions, from pointer samples. Pure, so it can be tested without a screen.
struct IslandHover {
    enum Action: Equatable { case none, open, close }
    var openDelay: TimeInterval = 0.22
    var closeDelay: TimeInterval = 0.4
    private(set) var inside = false
    private var enteredAt: Date?
    private var leftAt: Date?
    private var suppressed = false   // closed by the user while hovering: wait for the pointer to leave

    mutating func userClosed() { suppressed = inside; enteredAt = nil }

    mutating func update(pointerInside: Bool, expanded: Bool, holding: Bool, now: Date) -> Action {
        if pointerInside {
            if !inside { inside = true; enteredAt = now; leftAt = nil }
            if !expanded, !suppressed, let e = enteredAt, now.timeIntervalSince(e) >= openDelay { return .open }
        } else {
            if inside { inside = false; leftAt = now; enteredAt = nil; suppressed = false }
            if expanded, !holding, let l = leftAt, now.timeIntervalSince(l) >= closeDelay { return .close }
        }
        return .none
    }
}

// MARK: - Coordinator: panels, menu bar, pairing

final class CompanionController: NSObject, NSMenuDelegate {
    let state: Companion
    private var island: IslandPanel?
    private var statusItem: NSStatusItem?
    private let defaults = UserDefaults.standard
    private var watches: [AnyCancellable] = []
    private var monitors: [Any] = []
    private var sampler: Timer?
    private var hover = IslandHover()
    private(set) var otherIsland: String?   // "Coucou" / "Vorssaint" when one of them is running

    static let islandApps: [String: String] = [
        "fr.louisraille.NotchBuddy": "Coucou", "fr.louisraille.Coucou": "Coucou", "com.vorssaint.utils": "Vorssaint",
    ]

    var showIsland: Bool {
        get { defaults.object(forKey: "companion.island") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "companion.island"); refresh() }
    }
    var reportToCoucou: Bool {
        get { defaults.object(forKey: "companion.coucou") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "companion.coucou"); state.coucou.enabled = newValue }
    }

    init(token: String, openApp: @escaping () -> Void) {
        state = Companion(token: token)
        super.init()
        state.openApp = openApp
        state.onChange = { [weak self] in self?.refresh() }
        state.coucou.enabled = reportToCoucou
        // keep the menu bar badge and island visibility in step with state changes
        for publisher in [state.$expanded.removeDuplicates().dropFirst().map { _ in () }.eraseToAnyPublisher(),
                          state.$peek.removeDuplicates().dropFirst().map { _ in () }.eraseToAnyPublisher(),
                          state.$items.removeDuplicates().dropFirst().map { _ in () }.eraseToAnyPublisher()] {
            watches.append(publisher.sink { [weak self] in DispatchQueue.main.async { self?.refresh() } })
        }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        statusItem = item
        let ws = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification] {
            ws.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.detectOtherIslands() }
        }
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refresh()
        }
        // Sample the pointer 20x a second. Mouse-moved events only reach the focused window, so
        // event monitors miss the notch whenever another app is in front; sampling never does.
        let sampler = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(sampler, forMode: .common)   // keeps running while menus are open or windows drag
        self.sampler = sampler
        // Escape closes the island
        if let k = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { [weak self] e in
            guard let self, e.keyCode == 53, let island = self.island, e.window === island else { return e }
            self.close(byUser: true); return nil
        }) { monitors.append(k) }
        state.onUserClose = { [weak self] in self?.hover.userClosed(); self?.island?.resignKey() }
        detectOtherIslands()
    }

    func start(port: Int) { state.start(port: port) }

    private func detectOtherIslands() {
        let running = NSWorkspace.shared.runningApplications.compactMap { $0.bundleIdentifier }
        otherIsland = running.compactMap { CompanionController.islandApps[$0] }.first
        state.coucou.available = running.contains("fr.louisraille.NotchBuddy") || running.contains("fr.louisraille.Coucou")
        refresh()
    }

    /// One pointer sample: let clicks through outside the island, swell on hover, open after a
    /// short rest, close after the pointer leaves unless something holds it open.
    private func tick() {
        guard showIsland, otherIsland == nil, let screen = IslandGeometry.screen(), let island, island.isVisible else {
            if state.hovering { state.hovering = false }
            return
        }
        let m = NSEvent.mouseLocation
        let rect = island.islandRectOnScreen
        let overIsland = rect != .zero && rect.insetBy(dx: -6, dy: -6).contains(m)
        // the notch strip, including the very top pixel row (NSRect.contains excludes maxY)
        let zone = IslandGeometry.notchRect(on: screen).insetBy(dx: -10, dy: 0)
        let overNotch = zone.minX <= m.x && m.x <= zone.maxX && zone.minY <= m.y && m.y <= screen.frame.maxY
        let inside = overIsland || overNotch
        let takesClicks = inside
        if island.ignoresMouseEvents == takesClicks { island.ignoresMouseEvents = !takesClicks }
        if state.hovering != inside { state.hovering = inside }
        if inside && !state.peek { state.peek = true }
        let holding = !state.items.isEmpty || state.chatBusy || island.isKeyWindow
        switch hover.update(pointerInside: inside, expanded: state.expanded, holding: holding, now: Date()) {
        case .open: state.openedAt = Date(); state.expanded = true
        case .close: close(byUser: false)
        case .none: if !inside && !state.expanded && state.peek { state.peek = false }
        }
    }

    private func close(byUser: Bool) {
        if byUser { hover.userClosed() }
        if state.expanded { state.expanded = false }
        if !hover.inside, state.peek { state.peek = false }
        if island?.isKeyWindow == true { island?.resignKey() }
    }

    func refresh() {
        if let screen = IslandGeometry.screen() {
            let n = IslandGeometry.notch(on: screen)
            if state.notchWidth != n.width { state.notchWidth = n.width }
            if state.notchHeight != n.height { state.notchHeight = n.height }
        }
        let corner = otherIsland != nil
        if state.cornerMode != corner { state.cornerMode = corner }

        if let button = statusItem?.button {
            button.image = CompanionController.orbIcon(filled: state.mood != .idle)
            button.imagePosition = .imageLeading
            button.title = state.items.isEmpty ? "" : " \(state.items.count)"
            button.toolTip = "Atlas · \(state.status)"
        }
        // own the notch while busy/peeking; when another island app runs, appear only for decisions
        // always present in the notch (like the iPhone island); with another island app, only for decisions
        let visible = showIsland && (corner ? !state.items.isEmpty : true)
        if visible {
            if island == nil { island = IslandPanel(companion: state) }
            island?.place()
            if island?.isVisible == false { island?.orderFrontRegardless() }
        } else if island?.isVisible == true {
            island?.orderOut(nil)
        }
    }

    static func orbIcon(filled: Bool) -> NSImage {
        let image = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { rect in
            let ring = NSBezierPath(ovalIn: rect.insetBy(dx: 3, dy: 3))
            NSColor.black.setStroke()
            ring.lineWidth = 1.5
            ring.stroke()
            if filled {
                NSColor.black.setFill()
                NSBezierPath(ovalIn: rect.insetBy(dx: 5.5, dy: 5.5)).fill()
            }
            return true
        }
        image.isTemplate = true
        return image
    }

    // MARK: menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let header = NSMenuItem(title: state.ticker.isEmpty ? state.status : "\(state.status) · \(state.ticker)", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        if !state.items.isEmpty {
            menu.addItem(.separator())
            for item in state.items.prefix(8) {
                let title = item.title.count > 60 ? String(item.title.prefix(57)) + "…" : item.title
                let row = NSMenuItem(title: title, action: nil, keyEquivalent: "")
                let sub = NSMenu()
                if !item.context.isEmpty {
                    let ctx = NSMenuItem(title: item.context, action: nil, keyEquivalent: "")
                    ctx.isEnabled = false
                    sub.addItem(ctx)
                    sub.addItem(.separator())
                }
                if item.isQuestion {
                    for choice in item.choices.prefix(4) {
                        sub.addItem(action("Answer “\(choice)”", #selector(answerChoice(_:)), [item.id, choice]))
                    }
                    sub.addItem(action("Answer in the island…", #selector(openIsland(_:)), item.id))
                } else {
                    sub.addItem(action("Allow", #selector(approve(_:)), item.id))
                    if item.command != nil { sub.addItem(action("Always allow this command", #selector(always(_:)), item.id)) }
                    sub.addItem(action("Deny", #selector(deny(_:)), item.id))
                }
                row.submenu = sub
                menu.addItem(row)
            }
        }
        menu.addItem(.separator())
        let island = action(otherIsland.map { "Show Dynamic Island (notch used by \($0))" } ?? "Show Dynamic Island", #selector(toggleIsland), nil)
        island.state = showIsland ? .on : .off
        menu.addItem(island)
        let coucou = action("Report runs to Coucou", #selector(toggleCoucou), nil)
        coucou.state = reportToCoucou ? .on : .off
        if !state.coucou.available { coucou.title += " (not running)" }
        menu.addItem(coucou)
        menu.addItem(.separator())
        menu.addItem(action("Open Atlas", #selector(openAtlas), nil))
        menu.addItem(NSMenuItem(title: "Quit Atlas", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }

    private func action(_ title: String, _ selector: Selector, _ payload: Any?) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: selector, keyEquivalent: "")
        item.target = self
        item.representedObject = payload
        return item
    }

    private func find(_ sender: NSMenuItem) -> PendingItem? {
        guard let id = sender.representedObject as? String else { return nil }
        return state.items.first { $0.id == id }
    }

    @objc private func approve(_ sender: NSMenuItem) { if let i = find(sender) { state.decide(i, approved: true) } }
    @objc private func always(_ sender: NSMenuItem) { if let i = find(sender) { state.alwaysAllow(i) } }
    @objc private func deny(_ sender: NSMenuItem) { if let i = find(sender) { state.decide(i, approved: false) } }
    @objc private func answerChoice(_ sender: NSMenuItem) {
        guard let pair = sender.representedObject as? [String], pair.count == 2,
              let item = state.items.first(where: { $0.id == pair[0] }) else { return }
        state.answer(item, pair[1])
    }
    @objc private func openIsland(_ sender: NSMenuItem) {
        if let id = sender.representedObject as? String, let idx = state.items.firstIndex(where: { $0.id == id }), idx > 0 {
            state.items.insert(state.items.remove(at: idx), at: 0)
        }
        state.expanded = true
        if !showIsland { showIsland = true } else { refresh() }
    }
    @objc private func toggleIsland() { showIsland.toggle() }
    @objc private func toggleCoucou() { reportToCoucou.toggle() }
    @objc private func openAtlas() { state.openApp?() }
}
