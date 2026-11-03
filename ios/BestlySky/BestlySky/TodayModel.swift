// Bestly Admin: data for the Today screen. Every card loads on its own and degrades to one line when it cannot.
import Foundation
import SwiftUI

struct StuckSummary: Equatable {
    var itemId: String
    var title: String
    var sentence: String
    var employee: String
    var since: Date?
    var link: String?
    var fixable: Bool          // some block has its own fix button, so "all" works
    var primary: String        // retry | scout | key
    var actionId: String?
    var actionStatus: String?  // working | done | failed | needs_yes
    var actionNote: String?
}

struct MoneySummary: Equatable { var total: Double; var inDelta: Double; var outDelta: Double }

struct TuroSummary: Equatable {
    var title: String
    var line: String
    var stage: Int             // 0 = no ring progress, 1...4
    var tint: Color
}

struct HourTemp: Identifiable, Equatable {
    var id: Int
    var label: String
    var tempF: Int
}

struct DayEvent: Identifiable, Equatable {
    var id: String
    var title: String
    var when: String
}

struct HealthSummary: Equatable {
    var issues: Int
    var red: Bool
}

@MainActor
final class TodayModel: ObservableObject {
    @Published var stuck: StuckSummary?
    @Published var stuckFailed = false
    @Published var money: MoneySummary?
    @Published var moneyFailed = false
    @Published var turo: TuroSummary?
    @Published var turoFailed = false
    @Published var health = HealthSummary(issues: 0, red: false)
    @Published var healthKnown = false
    @Published var hours: [HourTemp] = []
    @Published var nowTempF: Int?
    @Published var weatherFailed = false
    @Published var events: [DayEvent] = []
    @Published var eventsFailed = false
    @Published var loadedOnce = false
    @Published var fixing = false
    @Published var toast: String?

    private var loading = false

    func load() async {
        if loading { return }
        loading = true
        defer { loading = false; loadedOnce = true }
        async let a: Void = loadBundle()
        async let b: Void = loadStuck()
        async let c: Void = loadWeather()
        async let d: Void = loadEvents()
        _ = await (a, b, c, d)
    }

    // MARK: command center bundle: money, turo, issues

    private func loadBundle() async {
        do {
            guard let cc = try await AdminAPI.rpc("admin_command_center") as? JSON else { throw AdminAPIError(status: 0, message: "unexpected shape") }
            if let m = cc.obj("money") {
                money = MoneySummary(total: m.dbl("total") ?? 0, inDelta: m.dbl("in_30d") ?? 0, outDelta: m.dbl("out_30d") ?? 0)
                moneyFailed = false
            } else { money = nil; moneyFailed = true }
            turo = Self.turoSummary(cc.obj("turo")?.obj("widget"))
            turoFailed = false
            let issues = cc.arr("issues")
            let redWords: Set<String> = ["error", "critical", "high", "down", "blocked"]
            health = HealthSummary(issues: issues.count, red: issues.contains { redWords.contains(($0.str("severity") ?? "").lowercased()) })
            healthKnown = true
        } catch {
            moneyFailed = true; turoFailed = true
            await AdminAPI.report("today_load_failed", "command center: \(error.localizedDescription)")
        }
    }

    /// Four quarters: 1 out, 3 heading home (3 hours or less to the return), 4 back. Same stages the Turo return card uses.
    static func turoSummary(_ w: JSON?) -> TuroSummary? {
        guard let w else { return TuroSummary(title: "No Turo trips right now", line: "Nothing to hand off", stage: 0, tint: AT.sky) }
        let car = w.str("car") ?? "The car"
        let battery = w.dbl("battery").map { "\(Int($0.rounded()))%" }
        if let cur = w.obj("current"), let end = AdminFmt.date(cur.str("ends_at")) {
            let left = end.timeIntervalSinceNow
            let stage = left <= 0 ? 4 : (left <= 3 * 3600 ? 3 : 1)
            let title = left <= 0 ? "\(car) is back" : (stage == 3 ? "\(car) heading home" : "\(car) is out")
            var line = "Return " + AdminFmt.time.string(from: end)
            if let battery { line += " \u{00B7} \(battery) battery" }
            return TuroSummary(title: title, line: glue(line), stage: stage, tint: AT.sky)
        }
        if let next = w.obj("next"), let start = AdminFmt.date(next.str("starts_at")) {
            var line = "Pickup " + AdminFmt.whenShort(start)
            if let g = next.str("guest") { line += " \u{00B7} \(g)" }
            return TuroSummary(title: "\(car) is ready for the next trip", line: glue(line), stage: 0, tint: AT.sky)
        }
        var line = "No trips booked"
        if let battery { line += " \u{00B7} \(battery) battery" }
        return TuroSummary(title: "\(car) is home", line: glue(line), stage: 0, tint: AT.sky)
    }

    // MARK: stuck

    private func loadStuck() async {
        do {
            let items = (try await AdminAPI.rpc("admin_stuck_items") as? [Any])?.compactMap { $0 as? JSON } ?? []
            stuckFailed = false
            guard let it = items.first(where: { $0.str("kind") == "stuck" }) else { stuck = nil; return }
            let blocks = it.arr("blocks")
            let fix = it.obj("fix")
            let act = it.obj("action")
            let sentence = it.str("subtitle") ?? blocks.first?.str("label") ?? fix?.str("label") ?? ""
            stuck = StuckSummary(
                itemId: it.str("item_id") ?? "", title: it.str("title") ?? "Something is stuck", sentence: sentence,
                employee: it.str("employee_name") ?? "Scout", since: AdminFmt.date(it.str("stuck_since")),
                link: it.str("link") ?? fix?.str("link"), fixable: blocks.contains { ($0.str("fix_action") ?? "").isEmpty == false },
                primary: fix?.str("primary") ?? "scout", actionId: act?.str("id"), actionStatus: act?.str("status"), actionNote: act?.str("note"))
        } catch {
            stuckFailed = true
            await AdminAPI.report("today_load_failed", "stuck items: \(error.localizedDescription)")
        }
    }

    /// Same logic as the web Stuck card: fixable blocks -> admin_stuck_fix "all"; otherwise the primary button (retry or Scout).
    func runFix() async {
        guard let s = stuck, !fixing else { return }
        fixing = true
        defer { fixing = false }
        do {
            if s.fixable {
                _ = try await AdminAPI.rpc("admin_stuck_fix", ["p_item_id": s.itemId, "p_action": "all"])
            } else {
                _ = try await AdminAPI.rpc("admin_stuck_run", ["p_item_id": s.itemId, "p_action": s.primary == "retry" ? "retry" : "scout"])
            }
        } catch {
            toast = "That fix didn't start. Try again."
            return
        }
        await loadStuck()
        // The server settles the action; ask for its answer every 3 seconds, up to 2 minutes.
        var tries = 0
        while tries < 40, let id = stuck?.actionId, stuck?.actionStatus == "working" {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            _ = try? await AdminAPI.rpc("admin_stuck_action", ["p_action_id": id])
            await loadStuck()
            tries += 1
        }
    }

    // MARK: my day

    private func loadWeather() async {
        do {
            let body: JSON = ["lat": 34.09, "lon": -118.3617, "dataSets": "currentWeather,forecastHourly", "air": false, "country": "US", "lang": "en"]
            guard let j = try await AdminAPI.invoke("weatherkit-proxy", body) as? JSON else { throw AdminAPIError(status: 0, message: "unexpected shape") }
            let f = { (c: Double) -> Int in Int((c * 9 / 5 + 32).rounded()) }
            if let t = j.obj("currentWeather")?.dbl("temperature") { nowTempF = f(t) }
            let now = Date()
            let rows = (j.obj("forecastHourly")?.arr("hours") ?? [])
                .compactMap { h -> (Date, Int)? in
                    guard let d = AdminFmt.date(h.str("forecastStart")), let t = h.dbl("temperature"), d.timeIntervalSince(now) > -59 * 60 else { return nil }
                    return (d, f(t))
                }
                .prefix(6)
            hours = rows.enumerated().map { i, r in HourTemp(id: i, label: i == 0 ? "Now" : AdminFmt.hour.string(from: r.0), tempF: r.1) }
            weatherFailed = false
        } catch {
            weatherFailed = true
            await AdminAPI.report("today_load_failed", "weather: \(error.localizedDescription)")
        }
    }

    private func loadEvents() async {
        do {
            guard let j = try await AdminAPI.rpc("admin_cc_wx_events") as? JSON else { throw AdminAPIError(status: 0, message: "unexpected shape") }
            let now = Date()
            let list = j.arr("events").compactMap { e -> (Date, DayEvent)? in
                if e.bool("all_day") == true { return nil }
                // A Turo pickup/return is drawn an hour off on the wall; "at" is the real reservation time.
                guard let d = AdminFmt.date(e.str("at")) ?? AdminFmt.date(e.str("start")), d > now else { return nil }
                let title = e.str("title") ?? "Event"
                return (d, DayEvent(id: "\(d.timeIntervalSince1970)-\(title)", title: title, when: AdminFmt.whenShort(d)))
            }
            events = Array(list.sorted { $0.0 < $1.0 }.prefix(2).map { $0.1 })
            eventsFailed = false
        } catch {
            eventsFailed = true
            await AdminAPI.report("today_load_failed", "calendar: \(error.localizedDescription)")
        }
    }
}

/// App-wide small counters (the Needs you tab badge).
@MainActor
final class AdminState: ObservableObject {
    static let shared = AdminState()
    @Published var needsYou = 0
    @Published var tab = 0
    @Published var showAva = false
    @Published var showCompass = false
    private var polling = false

    func refreshBadge() async {
        guard AdminAuth.shared.isSignedIn else { needsYou = 0; return }
        if let rows = try? await AdminAPI.rpc("admin_today") as? [Any] { needsYou = rows.count }
    }

    func startPolling() {
        guard !polling else { return }
        polling = true
        Task { [weak self] in
            while true {
                await self?.refreshBadge()
                try? await Task.sleep(nanoseconds: 60_000_000_000)
            }
        }
    }
}
