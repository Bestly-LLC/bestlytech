// Bestly Admin: data for the Today screen. Every card loads on its own and degrades to one line when it cannot.
import Foundation
import SwiftUI

struct StuckSummary: Equatable, Identifiable {
    var id: String { itemId }
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
    var steps: [String] = []   // what is blocked, one line each (for the detail sheet)
}

struct HealthIssue: Identifiable, Equatable {
    var id: Int
    var title: String
    var severity: String
    var employee: String
}

struct WallSummary: Equatable { var title: String; var line: String }

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
    @Published var issueList: [HealthIssue] = []
    @Published var wall: WallSummary?
    @Published var wallFailed = false
    @Published var hours: [HourTemp] = []
    @Published var nowTempF: Int?
    @Published var weatherFailed = false
    @Published var events: [DayEvent] = []
    @Published var eventsFailed = false
    @Published var loadedOnce = false
    @Published var fixing = false
    @Published var toast: String?
    @Published var deliveries: [DeliveryCard] = []
    @Published var deliveriesFailed = false

    private var loading = false

    func load() async {
        if loading { return }
        loading = true
        defer { loading = false; loadedOnce = true }
        async let a: Void = loadBundle()
        async let b: Void = loadStuck()
        async let c: Void = loadWeather()
        async let d: Void = loadEvents()
        async let e: Void = loadWall()
        async let f: Void = loadDeliveries()
        _ = await (a, b, c, d, e, f)
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
            issueList = issues.enumerated().map { i, j in
                HealthIssue(id: i, title: j.str("title") ?? j.str("label") ?? j.str("message") ?? "Something needs a look",
                            severity: (j.str("severity") ?? "").lowercased(),
                            employee: j.str("employee_name") ?? j.str("employee") ?? j.str("owner") ?? "Scout")
            }
            healthKnown = true
            ScreenWatch.ok("today")
        } catch {
            if (error as? URLError)?.code == .cancelled || error is CancellationError { return }
            ScreenWatch.failed("today") { [weak self] in await self?.load() }
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
                primary: fix?.str("primary") ?? "scout", actionId: act?.str("id"), actionStatus: act?.str("status"), actionNote: act?.str("note"),
                steps: blocks.compactMap { $0.str("label") })
        } catch {
            if (error as? URLError)?.code == .cancelled || error is CancellationError { return }
            stuckFailed = true
            await AdminAPI.report("today_load_failed", "stuck items: \(error.localizedDescription)")
        }
    }

    /// Same logic as the web Stuck card: fixable blocks -> admin_stuck_fix "all"; otherwise the primary button (retry or Scout).
    func runFix() async {
        guard let s = stuck, !fixing else { return }
        fixing = true
        defer { fixing = false }
        let itemId = s.itemId
        let ok = await Action.run("today.fix", idempotent: false,
                                  attempt: {
                                      if s.fixable {
                                          return try await AdminAPI.rpc("admin_stuck_fix", ["p_item_id": itemId, "p_action": "all"])
                                      }
                                      return try await AdminAPI.rpc("admin_stuck_run", ["p_item_id": itemId, "p_action": s.primary == "retry" ? "retry" : "scout"])
                                  },
                                  verify: {
                                      // Started when the item is gone, or an action row now exists for it.
                                      let items = ((try? await AdminAPI.rpc("admin_stuck_items")) as? [Any])?.compactMap { $0 as? JSON } ?? []
                                      guard let it = items.first(where: { $0.str("item_id") == itemId }) else { return true }
                                      return it.obj("action") != nil && s.actionId != it.obj("action")?.str("id") || it.obj("action")?.str("status") == "working"
                                  })
        guard ok else { return }
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

    // MARK: wall (one read, same RPC the Wall tab polls)

    private func loadWall() async {
        do {
            guard let d = try await AdminAPI.rpc("wall_admin_get") as? JSON else { throw AdminAPIError(status: 0, message: "unexpected shape") }
            let mode = d.obj("state")?.str("mode") ?? "auto"
            let word = WallModel.modes.first { $0.key == mode }?.word.capitalized ?? mode.capitalized
            let status = d.obj("status") ?? [:]
            let txt = status.str("status") ?? ""
            let pulled = WallClock.pgDate(d.str("pulled_at"))
            let line: String
            if d.obj("state")?.bool("away") == true { line = "Away mode" }
            else if pulled == nil || Date().timeIntervalSince(pulled!) > 90 { line = "Pi not checking in" }
            else if txt.hasPrefix("unreachable") { line = "Projector offline" }
            else if txt == "asleep" { line = "Projector asleep" }
            else if txt.hasPrefix("in use") { line = "Showing another app" }
            else if txt == "ok" { line = "On the wall now" }
            else { line = "Checking" }
            wall = WallSummary(title: "Wall \u{00B7} \(word)", line: line)
            wallFailed = false
        } catch {
            if (error as? URLError)?.code == .cancelled || error is CancellationError { return }
            wallFailed = true
            await AdminAPI.report("today_load_failed", "wall: \(error.localizedDescription)")
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
            if (error as? URLError)?.code == .cancelled || error is CancellationError { return }
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
            if (error as? URLError)?.code == .cancelled || error is CancellationError { return }
            eventsFailed = true
            await AdminAPI.report("today_load_failed", "calendar: \(error.localizedDescription)")
        }
    }
}

/// Where in-app links can go (Needs you rows, notifications, Today cards).
enum AdminRoute: Equatable {
    case turo, home, agents, wall, scout
    case safari(URL)
}

/// Screens pushed on More's navigation stack.
enum MoreDestination: Hashable { case turo, home, agents }

/// App-wide state: selected tab, More's navigation path, sheets.
@MainActor
final class AdminState: ObservableObject {
    static let shared = AdminState()
    @Published var tab = 0
    @Published var morePath: [MoreDestination] = []
    @Published var showAva = false
    @Published var showCompass = false

    func go(_ route: AdminRoute) {
        switch route {
        case .wall: tab = 3
        case .scout: tab = 2
        case .turo: tab = 4; morePath = [.turo]
        case .home: tab = 4; morePath = [.home]
        case .agents: tab = 4; morePath = [.agents]
        case .safari(let url): SafariLink.open(url)
        }
    }
}
