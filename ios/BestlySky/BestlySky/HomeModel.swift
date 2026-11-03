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

    /// Partial patch to the callbox. Reloads after; on error the old state comes back and the toast says why.
    func patch(_ p: JSON, optimistic: ((inout JSON) -> Void)? = nil) async {
        let before = settings
        if let optimistic, var s = settings { optimistic(&s); settings = s }
        do {
            let r = try await AdminAPI.rpc("callbox_settings_set", ["p": p]) as? JSON
            if r?.bool("ok") == false { throw AdminAPIError(status: 400, message: r?.str("error") ?? "The callbox said no.") }
            Haptics.ok()
        } catch {
            settings = before
            Haptics.fail()
            toast = "Couldn't change the callbox. \(error.localizedDescription)"
        }
        await load()
    }

    func setMode(_ m: String) async { await patch(["mode": m, "party_until": ""]) { $0["mode"] = m } }

    func startParty(until: Date) async {
        await patch(["mode": "party", "party_until": AdminFmt.iso.string(from: until)]) { $0["mode"] = "party" }
    }

    func cancelExpected(_ e: JSON) async {
        guard let id = e.str("id") else { return }
        expected.removeAll { $0.str("id") == id }
        do { _ = try await AdminAPI.rpc("callbox_expect_cancel", ["p_id": id]); toast = "Cancelled \(e.str("label") ?? "that")" }
        catch { toast = "Couldn't cancel. \(error.localizedDescription)" }
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
        do {
            let p: JSON = ["p_label": label, "p_kind": kind, "p_start": AdminFmt.iso.string(from: start), "p_end": AdminFmt.iso.string(from: end),
                           "p_keywords": keywords, "p_source": "manual", "p_source_ref": NSNull(), "p_note": NSNull(), "p_max_uses": NSNull()]
            let r = try await AdminAPI.rpc("callbox_expect_add", p) as? JSON
            if r?.bool("ok") == false { return r?.str("error") ?? "The callbox said no." }
            Haptics.ok()
            toast = "Expecting \(label) until \(TKit.clock(end))"
            await load()
            return nil
        } catch {
            Haptics.fail()
            return "Couldn't add \(label). \(error.localizedDescription)"
        }
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

    func toggle(_ a: HomeAuto, to on: Bool) async {
        overrides[a.id] = on
        notice = nil
        do {
            let r = try await AdminAPI.invoke("ha-fixer", ["op": "toggle", "entity_id": a.id, "enabled": on]) as? JSON
            if r?.bool("ok") == false {
                overrides[a.id] = nil
                Haptics.fail()
                notice = r?.str("error") ?? "Home Assistant didn't take that."
                return
            }
            Haptics.ok()
            if r?.bool("pending") == true { notice = "Sent to Home Assistant. It can take a moment to show." }
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            await load()
        } catch {
            overrides[a.id] = nil
            Haptics.fail()
            notice = "Couldn't switch \(a.name). \(error.localizedDescription)"
        }
    }

    static func ranText(_ d: Date?) -> String {
        guard let d else { return "Never run" }
        return "Ran " + TKit.when(d).replacingOccurrences(of: "Today ", with: "")
    }
}
