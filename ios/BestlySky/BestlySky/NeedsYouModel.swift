// Bestly Admin: data for the Needs you screen. One shared model so the tab badge, the screen and lock-screen actions agree.
// Reads admin_today, folds the Ares security pile into one row, and writes through admin_today_act.
import Foundation
import SwiftUI

enum NeedsTag: Int {
    case critical = 0, urgent, waiting, fyi
    var label: String {
        switch self {
        case .critical: return "Critical"
        case .urgent: return "Urgent"
        case .waiting: return "Waiting"
        case .fyi: return "FYI"
        }
    }
    var tagBg: Color {
        switch self {
        case .critical: return AT.hex(0xF87171, 0.16)
        case .urgent: return AT.hex(0xFB923C, 0.16)
        case .waiting: return AT.hex(0xBFE3FF, 0.14)
        case .fyi: return AT.hex(0xFFFFFF, 0.08)
        }
    }
    var tagFg: Color {
        switch self {
        case .critical: return AT.hex(0xFCA5A5)
        case .urgent: return AT.hex(0xFDBA74)
        case .waiting: return AT.sky
        case .fyi: return AT.secondary
        }
    }
}

struct NeedsRow: Identifiable, Equatable {
    var key: String
    var source: String
    var severity: String
    var title: String
    var detail: String?
    var actionLabel: String?
    var url: String?
    var since: Date?
    var itemCount: Int?
    var rank: Int
    var foldedKeys: [String] = []

    var id: String { key }
    var isFold: Bool { !foldedKeys.isEmpty }
    var isHermesApproval: Bool { key.hasPrefix("hermes:act:") }
    var allKeys: [String] { isFold ? foldedKeys : [key] }
    var tag: NeedsTag {
        switch severity.lowercased() {
        case "blocked", "critical", "error": return .critical
        case "warning": return .urgent
        case "info": return .fyi
        default: return .waiting
        }
    }
}

/// Who a row is from. One place to change the map.
enum NeedsWho {
    private static let bySource: [String: String] = [
        "security": "Ares, Head of Security",
        "hermes": "Hermes, Mail Clerk",
        "studio": "Studio"
    ]
    static func employee(_ source: String) -> String { bySource[source.lowercased()] ?? "Scout" }
    static func line(_ source: String) -> String { "From " + employee(source) }
}

struct NeedsOpen {
    var label: String
    var route: AdminRoute
}

enum NeedsRouting {
    static func target(for row: NeedsRow) -> NeedsOpen {
        let ask = NeedsOpen(label: "Ask Scout", route: .scout)
        if row.source.lowercased() == "down" { return ask }
        guard let raw = row.url?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return ask }
        var pathQuery = raw
        if raw.lowercased().hasPrefix("http") {
            guard let u = URL(string: raw), let host = u.host?.lowercased() else { return ask }
            if host != "bestly.tech" && host != "www.bestly.tech" { return NeedsOpen(label: "Open web", route: .safari(u)) }
            pathQuery = u.path + (u.query.map { "?" + $0 } ?? "")
        }
        if !pathQuery.hasPrefix("/") { pathQuery = "/" + pathQuery }
        let parts = pathQuery.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let path = String(parts.first ?? "")
        let query = parts.count > 1 ? String(parts[1]) : ""
        if path == "/admin" || path == "/admin/" { return ask }
        _ = query
        if path.hasPrefix("/admin/turo") { return NeedsOpen(label: "Open Turo", route: .turo) }
        if path.hasPrefix("/admin/home-hub") { return NeedsOpen(label: "Open Home", route: .home) }
        if path.hasPrefix("/admin/maya") || path.hasPrefix("/admin/roofguard") || path.hasPrefix("/admin/agents") {
            return NeedsOpen(label: "Open Agents", route: .agents)
        }
        if path.hasPrefix("/admin/wall") { return NeedsOpen(label: "Open Wall", route: .wall) }
        let web = URL(string: "https://www.bestly.tech" + pathQuery) ?? URL(string: "https://www.bestly.tech/admin")!
        return NeedsOpen(label: row.key.hasPrefix("hermes:") ? "Open" : "Open web", route: .safari(web))
    }
}

enum NeedsAct { case done, later, approve }

struct NeedsToast: Identifiable, Equatable {
    var id = UUID()
    var text: String
    var undoKeys: [String]
}

@MainActor
final class NeedsYouModel: ObservableObject {
    static let shared = NeedsYouModel()

    @Published private(set) var rows: [NeedsRow] = []
    @Published private(set) var badgeCount = 0
    @Published private(set) var lastChecked: Date?
    @Published private(set) var loadFailed = false
    @Published private(set) var loadedOnce = false
    @Published var toast: NeedsToast?

    private var hidden: Set<String> = []
    private var loading = false
    private var pollTask: Task<Void, Never>?

    /// Background poll so the tab badge stays honest even when this screen is not open. Safe to call twice.
    func start() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.load()
                try? await Task.sleep(nanoseconds: 60_000_000_000)
            }
        }
    }

    // MARK: loading

    func load() async {
        guard AdminAuth.shared.isSignedIn else { rows = []; badgeCount = 0; return }
        if loading { return }
        loading = true
        defer { loading = false; loadedOnce = true }
        do {
            let any = try await AdminAPI.rpc("admin_today")
            let list = (any as? [Any])?.compactMap { $0 as? JSON } ?? []
            let parsed = list.compactMap(Self.parse).filter { !hidden.contains($0.key) }
            apply(parsed)
            lastChecked = Date()
            loadFailed = false
            ScreenWatch.ok("needs_you")
        } catch {
            loadFailed = true
            ScreenWatch.failed("needs_you") { [weak self] in await self?.load() }
        }
    }

    private func apply(_ parsed: [NeedsRow]) {
        let folded = Self.sorted(Self.fold(parsed))
        rows = folded
        badgeCount = folded.filter { $0.tag != .fyi }.count
    }

    static func parse(_ j: JSON) -> NeedsRow? {
        guard let key = j.str("key"), let title = j.str("title") else { return nil }
        return NeedsRow(key: key,
                        source: j.str("source") ?? "Scout",
                        severity: j.str("severity") ?? "todo",
                        title: title,
                        detail: j.str("detail").flatMap { $0.isEmpty ? nil : $0 },
                        actionLabel: j.str("action_label"),
                        url: j.str("url"),
                        since: AdminFmt.date(j.str("since")),
                        itemCount: j.int("item_count"),
                        rank: j.int("rank") ?? 3)
    }

    static func sorted(_ rows: [NeedsRow]) -> [NeedsRow] {
        rows.sorted { a, b in
            if a.tag.rawValue != b.tag.rawValue { return a.tag.rawValue < b.tag.rawValue }
            let da = a.since ?? .distantFuture, db = b.since ?? .distantFuture
            if da != db { return da < db }
            return a.title < b.title
        }
    }

    /// More than two security rows become one "Ares couldn't fix N security findings" row.
    static func fold(_ rows: [NeedsRow]) -> [NeedsRow] {
        let sec = rows.filter { $0.key.hasPrefix("sec:") }
        guard sec.count > 2 else { return rows }
        let ordered = sorted(sec)
        let top = ordered[0]
        var topTitle = top.title
        if let r = topTitle.range(of: #"^Ares couldn.t fix:\s*"#, options: .regularExpression) { topTitle.removeSubrange(r) }
        let oldest = sec.compactMap { $0.since }.min()
        let fold = NeedsRow(key: "fold:sec",
                            source: "Security",
                            severity: top.severity,
                            title: "Ares couldn\u{2019}t fix \(sec.count) security findings",
                            detail: "Top one: " + topTitle,
                            actionLabel: "Open security",
                            url: "/admin/security",
                            since: oldest,
                            itemCount: sec.count,
                            rank: sec.map { $0.rank }.min() ?? 1,
                            foldedKeys: sec.map { $0.key })
        return rows.filter { !$0.key.hasPrefix("sec:") } + [fold]
    }

    // MARK: actions

    func perform(_ row: NeedsRow, _ act: NeedsAct) async {
        if act == .approve {
            let ok = await FaceIDGate.confirm(reason: "Approve what Hermes proposed")
            guard ok else { Haptics.nope(); return }
        }
        let keys = row.allKeys
        let wire: String = act == .approve ? "approve" : (act == .later ? "snooze" : "dismiss")
        hidden.formUnion(keys)
        withAnimation(.easeOut(duration: 0.22)) {
            rows.removeAll { $0.id == row.id }
        }
        badgeCount = rows.filter { $0.tag != .fyi }.count

        var failed = false
        for k in keys {
            if !(await call(k, wire)) { failed = true }
        }
        if failed {
            Haptics.fail()
            hidden.subtract(keys)
            await load()
            toast = NeedsToast(text: "Couldn\u{2019}t do that. Nothing changed.", undoKeys: [])
            scheduleToastClear()
            return
        }
        Haptics.ok()
        // Approve and Hermes "Not now" cannot be undone on the server.
        let undoable = act != .approve && !row.isHermesApproval
        switch act {
        case .done: toast = NeedsToast(text: "Done", undoKeys: undoable ? keys : [])
        case .later: toast = NeedsToast(text: "Later, back in 3\u{00A0}hr", undoKeys: keys)
        case .approve: toast = NeedsToast(text: "Approved", undoKeys: [])
        }
        scheduleToastClear()
        // The server stops returning it; clear the local guard on the next refresh.
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            self?.hidden.subtract(keys)
            await self?.load()
        }
    }

    func undo(_ t: NeedsToast) async {
        toast = nil
        var failed = false
        for k in t.undoKeys { if !(await call(k, "undo")) { failed = true } }
        hidden.subtract(t.undoKeys)
        if failed { Haptics.fail() } else { Haptics.ok() }
        await load()
    }

    private func call(_ key: String, _ action: String) async -> Bool {
        do {
            let res = try await AdminAPI.rpc("admin_today_act", ["p_key": key, "p_action": action])
            if let j = res as? JSON { return j.bool("ok") ?? false }
            return false
        } catch {
            return false
        }
    }

    private func scheduleToastClear() {
        guard let id = toast?.id else { return }
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            if self?.toast?.id == id { self?.toast = nil }
        }
    }

    // MARK: text helpers

    private static func f(_ p: String) -> DateFormatter {
        let d = DateFormatter(); d.locale = Locale(identifier: "en_US_POSIX"); d.timeZone = AdminFmt.la; d.dateFormat = p; return d
    }
    private static let monthDay = f("MMM d")

    static func monthDayString(_ d: Date) -> String { monthDay.string(from: d) }

    /// "since Oct 6", "18 hr", "42 min", "now".
    static func sinceText(_ d: Date?, now: Date = Date()) -> String {
        guard let d else { return "" }
        let s = now.timeIntervalSince(d)
        if s < 60 { return "just now" }
        if s < 3600 { return "\(Int(s / 60))\u{00A0}min" }
        if s < 86400 { return "\(Int(s / 3600))\u{00A0}hr" }
        return "since " + monthDay.string(from: d)
    }
}
