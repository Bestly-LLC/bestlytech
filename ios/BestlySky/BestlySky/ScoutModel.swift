// Bestly Admin: Scout chat data. Reads admin_chat_* with the signed-in user's JWT, sends through the admin-chat edge function.
import Foundation
import SwiftUI

// MARK: - table reads (GET /rest/v1/<path>)

enum ScoutREST {
    static func get(_ path: String) async throws -> [JSON] {
        do {
            return try await fetch(path, token: try await AdminAuth.shared.validAccessToken())
        } catch let e as AdminAPIError where e.status == 401 {
            let fresh = try await AdminAuth.shared.refresh()
            return try await fetch(path, token: fresh)
        }
    }

    private static func fetch(_ path: String, token: String) async throws -> [JSON] {
        var req = URLRequest(url: URL(string: AdminConfig.supabaseURL.absoluteString + "/rest/v1/" + path)!)
        req.httpMethod = "GET"
        req.timeoutInterval = 25
        req.setValue(AdminConfig.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw AdminAPIError(status: code, message: "HTTP \(code)") }
        return ((try? JSONSerialization.jsonObject(with: data)) as? [Any])?.compactMap { $0 as? JSON } ?? []
    }
}

// MARK: - parsed message

enum ScoutSeg: Equatable {
    case text(String)
    case code(String)
}

struct ScoutMsg: Identifiable, Equatable {
    var id: String
    var role: String
    var body: String
    var created: Date
    var segments: [ScoutSeg]
    var options: [String]
    var isProgress: Bool
    var stepN: Int?
    var stepMin: Int?

    var isUser: Bool { role == "user" }
    var isStopped: Bool { role == "user" && body.trimmingCharacters(in: .whitespacesAndNewlines) == "[Stopped]" }
    var plainText: String {
        segments.map { s -> String in
            switch s { case .text(let t): return t; case .code(let c): return c }
        }.joined(separator: "\n")
    }
}

enum ScoutParse {
    private static func rx(_ p: String, _ o: NSRegularExpression.Options = []) -> NSRegularExpression {
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: p, options: o)
    }
    private static let filesRx = rx(#"^.*⟦scout-files:.*$\n?"#, [.anchorsMatchLines])
    private static let questionsRx = rx(#"\n?^[ \t]*QUESTIONS[ \t]*:[ \t]*(\{.*\})[ \t]*$"#, [.anchorsMatchLines])
    private static let optionsRx = rx(#"\n?^[ \t]*OPTIONS?[ \t]*:[ \t]*(.+?)[ \t]*$"#, [.anchorsMatchLines, .caseInsensitive])
    private static let continuingRx = rx(#"\s*Still working on it(?: \([^)\n]*\))?\.\s*$"#)
    private static let stepRx = rx(#"\(step (\d+), (\d+) min in\)"#)
    private static let fenceRx = rx("```[^\\n]*\\n([\\s\\S]*?)```")

    private static func full(_ s: String) -> NSRange { NSRange(location: 0, length: (s as NSString).length) }

    private static func strip(_ r: NSRegularExpression, _ s: String) -> (String, NSTextCheckingResult?) {
        guard let m = r.firstMatch(in: s, range: full(s)) else { return (s, nil) }
        let out = (s as NSString).replacingCharacters(in: m.range, with: "")
        return (out, m)
    }

    static func make(id: String, role: String, body: String, created: Date) -> ScoutMsg {
        var text = body
        var options: [String] = []
        var isProgress = false
        var stepN: Int?, stepMin: Int?

        text = strip(filesRx, text).0
        if role == "assistant" {
            if continuingRx.firstMatch(in: text, range: full(text)) != nil {
                isProgress = true
                if let m = stepRx.firstMatch(in: text, range: full(text)) {
                    let ns = text as NSString
                    stepN = Int(ns.substring(with: m.range(at: 1)))
                    stepMin = Int(ns.substring(with: m.range(at: 2)))
                }
                text = continuingRx.stringByReplacingMatches(in: text, range: full(text), withTemplate: "")
            }
            let (afterQ, qm) = strip(questionsRx, text)
            if let qm {
                let json = (text as NSString).substring(with: qm.range(at: 1))
                options = questionLabels(json)
                text = afterQ
            }
            let (afterO, om) = strip(optionsRx, text)
            if let om, options.isEmpty {
                let line = (text as NSString).substring(with: om.range(at: 1))
                let parsed = optionList(line)
                if !parsed.isEmpty { options = parsed; text = afterO }
            } else if om != nil, !options.isEmpty {
                text = afterO
            }
        }
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return ScoutMsg(id: id, role: role, body: body, created: created, segments: segments(text),
                        options: options, isProgress: isProgress, stepN: stepN, stepMin: stepMin)
    }

    static func optionList(_ line: String) -> [String] {
        var out: [String] = []
        for part in line.split(separator: "|", omittingEmptySubsequences: true) {
            var s = part.trimmingCharacters(in: .whitespaces)
            while let f = s.first, "-*\u{2022}".contains(f) { s.removeFirst(); s = s.trimmingCharacters(in: .whitespaces) }
            if s.isEmpty || s.count > 60 { continue }
            out.append(s)
            if out.count == 4 { break }
        }
        return out
    }

    private static func questionLabels(_ json: String) -> [String] {
        guard let d = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? JSON else { return [] }
        for q in o.arr("questions") {
            guard q.str("question") != nil else { continue }
            let labels = q.arr("options").compactMap { $0.str("label") }.filter { !$0.isEmpty && $0.count <= 60 }
            if labels.count >= 2 { return Array(labels.prefix(4)) }
        }
        return []
    }

    static func segments(_ text: String) -> [ScoutSeg] {
        if text.isEmpty { return [] }
        let ns = text as NSString
        var out: [ScoutSeg] = []
        var cursor = 0
        for m in fenceRx.matches(in: text, range: full(text)) {
            if m.range.location > cursor {
                let t = ns.substring(with: NSRange(location: cursor, length: m.range.location - cursor)).trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty { out.append(.text(t)) }
            }
            let c = ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .newlines)
            out.append(.code(c))
            cursor = m.range.location + m.range.length
        }
        if cursor < ns.length {
            let t = ns.substring(from: cursor).trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { out.append(.text(t)) }
        }
        return out
    }
}

// MARK: - threads and prefs

struct ScoutThread: Identifiable, Equatable {
    var id: String
    var title: String
    var lastBody: String
    var updated: Date?
    var count: Int
    var unread: Int
    var needsYou: Bool
}

struct ScoutPrefs: Equatable {
    var autoRun = false
    var paidOK = false
    var paidUntil: Date?
    var offReason: String?
    var offBy: String?
    var chatCap: Double?
    var backgroundCap: Double?
}

enum ScoutText {
    /// Cuts at a word boundary with no ellipsis.
    static func short(_ s: String, _ n: Int) -> String {
        let flat = s.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        if flat.count <= n { return flat }
        let cut = String(flat.prefix(n))
        if let sp = cut.lastIndex(of: " "), cut.distance(from: cut.startIndex, to: sp) > n / 2 { return String(cut[..<sp]) }
        return cut
    }
    static func ago(_ d: Date?, now: Date = Date()) -> String {
        guard let d else { return "" }
        let s = now.timeIntervalSince(d)
        if s < 60 { return "just now" }
        if s < 3600 { return "\(Int(s / 60))\u{00A0}min ago" }
        if s < 86400 { return "\(Int(s / 3600))\u{00A0}hr ago" }
        return "\(Int(s / 86400))\u{00A0}d ago"
    }
}

// MARK: - model

@MainActor
final class ScoutModel: ObservableObject {
    @Published var threads: [ScoutThread] = []
    @Published var threadId: String?
    @Published var messages: [ScoutMsg] = []
    @Published var input = ""
    @Published var sending = false
    @Published var pendingUser: String?
    @Published var notice: String?
    @Published var prefs = ScoutPrefs()
    @Published var prefsKnown = false
    @Published var budgetLine: String?
    @Published var loaded = false
    @Published var tick = 0
    /// The POST ended without a reply (slow server, dropped connection) but Scout may still answer: keep polling the table.
    @Published var awaiting = false

    var visible = false
    private var sendStart = Date()
    private var awaitDeadline = Date.distantPast
    private var lastSentText = ""
    private var generation = 0
    private var markTask: Task<Void, Never>?
    private var lastMarked = ""
    private static let threadKey = "scoutThreadId"

    static let maxChars = 6000

    // MARK: derived

    var continuing: Bool {
        guard let last = messages.last, last.role == "assistant", last.isProgress else { return false }
        return Date().timeIntervalSince(last.created) < 240
    }
    var running: Bool { sending || continuing || awaiting }
    var anyNeedsYou: Bool { threads.contains { $0.needsYou } }
    var anyUnread: Bool { threads.contains { $0.unread > 0 } }
    var currentTitle: String {
        if let id = threadId, let t = threads.first(where: { $0.id == id }) { return ScoutText.short(t.title, 30) }
        return threadId == nil ? "New chat" : "Chat"
    }
    var progressText: String {
        if let last = messages.last, continuing, let n = last.stepN, let m = last.stepMin {
            return "Still working on it, step \(n), \(m)\u{00A0}min in"
        }
        if continuing { return "Still working on it" }
        return "Scout is working on it"
    }
    var lastOptions: [String] {
        guard !running, let last = messages.last, last.role == "assistant" else { return [] }
        return last.options
    }

    // MARK: lifecycle

    func boot() async {
        if threadId == nil, !loaded {
            threadId = UserDefaults.standard.string(forKey: Self.threadKey)
        }
        async let a: Void = loadThreads()
        async let b: Void = loadPrefs()
        _ = await (a, b)
        if let t = threadId { await loadMessages(t) }
        loaded = true
    }

    func pollTick(_ n: Int) async {
        guard visible else { return }
        tick += 1
        if awaiting { await pollForReply() }
        else if running, let t = threadId, !(sending && Date().timeIntervalSince(sendStart) < 5) { await loadMessages(t) }
        if n % 10 == 0 { await loadThreads() }
        if n % 10 == 5 { await loadPrefs() }
    }

    /// While waiting for a reply the POST never delivered: find the thread, reload, stop waiting when Scout's answer lands.
    private func pollForReply() async {
        if threadId == nil {
            await loadThreads()
            if let first = threads.first, let u = first.updated, u > sendStart.addingTimeInterval(-30) {
                threadId = first.id
                UserDefaults.standard.set(first.id, forKey: Self.threadKey)
            }
        }
        if let t = threadId { await loadMessages(t) }
        let cutoff = sendStart.addingTimeInterval(-2)
        let answered = messages.contains { $0.role == "assistant" && !$0.isProgress && $0.created > cutoff }
        if answered {
            awaiting = false
            pendingUser = nil
            await loadThreads()
            return
        }
        let delivered = messages.contains { $0.isUser && $0.created > cutoff && $0.body.trimmingCharacters(in: .whitespacesAndNewlines) == lastSentText }
        if !delivered && Date().timeIntervalSince(sendStart) > 25 {
            // The server never saw it: give the text back instead of waiting for a reply that cannot come.
            awaiting = false
            pendingUser = nil
            if input.isEmpty { input = lastSentText }
            notice = "That message didn\u{2019}t go through. It\u{2019}s back in the box, tap send to try again."
            Haptics.fail()
            return
        }
        if Date() > awaitDeadline {
            awaiting = false
            pendingUser = nil
            notice = "Scout hasn\u{2019}t answered yet. Say \u{2018}keep going\u{2019} to nudge it, or check back in a minute."
        }
    }

    // MARK: reads

    func loadThreads() async {
        do {
            let rows = try await ScoutREST.get("admin_chat_thread_list?select=id,title,updated_at,message_count,last_body,unread,needs_you&order=updated_at.desc&limit=40")
            threads = rows.compactMap { r in
                guard let id = r.str("id") else { return nil }
                return ScoutThread(id: id, title: r.str("title") ?? "Untitled", lastBody: r.str("last_body") ?? "",
                                   updated: AdminFmt.date(r.str("updated_at")), count: r.int("message_count") ?? 0,
                                   unread: r.int("unread") ?? 0, needsYou: r.bool("needs_you") ?? false)
            }
            ScreenWatch.ok("scout")
        } catch {
            // keep what we had
            ScreenWatch.failed("scout") { [weak self] in await self?.loadThreads() }
        }
    }

    func loadMessages(_ t: String) async {
        do {
            let rows = try await ScoutREST.get("admin_chat_messages?select=id,role,body,created_at&thread_id=eq.\(t)&order=created_at.asc&limit=500")
            guard t == threadId else { return }
            let parsed: [ScoutMsg] = rows.compactMap { r -> ScoutMsg? in
                guard let id = r.str("id"), let role = r.str("role"), let body = r.str("body"),
                      let at = AdminFmt.date(r.str("created_at")) else { return nil }
                return ScoutParse.make(id: id, role: role, body: body, created: at)
            }
            if parsed != messages { messages = parsed }
            scheduleMarkRead()
        } catch {
            // transient; the next poll retries
        }
    }

    func openThread(_ id: String) async {
        threadId = id
        UserDefaults.standard.set(id, forKey: Self.threadKey)
        messages = []
        notice = nil
        lastMarked = ""
        await loadMessages(id)
    }

    func newChat() {
        generation += 1
        sending = false
        awaiting = false
        pendingUser = nil
        threadId = nil
        messages = []
        notice = nil
        lastMarked = ""
        UserDefaults.standard.removeObject(forKey: Self.threadKey)
    }

    private func scheduleMarkRead() {
        guard visible, let t = threadId, let last = messages.last else { return }
        let stamp = "\(t)|\(messages.count)|\(last.id)"
        guard stamp != lastMarked else { return }
        markTask?.cancel()
        markTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if Task.isCancelled { return }
            do { _ = try await AdminAPI.rpc("admin_chat_mark_read", ["p_thread": t]) } catch { return }
            guard let self else { return }
            self.lastMarked = stamp
            if let i = self.threads.firstIndex(where: { $0.id == t }) {
                self.threads[i].unread = 0
                self.threads[i].needsYou = false
            }
        }
    }

    // MARK: send and stop

    func send(_ raw: String) {
        let text = String(raw.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxChars))
        guard !text.isEmpty, !sending else { return }
        generation += 1
        let gen = generation
        sending = true
        sendStart = Date()
        pendingUser = text
        lastSentText = text
        notice = nil
        input = ""
        Haptics.tap()
        let tid = threadId
        Task { [weak self] in
            guard let self else { return }
            var body: JSON = ["body": text,
                              "page": ["path": "/app/scout", "title": "Bestly Admin app", "heading": "Scout", "about": "Native iPhone app"]]
            if let tid { body["thread_id"] = tid } else { body["thread_id"] = NSNull() }
            do {
                let res = try await AdminAPI.invoke("admin-chat", body) as? JSON
                guard gen == self.generation else { return }
                if let newId = res?.str("thread_id") {
                    if self.threadId != newId {
                        self.threadId = newId
                        UserDefaults.standard.set(newId, forKey: Self.threadKey)
                    }
                }
                self.sending = false
                self.awaiting = false
                if let t = self.threadId { await self.loadMessages(t) }
                self.pendingUser = nil
                await self.loadThreads()
                await self.loadPrefs()
            } catch {
                guard gen == self.generation else { return }
                self.sending = false
                if Self.isAuthError(error) {
                    self.pendingUser = nil
                    self.notice = Self.notice(for: error)
                    Haptics.fail()
                    return
                }
                // Timeout, 504, dropped connection: the server may still be working. Never show an error; keep polling for the reply.
                self.awaiting = true
                self.awaitDeadline = Date().addingTimeInterval(600)
                await self.pollForReply()
            }
        }
    }

    func stop() {
        generation += 1
        sending = false
        awaiting = false
        pendingUser = nil
        Haptics.tap()
        guard let t = threadId else { return }
        Task { [weak self] in
            await Action.run("scout.stop", attempt: { try await AdminAPI.invoke("admin-chat", ["op": "stop", "thread_id": t]) })
            await self?.loadMessages(t)
        }
    }

    private static func isAuthError(_ error: Error) -> Bool {
        if let e = error as? AdminAPIError { return e.status == 401 || e.status == 403 }
        return false
    }

    private static func notice(for error: Error) -> String {
        if let e = error as? AdminAPIError {
            if e.status == 504 || e.status == 546 || e.status == 408 {
                return "That one ran too long and got cut off. Say \u{2018}keep going\u{2019} to pick up where it stopped."
            }
            if e.status == 401 || e.status == 403 { return "Your sign-in expired. Sign out and sign back in." }
        }
        if let u = error as? URLError, u.code == .timedOut || u.code == .networkConnectionLost {
            return "That one ran too long and got cut off. Say \u{2018}keep going\u{2019} to pick up where it stopped."
        }
        return "I couldn\u{2019}t reach the server just now. Try again in a moment."
    }

    // MARK: settings

    func loadPrefs() async {
        guard let j = (try? await AdminAPI.rpc("scout_prefs")) as? JSON else { return }
        var p = ScoutPrefs()
        p.autoRun = j.bool("auto_run") ?? false
        p.paidOK = j.bool("paid_ai_ok") ?? false
        p.paidUntil = AdminFmt.date(j.str("paid_ai_until"))
        p.offReason = j.str("paid_ai_off_reason")
        p.offBy = j.str("paid_ai_off_by") ?? j.str("paid_ai_off_employee")
        p.chatCap = j.dbl("chat_cap_usd")
        p.backgroundCap = j.dbl("background_cap_usd")
        prefs = p
        prefsKnown = true
    }

    func setPaid(_ on: Bool) async {
        let before = prefs
        prefs.paidOK = on
        let ok = await Action.run("scout.paid_ai", okSay: nil,
                                  attempt: { try await AdminAPI.rpc("scout_paid_ai_set", ["p_on": on]) },
                                  verify: { [weak self] in
                                      guard let j = (try? await AdminAPI.rpc("scout_prefs")) as? JSON else { return false }
                                      _ = self
                                      return (j.bool("paid_ai_ok") ?? false) == on
                                  })
        if ok { Haptics.select() } else { prefs = before }
        await loadPrefs()
    }

    func setAutoRun(_ on: Bool) async {
        let before = prefs
        prefs.autoRun = on
        let ok = await Action.run("scout.auto_run",
                                  attempt: { try await AdminAPI.rpc("scout_auto_run_set", ["p_on": on]) },
                                  verify: {
                                      guard let j = (try? await AdminAPI.rpc("scout_prefs")) as? JSON else { return false }
                                      return (j.bool("auto_run") ?? false) == on
                                  })
        if ok { Haptics.select() } else { prefs = before }
        await loadPrefs()
    }

    func loadBudget() async {
        async let c = AdminAPI.rpc("ai_budget", ["p_scope": "chat"])
        async let b = AdminAPI.rpc("ai_budget", ["p_scope": "background"])
        let chat = (try? await c) as? JSON
        let bg = (try? await b) as? JSON
        guard chat != nil || bg != nil else { budgetLine = nil; return }
        let spent = (chat?.dbl("spent") ?? 0) + (bg?.dbl("spent") ?? 0)
        budgetLine = "Spent today " + String(format: "$%.2f", spent)
    }
}
