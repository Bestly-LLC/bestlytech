// Bestly Admin: Turo screen state. One car (Blue Steel). Reads are plain RPCs; climate keys go through Face ID,
// then the Mac mini helper does the work and we poll the job every 3 sec for up to 2 minutes.
import SwiftUI

enum TuroCmd: String {
    case cool, off, refresh
    var label: String { self == .cool ? "Cool it down" : (self == .off ? "A/C off" : "Read the car") }
    var failTitle: String { self == .cool ? "Couldn't cool it down" : (self == .off ? "Couldn't turn the A/C off" : "Couldn't read the car") }
}

enum TuroCmdState: Equatable {
    case idle
    case working(String)
    case ok(String)
    case failed(String)
}

struct TuroTrip {
    var stage: Int          // 0 none, 1 out, 3 within 3 hr of return, 4 back or ended
    var title: String
    var line: String
    var warn: String?
}

@MainActor
final class TuroModel: ObservableObject {
    @Published var widget: JSON?
    @Published var fleet: JSON?
    @Published var lax: JSON?
    @Published var cases: [JSON] = []
    @Published var cleaning: [JSON] = []
    @Published var claimsLoaded = false
    @Published var loadFailed = false
    @Published var loadedOnce = false
    @Published var cmd: TuroCmdState = .idle
    @Published var toast: String?

    private var busy = false

    // MARK: loading

    func load() async {
        async let w: Any? = try? await AdminAPI.rpc("turo_widget")
        async let f: Any? = try? await AdminAPI.rpc("tesla_fleet_admin_state")
        async let l: Any? = try? await AdminAPI.rpc("lax_pass_admin_state")
        async let c: Any? = try? await AdminAPI.rpc("claims_admin")
        async let cl: Any? = try? await AdminAPI.rpc("claims_cleaning_admin")
        let (wv, fv, lv, cv, clv) = await (w, f, l, c, cl)
        if let o = wv as? JSON { widget = o; loadFailed = false; ScreenWatch.ok("turo") } else if widget == nil { loadFailed = true; ScreenWatch.failed("turo") { [weak self] in await self?.load() } }
        if let o = fv as? JSON { fleet = o }
        if let o = lv as? JSON { lax = o }
        if let o = cv as? JSON {
            cases = o.arr("cases").map { $0.obj("case") ?? $0 }
            claimsLoaded = true
        }
        if clv != nil { cleaning = TKit.rows(clv) }
        loadedOnce = true
    }

    // MARK: car

    var battery: Int? { widget?.int("battery") }
    var rangeMi: Int? { widget?.int("range") }
    var observed: Date? { AdminFmt.date(widget?.str("observed_at")) }
    var stale: Bool { observed.map { Date().timeIntervalSince($0) > 7200 } ?? true }
    var locked: Bool? { widget?.bool("locked") }
    var pluggedIn: Bool {
        let s = (widget?.str("charging") ?? "Disconnected").lowercased()
        return !s.isEmpty && s != "disconnected"
    }
    var chargingNow: Bool { (widget?.str("charging") ?? "").lowercased() == "charging" }
    var insideF: Int? { fleet?.obj("car")?.int("inside_f") }
    var outsideF: Int? { fleet?.obj("car")?.int("outside_f") }
    var climateOn: Bool { fleet?.obj("car")?.bool("climate_on") ?? false }

    // MARK: trip

    var trip: TuroTrip {
        let now = Date()
        let cur = widget?.obj("current")
        let next = widget?.obj("next")
        var nextText = ""
        if let s = AdminFmt.date(next?.str("starts_at")) { nextText = "next trip \(TKit.dayLong.string(from: s))" }
        if let cur, let ends = AdminFmt.date(cur.str("ends_at")) {
            let guest = cur.str("guest") ?? "the guest"
            let ret = TKit.when(ends, now: now)
            let tail = nextText.isEmpty ? "" : " \u{00B7} " + nextText
            var warn: String?
            if let need = cur.int("return_pct"), need > 0, let b = battery, b < need {
                warn = "Needs \(need)% when it comes back. At \(b)% now."
            }
            if now > ends { return TuroTrip(stage: 4, title: "\(guest) is back", line: "Trip ended \(ret)" + tail, warn: warn) }
            if ends.timeIntervalSince(now) <= 3 * 3600 { return TuroTrip(stage: 3, title: "\(guest) is almost back", line: "Back by \(ret)" + tail, warn: warn) }
            return TuroTrip(stage: 1, title: "Out with \(guest)", line: "Back by \(ret)" + tail, warn: warn)
        }
        if let s = AdminFmt.date(next?.str("starts_at")) {
            return TuroTrip(stage: 0, title: "Nobody has the car", line: "Next trip \(TKit.when(s, now: now)) with \(next?.str("guest") ?? "a guest")", warn: nil)
        }
        return TuroTrip(stage: 0, title: "Nobody has the car", line: "No trip booked yet", warn: nil)
    }

    // MARK: LAX code

    var laxSlug: String? { lax?.str("slug") }
    var laxLive: Bool { lax?.obj("current")?.bool("is_this_month") ?? false }
    var laxMonthStart: String { lax?.str("month_now") ?? Self.firstOfMonth(Date()) }
    var laxMonthName: String { Self.monthName(laxMonthStart) }
    var laxNextMonthStart: String { Self.addMonth(laxMonthStart) }
    var laxLink: String? { laxSlug.map { "bestly.tech/lax/\($0)" } }

    static func firstOfMonth(_ d: Date) -> String {
        var c = Calendar(identifier: .gregorian); c.timeZone = AdminFmt.la
        let p = c.dateComponents([.year, .month], from: d)
        return String(format: "%04d-%02d-01", p.year ?? 2026, p.month ?? 1)
    }
    private static func parts(_ s: String) -> (Int, Int) {
        let p = s.prefix(10).split(separator: "-").compactMap { Int($0) }
        return (p.count > 1 ? p[0] : 2026, p.count > 1 ? p[1] : 1)
    }
    static func monthName(_ s: String) -> String {
        let (_, m) = parts(s)
        let names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
        return names[max(0, min(11, m - 1))]
    }
    static func addMonth(_ s: String) -> String {
        var (y, m) = parts(s)
        m += 1; if m > 12 { m = 1; y += 1 }
        return String(format: "%04d-%02d-01", y, m)
    }

    func saveCode(payload: String, month: String, note: String) async -> String? {
        guard await FaceIDGate.confirm(reason: "Save the LAX garage code") else { return "Face ID didn't match. The code was not saved." }
        let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let noteValue: Any = n.isEmpty ? (NSNull() as Any) : (n as Any)
        let ok = await Action.run("turo.lax_code", idempotent: false, okSay: "Code saved. Guests get it now.", attempt: {
            try await AdminAPI.rpc("lax_pass_set", ["p_payload": payload, "p_month": month, "p_note": noteValue])
        }, verify: {
            // the new code shows up in the saved list for that month
            guard let st = try? await AdminAPI.rpc("lax_pass_admin_state") as? JSON else { return false }
            let rows = st.arr("history") + (st.obj("current").map { [$0] } ?? [])
            return rows.contains { $0.str("payload") == payload && ($0.str("valid_month") ?? "").hasPrefix(String(month.prefix(7))) }
        })
        await load()
        return ok ? nil : "The code didn't save. Scout has it."
    }

    // MARK: claims

    var waitingOnGuest: Int { cases.filter { $0.str("status") == "waiting_guest" }.count }
    var paid: Int { cases.filter { $0.str("status") == "paid" }.count }
    var closed: Int { cases.filter { $0.str("status") == "closed" }.count }
    var cleaningOpen: Int {
        let done: Set<String> = ["clean", "skipped", "saved", "approved", "denied", "expired"]
        return cleaning.filter { r in
            guard let dl = AdminFmt.date(r.str("deadline")), dl > Date() else { return false }
            return !done.contains(r.str("status") ?? "")
        }.count
    }

    // MARK: climate keys

    func send(_ c: TuroCmd) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        Haptics.tap()
        guard await FaceIDGate.confirm(reason: "\(c.label) on Blue Steel") else {
            cmd = .failed("Face ID didn't match. Nothing was sent to the car.")
            Haptics.fail()
            return
        }
        cmd = .working("Sending \(c.label) to the car")
        Haptics.thunk()
        // One try only: a car command must never fire twice. The attempt includes waiting for the Mac mini helper's answer
        // (tesla_admin_job), so the job result is the effect check.
        let ok = await Action.run("turo.\(c.rawValue)", idempotent: false, attempt: { [self] in try await self.runCar(c) })
        if ok { await load() } else if case .working = cmd { cmd = .failed("\(c.failTitle). Scout has it.") }
    }

    private func fail(_ c: TuroCmd, _ why: String) -> AdminAPIError {
        cmd = .failed("\(c.failTitle). \(why)")
        return AdminAPIError(status: 0, message: why)
    }

    private func runCar(_ c: TuroCmd) async throws -> Any? {
        let r = try await AdminAPI.rpc("tesla_admin_command", ["p_action": c.rawValue]) as? JSON
        guard r?.bool("ok") != false, let id = r?.int("id") else {
            throw fail(c, r?.str("error") ?? "The car did not take the request.")
        }
        cmd = .working("\(c.label) sent. Waiting for the car")
        for _ in 0..<40 {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if Task.isCancelled { throw fail(c, "Cancelled.") }
            guard let job = try? await AdminAPI.rpc("tesla_admin_job", ["p_id": id]) as? JSON else { continue }
            let status = (job.str("status") ?? "").lowercased()
            let result = job.obj("result")
            if status == "failed" || (status == "done" && result?.bool("ok") == false) {
                throw fail(c, result?.str("error") ?? result?.str("msg") ?? "The car said no.")
            }
            if status == "done" {
                let msg = (result?.str("msg") ?? "").lowercased()
                if c == .refresh && msg == "car is asleep" {
                    cmd = .ok("The car is asleep, last reading shown")
                } else {
                    var via = ""
                    if let v = result?.str("via"), !v.isEmpty { via = ", via " + (v.lowercased() == "tezlab" ? "TezLab" : TKit.titleCase(v)) }
                    cmd = .ok("\(c.label): done\(via), \(TKit.clock(Date()))")
                }
                return ["ok": true]
            }
        }
        throw fail(c, "No answer after 2 minutes. The Mac mini helper may be offline.")
    }
}
