// Bestly Admin: Home screen state: the Hestia agent, the callbox (Ava's door line) and the Home Assistant automations.
import SwiftUI

struct HomeAuto: Identifiable {
    var id: String          // entity_id
    var name: String
    var on: Bool
    var lastRun: Date?
}

@MainActor
final class HomeModel: ObservableObject {
    @Published var agent: JSON?
    @Published var agentFailed = false
    @Published var settings: JSON?
    @Published var expected: [JSON] = []
    @Published var events: [JSON] = []
    @Published var callboxFailed = false
    @Published var autos: [HomeAuto] = []
    @Published var autosLoaded = false
    @Published var overrides: [String: Bool] = [:]
    @Published var notice: String?
    @Published var toast: String?

    // MARK: loading

    func load() async {
        async let a: Any? = try? await TKit.restGet("home_hub_agent_state?select=agent,last_seen_at,version,info&order=last_seen_at.desc&limit=1")
        async let c: Any? = try? await AdminAPI.rpc("callbox_admin_state")
        async let s: Any? = try? await TKit.restGet("home_hub_snapshots?select=captured_at,ok,automations:data->automations&source=eq.homeassistant")
        let (av, cv, sv) = await (a, c, s)
        if let row = TKit.rows(av).first { agent = row; agentFailed = false; ScreenWatch.ok("home") } else if agent == nil { agentFailed = true; ScreenWatch.failed("home") { [weak self] in await self?.load() } }
        if let o = cv as? JSON {
            settings = o.obj("settings")
            expected = o.arr("expected")
            events = o.arr("events")
            callboxFailed = false
        } else if settings == nil { callboxFailed = true }
        if let row = TKit.rows(sv).first {
            let list = (row["automations"] as? [Any])?.compactMap { $0 as? JSON } ?? []
            autos = list.compactMap { a in
                guard let id = a.str("entity_id") else { return nil }
                return HomeAuto(id: id, name: a.str("name") ?? id, on: a.bool("on") ?? false, lastRun: AdminFmt.date(a.str("last_triggered")))
            }.sorted { ($0.lastRun ?? .distantPast) > ($1.lastRun ?? .distantPast) }
            autosLoaded = true
            for (k, v) in overrides where autos.first(where: { $0.id == k })?.on == v { overrides[k] = nil }
        }
    }

    // MARK: agent

    var host: String { TKit.titleCase(agent?.obj("info")?.str("host") ?? "Hestia") }
    var lastSeen: Date? { AdminFmt.date(agent?.str("last_seen_at")) }
    var agentOnline: Bool { lastSeen.map { Date().timeIntervalSince($0) < 120 } ?? false }
    var agentVersion: String? { agent?.str("version") }

    // MARK: callbox

    var enabled: Bool { settings?.bool("enabled") ?? false }
    var mode: String { settings?.str("mode") ?? "smart" }
    var openDigit: String { settings?.str("open_digit") ?? "9" }
    var unitCode: String? { settings?.str("unit_code") }
    var partyUntil: Date? { AdminFmt.date(settings?.str("party_until")) }
    var partyLive: Bool { mode == "party" && (partyUntil.map { $0 > Date() } ?? false) }
    var liveExpected: [JSON] {
        expected.filter { e in
            if e.str("cancelled_at") != nil { return false }
            guard let end = AdminFmt.date(e.str("window_end")) else { return true }
            return end > Date()
        }
    }
    var selfTestWords: String {
        guard let ok = settings?.bool("last_selftest_ok") else { return "self-test not run yet" }
        return ok ? "self-test passed" : "self-test failed"
    }

    func modeLine() -> String {
        let press = "Press \(openDigit) to open."
        switch mode {
        case "ask": return "Ask checks with you for every visitor. If you don't answer in time, Ava takes a message. \(press)"
        case "party":
            if let until = partyUntil, partyLive { return "Party opens the door for everyone until \(TKit.clock(until)). \(press)" }
            return "Party opens the door for everyone. It has ended, so pick a mode. \(press)"
        case "off": return "Off means Ava does not open the door for anyone. \(press)"
        default: return "Smart opens for people you expect and asks you about everyone else. \(press)"
        }
    }

    /// Does the server's callbox state show every key we just sent?
    private static func matches(_ st: JSON, _ p: JSON) -> Bool {
        for (k, v) in p {
            switch k {
            case "enabled": if st.bool("enabled") != (v as? Bool) { return false }
            case "mode": if st.str("mode") != (v as? String) { return false }
            case "party_until":
                let want = v as? String ?? ""
                if want.isEmpty { if st.str("party_until") != nil { return false } }
                else {
                    guard let a = AdminFmt.date(st.str("party_until")), let b = AdminFmt.date(want), abs(a.timeIntervalSince(b)) < 2 else { return false }
                }
            default: break
            }
        }
        return true
    }

    private func readCallbox() async -> JSON? {
        (try? await AdminAPI.rpc("callbox_admin_state")) as? JSON
    }

    /// Partial patch to the callbox. Checks the server took it; on failure the old state comes back (Action shows the toast).
    func patch(_ p: JSON, optimistic: ((inout JSON) -> Void)? = nil) async {
        let before = settings
        if let optimistic, var s = settings { optimistic(&s); settings = s }
        let id = "home.callbox_" + p.keys.sorted().joined(separator: "_")
        let ok = await Action.run(id, attempt: {
            try await AdminAPI.rpc("callbox_settings_set", ["p": p])
        }, verify: { [self] in
            guard let st = await readCallbox()?.obj("settings") else { return false }
            return Self.matches(st, p)
        })
        if !ok { settings = before }
        await load()
    }

    func setMode(_ m: String) async { await patch(["mode": m, "party_until": ""]) { $0["mode"] = m } }

    func startParty(until: Date) async {
        await patch(["mode": "party", "party_until": AdminFmt.iso.string(from: until)]) { $0["mode"] = "party" }
    }

    func cancelExpected(_ e: JSON) async {
        guard let id = e.str("id") else { return }
        let before = expected
        expected.removeAll { $0.str("id") == id }
        let ok = await Action.run("home.expect_cancel", okSay: "Cancelled \(e.str("label") ?? "that")", attempt: {
            // {ok:false} here only means it was already cancelled, which is the result we want
            _ = try await AdminAPI.rpc("callbox_expect_cancel", ["p_id": id])
            return ["ok": true]
        }, verify: { [self] in
            guard let st = await readCallbox() else { return false }
            return !st.arr("expected").contains { $0.str("id") == id }
        })
        if !ok { expected = before }
        await load()
    }

    func addExpected(label: String, kind: String, keywords: [String], minutes: Int?) async -> String? {
        let start = Date()
        var end: Date
        if let minutes { end = start.addingTimeInterval(Double(minutes) * 60) } else {
            var c = Calendar(identifier: .gregorian); c.timeZone = AdminFmt.la
            end = c.date(bySettingHour: 23, minute: 59, second: 0, of: start) ?? start.addingTimeInterval(3600)
            if end.timeIntervalSince(start) < 300 { end = start.addingTimeInterval(3600) }
        }
        let p: JSON = ["p_label": label, "p_kind": kind, "p_start": AdminFmt.iso.string(from: start), "p_end": AdminFmt.iso.string(from: end),
                       "p_keywords": keywords, "p_source": "manual", "p_source_ref": NSNull(), "p_note": NSNull(), "p_max_uses": NSNull()]
        // Adding twice would expect the same person twice, so no automatic retry.
        let ok = await Action.run("home.expect_add", idempotent: false, okSay: "Expecting \(label) until \(TKit.clock(end))", attempt: {
            try await AdminAPI.rpc("callbox_expect_add", p)
        }, verify: { [self] in
            guard let st = await readCallbox() else { return false }
            let want = String(label.prefix(80)).trimmingCharacters(in: .whitespaces)
            return st.arr("expected").contains { $0.str("label") == want && $0.str("cancelled_at") == nil && (AdminFmt.date($0.str("created_at")).map { Date().timeIntervalSince($0) < 180 } ?? true) }
        })
        await load()
        return ok ? nil : "Couldn't add \(label). Scout has it."
    }

    static func doorWords(_ e: JSON) -> String {
        let d = (e.str("decision") ?? "").lowercased(), s = (e.str("status") ?? "").lowercased(), o = (e.str("outcome") ?? "").lowercased()
        if s == "pending" { return "Waiting for you" }
        if d == "auto_open" || d == "expected" { return "Opened (expected)" }
        if d == "party" { return "Opened (party)" }
        if s == "expired" || o.contains("expired") || o.contains("message") { return "No answer, took a message" }
        if s == "deny" || o.contains("denied") || o.contains("said no") || o.contains("sent off") { return "You said no" }
        if s == "open" || s == "done" { return (o.contains("opened by") || d == "ask" || d.isEmpty) ? "You opened it" : "Opened" }
        let raw = d.isEmpty ? (s.isEmpty ? "Unknown" : s) : d
        return TKit.titleCase(raw)
    }

    // MARK: automations

    func isOn(_ a: HomeAuto) -> Bool { overrides[a.id] ?? a.on }

    private func inventoryState(_ id: String) async -> String? {
        guard let row = TKit.rows(try? await TKit.restGet("ha_inventory?select=view&id=eq.true")).first else { return nil }
        return row.arr("view").first { $0.str("entity_id") == id }?.str("state")
    }

    func toggle(_ a: HomeAuto, to on: Bool) async {
        overrides[a.id] = on
        notice = nil
        var pending = false
        var serverError: String?
        let ok = await Action.run("home.auto_toggle", attempt: {
            let r = try await AdminAPI.invoke("ha-fixer", ["op": "toggle", "entity_id": a.id, "enabled": on]) as? JSON
            serverError = r?.bool("ok") == false ? r?.str("error") : nil
            pending = r?.bool("pending") == true
            return r
        }, verify: { [self] in
            // ha-fixer writes the new state into its list once Home Assistant says done. If the Pi was slow, wait longer for it.
            let deadline = Date().addingTimeInterval(pending ? 25 : 0)
            repeat {
                if await inventoryState(a.id) == (on ? "on" : "off") { return true }
                if pending { try? await Task.sleep(nanoseconds: 2_000_000_000) }
            } while Date() < deadline
            return false
        })
        if !ok {
            overrides[a.id] = nil
            notice = serverError ?? "Home Assistant didn't take that. \(a.name) is back where it was."
            await load()
            return
        }
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        await load()
    }

    static func ranText(_ d: Date?) -> String {
        guard let d else { return "Never run" }
        return "Ran " + TKit.when(d).replacingOccurrences(of: "Today ", with: "")
    }
}
