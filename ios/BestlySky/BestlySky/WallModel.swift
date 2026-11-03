// Bestly Admin: Wall model. Polls wall_admin_get every 5 s while the screen is visible, writes through wall_admin_set
// with optimistic updates and rollback. Never writes the internal state keys (see recon wall.md section 6).
import SwiftUI

struct WallFlash: Equatable {
    var big: String
    var sub: String
}

enum WallTone { case ok, idle, warn, bad }

struct WallLive {
    var title: String
    var sub: String
    var tone: WallTone
}

struct WallModeInfo {
    var key: String
    var word: String
    var desc: String
    var ch: Int
}

/// LA-time clock helpers (12-hour output only).
enum WallClock {
    static var cal: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = AdminFmt.la
        return c
    }

    static func minutes(_ hhmm: String?) -> Int? {
        guard let parts = hhmm?.split(separator: ":"), parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return h * 60 + m
    }

    static func hhmm(_ mins: Int) -> String {
        let v = ((mins % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", v / 60, v % 60)
    }

    /// "22:30" -> "10:30 PM" (number glued to AM/PM).
    static func label(_ hhmm: String) -> String {
        guard let m = minutes(hhmm) else { return hhmm }
        let h24 = m / 60
        let h12 = h24 % 12 == 0 ? 12 : h24 % 12
        return String(format: "%d:%02d", h12, m % 60) + "\u{00A0}" + (h24 < 12 ? "AM" : "PM")
    }

    static func next(_ hhmm: String, after: Date) -> Date? {
        guard let m = minutes(hhmm) else { return nil }
        return cal.nextDate(after: after, matching: DateComponents(hour: m / 60, minute: m % 60, second: 0), matchingPolicy: .nextTime)
    }

    static func nowMinutes(_ d: Date = Date()) -> Int {
        let c = cal.dateComponents([.hour, .minute], from: d)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }

    static func time(_ d: Date) -> String { glue(AdminFmt.time.string(from: d)) }

    static func pgDate(_ s: String?) -> Date? {
        guard var t = s, !t.isEmpty else { return nil }
        if let d = AdminFmt.date(t) { return d }
        t = t.replacingOccurrences(of: " ", with: "T")
        if t.range(of: "[+-][0-9]{2}$", options: .regularExpression) != nil { t += ":00" }
        if let d = AdminFmt.date(t) { return d }
        let noFrac = t.replacingOccurrences(of: "\\.[0-9]+", with: "", options: .regularExpression)
        return AdminFmt.date(noFrac)
    }
}

@MainActor
final class WallModel: ObservableObject {
    @Published private(set) var state: JSON = [:]
    @Published private(set) var status: JSON = [:]
    @Published private(set) var power: JSON = [:]
    @Published private(set) var pulledAt: Date?
    @Published private(set) var statusAt: Date?
    @Published private(set) var loaded = false
    @Published private(set) var loadError: String?
    @Published private(set) var pending = 0
    @Published private(set) var version = 0
    @Published private(set) var debouncing = false
    @Published private(set) var tick = Date()
    @Published var flash: WallFlash?

    static let widgetKeys: [String] = ["news", "turo$", "air", "energy", "mail", "habits", "leo", "appstore", "devices"]
    static let liveActKeys: [String] = ["plane", "sweep", "turo", "incident"]
    static let alertCatKeys: [String] = ["fire_medical", "police", "sheriff_city", "earthquake", "wildfire", "power", "closures", "transit", "weather", "traffic"]

    static let modes: [WallModeInfo] = [
        WallModeInfo(key: "auto", word: "AUTO", desc: "Board until 9:00 PM, then color. Sleeps midnight to 7:00 AM.", ch: 1),
        WallModeInfo(key: "board", word: "BOARD", desc: "Clock, one thing, Turo, home and Scout all day.", ch: 2),
        WallModeInfo(key: "ambient", word: "AMBIENT", desc: "Slow color wash with a small clock.", ch: 3),
        WallModeInfo(key: "demo", word: "DEMO", desc: "Sample wedding welcome on the wall.", ch: 4),
        WallModeInfo(key: "off", word: "BLACK", desc: "Projects nothing. The light stays on.", ch: 5)
    ]

    private var pollTask: Task<Void, Never>?
    private var flashTask: Task<Void, Never>?
    private var debounceTask: Task<Void, Never>?
    private var debounceBase: JSON = [:]
    private var debouncePatch: JSON = [:]
    private var lastWrite = Date.distantPast
    private var powerHint: (at: Date, on: Bool)?
    private var isVisible = false
    private var isActive = true

    // MARK: lifecycle

    func setVisible(_ v: Bool) { isVisible = v; reconcile() }
    func setActive(_ v: Bool) { isActive = v; reconcile() }

    private func reconcile() {
        if isVisible && isActive {
            guard pollTask == nil else { return }
            pollTask = Task { [weak self] in
                while !Task.isCancelled {
                    await self?.refresh()
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                }
            }
        } else {
            pollTask?.cancel()
            pollTask = nil
        }
    }

    func refresh() async {
        do {
            let r = try await AdminAPI.rpc("wall_admin_get")
            guard let d = r as? JSON else { return }
            status = d.obj("status") ?? [:]
            power = d.obj("power") ?? [:]
            version = d.int("version") ?? version
            pulledAt = WallClock.pgDate(d.str("pulled_at"))
            statusAt = WallClock.pgDate(d.str("status_at"))
            if pending == 0 && !debouncing && Date().timeIntervalSince(lastWrite) > 2.0 {
                state = d.obj("state") ?? state
            }
            loaded = true
            loadError = nil
            tick = Date()
        } catch {
            loadError = error.localizedDescription
            tick = Date()
            ScreenWatch.failed("wall")
        }
    }

    // MARK: state reads

    func flag(_ k: String, _ def: Bool = true) -> Bool { state.bool(k) ?? def }
    func text(_ k: String) -> String? { state.str(k) }
    func num(_ k: String) -> Double? { state.dbl(k) }
    func obj(_ k: String) -> JSON? { state.obj(k) }

    static func dndOverride(_ mode: String, _ until: Int) -> JSON {
        var o = JSON()
        o["mode"] = mode
        o["until"] = until
        return o
    }

    static func ledTest(_ fx: String) -> JSON {
        var o = JSON()
        o["fx"] = fx
        o["at"] = nowMs()
        return o
    }

    static func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

    var mode: String { state.str("mode") ?? "auto" }
    var volume: Int { state.int("volume") ?? 65 }
    var radiusMi: Int { state.int("airRadiusMi") ?? 15 }

    var piOnline: Bool {
        guard let p = pulledAt else { return false }
        return tick.timeIntervalSince(p) < 45
    }

    /// Power key logic: a tap in the last 90 s wins, else the reported projector status.
    var showsOff: Bool {
        if let h = powerHint, Date().timeIntervalSince(h.at) < 90 { return !h.on }
        return (status.str("status") ?? "") == "asleep"
    }

    /// True when the key should say "Turn on" (asleep or unreachable).
    var needsTurnOn: Bool {
        if let h = powerHint, Date().timeIntervalSince(h.at) < 90 { return !h.on }
        let t = status.str("status") ?? ""
        return t == "asleep" || t.hasPrefix("unreachable")
    }

    var syncLabel: String {
        if !loaded { return loadError == nil ? "Connecting" : "No connection" }
        if loadError != nil { return "No connection" }
        if !piOnline { return "Pi offline" }
        if pending > 0 || debouncing { return "Saving" }
        return "Synced"
    }

    enum SyncTone { case good, busy, bad }
    var syncTone: SyncTone {
        if !loaded { return loadError == nil ? .busy : .bad }
        if loadError != nil || !piOnline { return .bad }
        if pending > 0 || debouncing { return .busy }
        return .good
    }

    var modeInfo: WallModeInfo {
        WallModel.modes.first { $0.key == mode } ?? WallModeInfo(key: mode, word: mode.uppercased(), desc: "", ch: 0)
    }

    var projTempF: Int? {
        guard let c = status.dbl("cpu_c") else { return nil }
        return Int((c * 9 / 5 + 32).rounded())
    }

    func ago(_ d: Date) -> String {
        let s = max(0, Int(tick.timeIntervalSince(d)))
        if s < 90 { return "\(s)\u{00A0}sec ago" }
        let m = s / 60
        if m < 120 { return "\(m)\u{00A0}min ago" }
        return "\(m / 60)\u{00A0}hours ago"
    }

    /// "What the wall is doing now": first match wins (recon wall.md section 4).
    var live: WallLive {
        let txt = status.str("status") ?? ""
        if !loaded {
            return WallLive(title: loadError == nil ? "CONNECTING" : "NO CONNECTION",
                            sub: loadError == nil ? "Asking the Pi what the wall is doing." : "Can't reach Bestly right now. Retrying.",
                            tone: loadError == nil ? .idle : .bad)
        }
        if flag("away", false) { return WallLive(title: "AWAY MODE", sub: "Pi leaves projector alone.", tone: .idle) }
        if !piOnline {
            let seen = pulledAt.map { "Last seen \(ago($0))." } ?? "Not seen yet."
            return WallLive(title: "PI NOT CHECKING IN", sub: seen, tone: .bad)
        }
        if txt.hasPrefix("unreachable") { return WallLive(title: "PROJECTOR OFFLINE", sub: "Can't reach the projector (\(txt)).", tone: .bad) }
        if txt == "asleep" { return WallLive(title: "PROJECTOR ASLEEP", sub: "Wakes at 7:00 AM.", tone: .idle) }
        if txt.hasPrefix("in use") {
            let app = txt.replacingOccurrences(of: "in use: ", with: "").replacingOccurrences(of: "in use", with: "")
            return WallLive(title: "SHOWING ANOTHER APP", sub: app.isEmpty ? "The projector is busy with something else." : app, tone: .warn)
        }
        let statusAge = statusAt.map { tick.timeIntervalSince($0) } ?? 0
        if statusAge > 150 { return WallLive(title: "CAN'T CONFIRM THE WALL", sub: "The Pi last reported \(statusAt.map { ago($0) } ?? "a while ago").", tone: .warn) }
        if txt == "ok" {
            let beat = (status.dbl("heartbeat_age_s") ?? 0) + statusAge
            if beat >= 120 { return WallLive(title: "WALL ISN'T SHOWING", sub: "The wall page stopped responding.", tone: .bad) }
            if status.str("page_mode") == "off" { return WallLive(title: "WALL IS DARK", sub: "Black mode. The light stays on.", tone: .idle) }
            let dark = status.int("dark_30m") ?? 0
            let last = status.obj("last_dark")
            var lastAt: Date?
            if let t = last?.dbl("at") { lastAt = Date(timeIntervalSince1970: t > 1e11 ? t / 1000 : t) }
            let why = last?.str("why") ?? "unknown"
            if dark >= 2 {
                let when = lastAt.map { WallClock.time($0) } ?? "just now"
                return WallLive(title: "KEEPS GOING DARK", sub: "Dark \(dark) times in 30\u{00A0}min. Last at \(when) (\(why)).", tone: .warn)
            }
            var sub = "Showing now"
            if let f = projTempF { sub += " \u{00B7} projector \(f)\u{00B0}F" }
            if let a = lastAt, tick.timeIntervalSince(a) < 1800, tick.timeIntervalSince(a) >= 0 {
                sub += ". Went dark at \(WallClock.time(a)) (\(why)), back on its own."
            }
            return WallLive(title: "ON THE WALL", sub: sub, tone: .ok)
        }
        return WallLive(title: "CHECKING", sub: "Waiting for the next report from the Pi.", tone: .idle)
    }

    /// Extra "playing" line: radio or AirPlay.
    var playing: String? {
        if let r = state.obj("radio"), r.bool("on") == true, let n = r.str("name"), !n.isEmpty {
            let title = n.components(separatedBy: " - ").first ?? n
            return "RADIO \u{00B7} " + title.uppercased()
        }
        if let a = status.obj("airplay"), a.bool("casting") == true, flag("airplay", true) {
            let kind = (a.str("kind") ?? "").lowercased()
            return kind == "audio" ? "AIRPLAY AUDIO" : "AIRPLAY VIDEO"
        }
        return nil
    }

    var quietText: String {
        let now = Date()
        let nowMs = Double(WallModel.nowMs())
        let d = state.obj("dnd")
        if let o = d?.obj("override"), let until = o.dbl("until"), until > nowMs {
            let t = WallClock.time(Date(timeIntervalSince1970: until / 1000))
            return o.str("mode") == "on" ? "QUIET UNTIL \(t)" : "SOUNDS ALLOWED UNTIL \(t)"
        }
        guard d?.bool("on") == true else { return "SOUNDS ALLOWED" }
        let from = d?.str("from") ?? "22:30"
        let to = d?.str("to") ?? "07:00"
        if let f = WallClock.minutes(from), let t = WallClock.minutes(to) {
            let n = WallClock.nowMinutes(now)
            let inside = f < t ? (n >= f && n < t) : (n >= f || n < t)
            if inside { return "QUIET UNTIL \(WallClock.label(to))" }
        }
        return "QUIET FROM \(WallClock.label(from))"
    }

    // MARK: flash

    func say(_ big: String, _ sub: String = "") {
        flash = WallFlash(big: big, sub: sub)
        flashTask?.cancel()
        flashTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            guard !Task.isCancelled else { return }
            self?.flash = nil
        }
    }

    /// "BIG|sub" shorthand used by the remote keys.
    func say(pair: String) {
        let parts = pair.components(separatedBy: "|")
        say(parts.first ?? "", parts.count > 1 ? parts[1] : "")
    }

    // MARK: writes

    /// Stable Action id for a patch: "wall.<first key>" (plus "+" when several keys go together).
    static func actionID(_ patch: JSON) -> String {
        let keys = patch.keys.sorted()
        return "wall." + (keys.first ?? "set") + (keys.count > 1 ? "+" : "")
    }

    /// Optimistic top-level merge, then wall_admin_set through Action.run. Reads wall_admin_get back to confirm the
    /// server kept every key (the cleaners drop what they do not accept without an error). Rolls back on failure.
    func setPatch(_ patch: JSON, say msg: String? = nil, id: String? = nil) {
        var rollback = JSON()
        for (k, v) in patch {
            rollback[k] = state[k] ?? NSNull()
            state[k] = v
        }
        if let m = msg { say(pair: m) }
        send(patch, rollback: rollback, id: id ?? WallModel.actionID(patch))
    }

    /// Slider-style writes: local value moves now, one save 400 ms after the last change.
    func setDebounced(_ patch: JSON) {
        for (k, v) in patch {
            if debounceBase[k] == nil { debounceBase[k] = state[k] ?? NSNull() }
            debouncePatch[k] = v
            state[k] = v
        }
        debouncing = true
        lastWrite = Date()
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            self?.flushDebounce()
        }
    }

    private func flushDebounce() {
        let patch = debouncePatch
        let base = debounceBase
        debouncePatch = [:]
        debounceBase = [:]
        debouncing = false
        guard !patch.isEmpty else { return }
        send(patch, rollback: base, id: WallModel.actionID(patch))
    }

    /// Put back the old value of a key, unless a newer tap already changed it again.
    private func restore(_ rollback: JSON, only patch: JSON) {
        for (k, v) in rollback {
            if let want = patch[k], !WallVerify.matches(want, state[k]) { continue }
            if v is NSNull { state.removeValue(forKey: k) } else { state[k] = v }
        }
    }

    /// Re-reads the wall and checks every key of the patch. A key a newer tap already replaced locally counts as done.
    private func verifyPatch(_ patch: JSON) async -> Bool {
        guard let d = await WallAPI.get(), let st = d.obj("state") else { return false }
        for (k, v) in patch {
            if !WallVerify.matches(v, state[k]) { continue }
            if !WallVerify.matches(v, st[k]) { return false }
        }
        return true
    }

    private func send(_ patch: JSON, rollback: JSON, id: String) {
        Task { [self] in _ = await sendAsync(patch, rollback: rollback, id: id) }
    }

    /// Same as setPatch but waits for the answer, for sheets that stay open until the wall confirms.
    func savePatch(_ patch: JSON, say msg: String? = nil, id: String? = nil) async -> Bool {
        var rollback = JSON()
        for (k, v) in patch {
            rollback[k] = state[k] ?? NSNull()
            state[k] = v
        }
        if let m = msg { say(pair: m) }
        return await sendAsync(patch, rollback: rollback, id: id ?? WallModel.actionID(patch))
    }

    private func sendAsync(_ patch: JSON, rollback: JSON, id: String) async -> Bool {
        pending += 1
        lastWrite = Date()
        var echoed: JSON?
        let ok = await Action.run(id, attempt: {
            let r = try await AdminAPI.rpc("wall_admin_set", ["p_patch": patch])
            echoed = (r as? JSON)?.obj("state")
            return r
        }, verify: { [self] in await verifyPatch(patch) })
        pending = max(0, pending - 1)
        lastWrite = Date()
        if ok {
            if pending == 0, !debouncing, let st = echoed { state = st }
        } else {
            restore(rollback, only: patch)
            say("DIDN'T SAVE", "The wall didn't take that change.")
            lastWrite = .distantPast
            if pending == 0 { await refresh() }
        }
        return ok
    }

    func togglePower() {
        let goOn = needsTurnOn
        powerHint = (Date(), goOn)
        Haptics.thunk()
        say(goOn ? "POWER ON" : "POWER OFF", goOn ? "On. Stays on until midnight." : "Off until 7:00 AM, or until you press Power.")
        objectWillChange.send()
        pending += 1
        Task { [self] in
            var sent: JSON?
            let ok = await Action.run("wall.power", attempt: {
                let r = try await AdminAPI.rpc("wall_admin_power", ["p_on": goOn])
                sent = r as? JSON
                return r
            }, verify: {
                guard let d = await WallAPI.get(), let p = d.obj("power") else { return false }
                let seq = p.int("seq") ?? 0
                let want = sent?.int("seq") ?? 0
                return seq >= want && (seq > want || p.bool("on") == goOn)
            })
            pending = max(0, pending - 1)
            if ok { if let p = sent { power = p } } else { powerHint = nil; objectWillChange.send() }
        }
    }

    /// focus, focus_left, focus_right, relaunch, airplay_restart. Never retried: a second nudge would move the focus twice.
    func command(_ cmd: String, say msg: String) {
        say(pair: msg)
        pending += 1
        Task { [self] in
            var sent: JSON?
            let ok = await Action.run("wall.\(cmd)", idempotent: false, attempt: {
                let r = try await AdminAPI.rpc("wall_admin_command", ["p_cmd": cmd])
                sent = r as? JSON
                return r
            }, verify: {
                guard let d = await WallAPI.get(), let p = d.obj("power") else { return false }
                let seq = p.int("seq") ?? 0
                let want = sent?.int("seq") ?? 0
                return seq >= want && (seq > want || p.str("cmd") == cmd)
            })
            pending = max(0, pending - 1)
            if ok, let p = sent { power = p }
        }
    }

    func geometry(redo: Bool) {
        pending += 1
        Task { [self] in
            var sent: JSON?
            var nothing: String?
            let ok = await Action.run(redo ? "wall.geometry_redo" : "wall.geometry_undo", idempotent: false, attempt: {
                let r = try await AdminAPI.rpc(redo ? "wall_geometry_redo" : "wall_geometry_undo")
                let d = r as? JSON
                if d?.bool("ok") == false {
                    nothing = d?.str("error") ?? "Nothing to change."
                    return ["ok": true] as JSON        // a normal answer, not a failure
                }
                sent = d
                return r
            }, verify: {
                if nothing != nil { return true }
                guard let d = await WallAPI.get() else { return false }
                return (d.int("version") ?? 0) >= (sent?.int("version") ?? 0)
            })
            pending = max(0, pending - 1)
            if let n = nothing {
                Haptics.nope()
                say(redo ? "NOTHING TO REDO" : "NOTHING TO UNDO", n)
            } else if ok {
                say(redo ? "REDONE" : "UNDONE", redo ? "Wall layout stepped forward." : "Wall layout went back one step.")
                lastWrite = .distantPast
                await refresh()
            }
        }
    }

    // MARK: whole-object writes

    func updateObject(_ key: String, defaults: JSON, extra: JSON = [:], say msg: String? = nil, _ mutate: (inout JSON) -> Void) {
        var o = state.obj(key) ?? defaults
        for (k, v) in defaults where o[k] == nil { o[k] = v }
        mutate(&o)
        var patch: JSON = [key: o]
        for (k, v) in extra { patch[k] = v }
        setPatch(patch, say: msg)
    }

    func setDnd(say msg: String? = nil, _ mutate: (inout JSON) -> Void) {
        updateObject("dnd", defaults: ["on": false, "from": "22:30", "to": "07:00"], say: msg, mutate)
    }

    func setAlarm(say msg: String? = nil, _ mutate: (inout JSON) -> Void) {
        updateObject("alarm", defaults: ["on": false, "time": "07:00", "days": "weekdays", "vol": 60], say: msg) { a in
            mutate(&a)
            a["set_at"] = WallModel.nowMs()
        }
    }

    func setLed(extra: JSON = [:], say msg: String? = nil, _ mutate: (inout JSON) -> Void) {
        updateObject("ledSign", defaults: ["on": false, "look": "lit", "color": "#F4EEFF", "notify": true, "shield": true, "outline": false], extra: extra, say: msg, mutate)
    }

    func setVoice(say msg: String? = nil, _ mutate: (inout JSON) -> Void) {
        updateObject("voice", defaults: ["on": true, "sensitivity": "normal"], say: msg, mutate)
    }

    func setMap(_ key: String, keys: [String], id: String, on: Bool) {
        let cur = state.obj(key) ?? [:]
        var w = cur
        for k in keys { w[k] = cur.bool(k) ?? true }
        w[id] = on
        setPatch([key: w])
    }

    func mapFlag(_ key: String, _ id: String) -> Bool { state.obj(key)?.bool(id) ?? true }

    // MARK: quick keys

    func alarmSummary() -> String {
        let a = state.obj("alarm")
        let days = a?.str("days") ?? "weekdays"
        let label: String
        switch days {
        case "once": label = "Once"
        case "weekends": label = "Weekends"
        case "daily": label = "Daily"
        default: label = "Weekdays"
        }
        return "\(label) at \(WallClock.label(a?.str("time") ?? "07:00"))."
    }

    func togglePlanes() {
        let on = !flag("airShow", true)
        setPatch(["airShow": on], say: on ? "PLANES ON|Planes overhead are back on the sky." : "PLANES OFF|Sky shows no planes.")
    }

    func toggleNeon() {
        let on = !(state.obj("ledSign")?.bool("on") ?? false)
        setLed(say: on ? "NEON ON|Sign wall glow is on." : "NEON OFF|Sign wall glow is off.") { $0["on"] = on }
    }

    /// Returns false when there is no station chosen yet (the caller opens the station finder).
    func toggleRadio() -> Bool {
        let r = state.obj("radio")
        let on = r?.bool("on") ?? false
        let url = r?.str("url") ?? ""
        if on, var cur = r {
            cur["on"] = false
            cur["ts"] = WallModel.nowMs()
            setPatch(["radio": cur], say: "RADIO OFF|Radio stopped.")
            return true
        }
        guard !url.isEmpty, var cur = r else { return false }
        cur["on"] = true
        cur["ts"] = WallModel.nowMs()
        let name = (cur.str("name") ?? "Radio").components(separatedBy: " - ").first ?? "Radio"
        setPatch(["radio": cur, "atc": false], say: "RADIO|\(name) on the Desk HomePod.")
        return true
    }

    func playStation(name: String, url: String, favicon: String) {
        // The server drops a station whose address has spaces or is over 500 characters, with no error.
        guard url.count <= 500, url.range(of: "^https?://[^\\s\"<>]{3,}$", options: .regularExpression) != nil else {
            Haptics.nope()
            say("CAN'T PLAY THAT", "That station's address won't work on the wall. Pick another.")
            return
        }
        let favicon = (favicon.count <= 500 && favicon.range(of: "^https?://[^\\s\"<>]{3,}$", options: .regularExpression) != nil) ? favicon : ""
        let r: JSON = ["on": true, "name": String(name.prefix(60)), "url": url, "favicon": favicon, "ts": WallModel.nowMs()]
        setPatch(["radio": r, "atc": false], say: "RADIO|\(name.components(separatedBy: " - ").first ?? name) on the Desk HomePod.")
    }

    func toggleTower() {
        let on = !flag("atc", false)
        var patch: JSON = ["atc": on]
        if on, var r = state.obj("radio") {
            r["on"] = false
            r["ts"] = WallModel.nowMs()
            patch["radio"] = r
        }
        setPatch(patch, say: on ? "LAX TOWER|Live tower audio on the HomePod." : "TOWER OFF|Tower audio stopped.")
    }

    func toggleAlarm() {
        let on = !(state.obj("alarm")?.bool("on") ?? false)
        setAlarm { $0["on"] = on }
        say(pair: on ? "ALARM ON|\(alarmSummary())" : "ALARM OFF|No wake-up alarm.")
    }

    func nudgeHome(dx: Double, dy: Double, label: String, text: String) {
        let hp = state.obj("homePos")
        let x = hp?.dbl("x") ?? 0.5
        let y = hp?.dbl("y") ?? 0.5
        func clamp(_ v: Double) -> Double { (min(1, max(0, v)) * 1000).rounded() / 1000 }
        setPatch(["homePos": ["x": clamp(x + dx), "y": clamp(y + dy)]], say: "\(label)|\(text)")
    }

    func centerHome() {
        setPatch(["homePos": NSNull()], say: "HOME MID|Home is back in the middle.")
    }

    func quiet(for mode: String) {
        let until = WallModel.nowMs() + 3_600_000
        let t = WallClock.time(Date(timeIntervalSince1970: Double(until) / 1000))
        setDnd(say: mode == "on" ? "QUIET|Quiet for 1\u{00A0}hour, until \(t)." : "SOUNDS ON|Sounds allowed until \(t).") {
            $0["override"] = WallModel.dndOverride(mode, until)
        }
    }
}

// MARK: read-back helpers

enum WallAPI {
    /// wall_admin_get, or nil when the call fails.
    static func get() async -> JSON? {
        guard let r = try? await AdminAPI.rpc("wall_admin_get") else { return nil }
        return r as? JSON
    }
}

enum WallVerify {
    private static let ledFx: Set<String> = ["sign", "turo", "scout", "alert", "hello"]

    /// True when `got` (what the server kept) carries everything in `want` (what we sent).
    /// Null matches null or a missing key; numbers match within 0.001; a patch object only has to be contained.
    static func matches(_ want: Any, _ got: Any?) -> Bool {
        if want is NSNull { return got == nil || got is NSNull }
        guard let got, !(got is NSNull) else { return false }
        if let w = want as? String { return (got as? String) == w }
        if let w = want as? JSON {
            guard let g = got as? JSON else { return false }
            for (k, v) in w {
                if k == "favicon", let s = v as? String, s.isEmpty { continue }       // the server stores an empty icon as null
                if k == "test", let t = v as? JSON, let fx = t["fx"] as? String, !ledFx.contains(fx) { continue }
                if !matches(v, g[k]) { return false }
            }
            return true
        }
        if let w = want as? [Any] {
            guard let g = got as? [Any], g.count == w.count else { return false }
            for i in w.indices where !matches(w[i], g[i]) { return false }
            return true
        }
        if let w = want as? NSNumber, let g = got as? NSNumber {
            let wb = CFGetTypeID(w) == CFBooleanGetTypeID()
            let gb = CFGetTypeID(g) == CFBooleanGetTypeID()
            if wb || gb { return w.boolValue == g.boolValue }
            return abs(w.doubleValue - g.doubleValue) <= 0.001
        }
        return false
    }
}
