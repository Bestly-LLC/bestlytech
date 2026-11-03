// Bestly Admin: the Wall door. 16 switch banks, one open at a time (matches WallBanks design).
import SwiftUI

// MARK: block types

struct BKToggle {
    var label: String
    var on: Bool
    var needs: String?
    var blocked: Bool
    var sub: String? = nil   // SKYBUSES_20261103: one-line plain explanation under the label
    var tap: () -> Void
}

struct BKOption {
    var label: String
    var swatch: Color?
    var on: Bool
    var tap: () -> Void
}

struct BKSeg {
    var label: String
    var cols: Int
    var opts: [BKOption]
}

struct BKStep {
    var label: String
    var value: String
    var minus: () -> Void
    var plus: () -> Void
    var minusLabel: String
    var plusLabel: String
}

struct BKAct {
    var label: String
    var sub: String?
    var red: Bool = false
    var dim: Bool = false
    var hold: Bool = false
    var tap: () -> Void
}

enum BKBlock {
    case readout([String])
    case toggles([BKToggle])
    case seg(BKSeg)
    case step(BKStep)
    case acts([BKAct], cols: Int)
}

struct BKBank {
    var id: String
    var label: String
    var title: String
    var note: String
    var blocks: [BKBlock]
}

// MARK: door

struct WallDoor: View {
    @ObservedObject var model: WallModel
    @Binding var open: String?
    @Binding var sheet: WallSheet?
    @Binding var editor: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let ids: [(String, String)] = [
        ("sky", "SKY"), ("flights", "FLIGHTS"), ("stars", "STARS"), ("alerts", "LOCAL"), ("buses", "BUSES"),
        ("sound", "SOUND"), ("voice", "VOICE"), ("radio", "RADIO"), ("display", "DISPLAY"),
        ("strip", "STRIP"), ("alarm", "ALARM"), ("live", "PHONE"), ("neon", "NEON"),
        ("sign", "SIGN"), ("proj", "PROJ"), ("align", "ALIGN"), ("tests", "TESTS")
    ]

    private let columns: [GridItem] = Array(repeating: GridItem(.flexible(), spacing: 9), count: 4)

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                WEng(text: "The door \u{00B7} \(WallDoor.ids.count) banks").multilineTextAlignment(.leading)
                Text("Press a bank to flip it open. Every switch on the web Wall page lives in one of these.")
                    .font(.system(size: 13))
                    .foregroundStyle(AT.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 8)

            LazyVGrid(columns: columns, spacing: 9) {
                ForEach(WallDoor.ids, id: \.0) { item in selectorKey(id: item.0, label: item.1) }
            }

            if let id = open, let bank = makeBank(id) {
                BankPanel(bank: bank)
                    .id(id)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
                    .screenView("wall_bank_\(id)")
            }

            Text("BESTLY")
                .font(.system(size: 15, weight: .heavy))
                .tracking(6)
                .foregroundStyle(AT.hex(0x121216))
                .shadow(color: Color.white.opacity(0.07), radius: 0, y: 1)
                .frame(maxWidth: .infinity)
                .padding(.top, 6)
                .accessibilityHidden(true)
        }
        .padding(.top, 34)
        .padding(.bottom, 36)
        .padding(.horizontal, 22)
        .frame(maxWidth: 340)
        .background { doorBody }
        .mask {
            VStack(spacing: 0) {
                LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: 40)
                Rectangle()
            }
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
        .padding(.top, 2)
    }

    private var doorBody: some View {
        let shape = UnevenRoundedRectangle(cornerRadii: RectangleCornerRadii(topLeading: 0, bottomLeading: 58, bottomTrailing: 58, topTrailing: 0), style: .continuous)
        return shape
            .fill(LinearGradient(colors: [WallInk.bodyMid, WallInk.bodyBottom], startPoint: .top, endPoint: .bottom))
            .shadow(color: .black.opacity(0.7), radius: 30, x: 0, y: 24)
    }

    private func selectorKey(id: String, label: String) -> some View {
        let on = open == id
        return Button {
            Haptics.select()
            let change = { open = on ? nil : id }
            if reduceMotion { change() } else { withAnimation(.easeOut(duration: 0.22)) { change() } }
        } label: {
            Text(label)
                .font(.system(size: 11, weight: .heavy))
                .tracking(0.5)
                .fixedSize()
                .frame(maxWidth: .infinity, minHeight: 48)
        }
        .buttonStyle(RemoteKey(face: on ? .selected : .normal))
        .accessibilityLabel("Bank \(label.lowercased())" + (on ? ", open" : ""))
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: bank builders

    private func tg(_ key: String, _ label: String, def: Bool = true, needs: (String, String)? = nil, note: String? = nil) -> BKToggle {
        let on = model.flag(key, def)
        let blocked = needs.map { !model.flag($0.0, true) } ?? false
        return BKToggle(label: label, on: on, needs: needs.map { "Needs \($0.1)" }, blocked: blocked) {
            if blocked { Haptics.nope(); return }
            model.setPatch([key: !on])
        }
    }

    private func sg(_ key: String, _ label: String, cols: Int, def: String?, _ opts: [(String, String?)]) -> BKSeg {
        let cur: String? = model.text(key) ?? def
        var out: [BKOption] = []
        for o in opts {
            let on = (cur ?? "") == (o.1 ?? "")
            out.append(BKOption(label: o.0, swatch: nil, on: on) {
                Haptics.select()
                if let v = o.1 { model.setPatch([key: v]) } else { model.setPatch([key: NSNull()]) }
            })
        }
        return BKSeg(label: label, cols: cols, opts: out)
    }

    private func act(_ label: String, _ sub: String? = nil, red: Bool = false, dim: Bool = false, _ tap: @escaping () -> Void) -> BKAct {
        BKAct(label: label, sub: sub, red: red, dim: dim, tap: {
            if dim { Haptics.nope(); return }
            tap()
        })
    }

    private func mapToggle(_ key: String, _ id: String, _ label: String, needs: (String, String)? = nil) -> BKToggle {
        let on = model.mapFlag(key, id)
        let blocked = needs.map { !model.mapFlag(key, $0.0) } ?? false
        let keys: [String]
        switch key {
        case "widgets": keys = WallModel.widgetKeys
        case "liveActs": keys = WallModel.liveActKeys
        default: keys = WallModel.alertCatKeys
        }
        return BKToggle(label: label, on: on, needs: nil, blocked: blocked) {
            if blocked { Haptics.nope(); return }
            model.setMap(key, keys: keys, id: id, on: !on)
        }
    }

    private func makeBank(_ id: String) -> BKBank? {
        switch id {
        case "sky": return skyBank()
        case "flights": return flightsBank()
        case "stars": return starsBank()
        case "alerts": return alertsBank()
        case "buses": return busesBank()
        case "sound": return soundBank()
        case "voice": return voiceBank()
        case "radio": return radioBank()
        case "display": return displayBank()
        case "strip": return stripBank()
        case "alarm": return alarmBank()
        case "live": return liveBank()
        case "neon": return neonBank()
        case "sign": return signBank()
        case "proj": return projBank()
        case "align": return alignBank()
        case "tests": return testsBank()
        default: return nil
        }
    }

    private func skyBank() -> BKBank {
        let planes = ("airShow", "Planes")
        var t: [BKToggle] = []
        t.append(tg("airShow", "Planes overhead"))
        t.append(tg("skyOverscan", "Fill whole ceiling", def: false, needs: planes))
        let atcOn = model.flag("atc", false)
        t.append(BKToggle(label: "LAX tower on the HomePod", on: atcOn, needs: nil, blocked: false) { model.toggleTower() })
        t.append(tg("skyHome", "Home marker", needs: planes))
        t.append(tg("skyLandmarks", "Landmarks", needs: planes))
        t.append(tg("skyRoads", "Roads", needs: planes))
        t.append(tg("skyTraffic", "Live traffic", needs: planes))
        t.append(tg("skyCars", "Cars", needs: planes))
        let carsBlocked = !model.flag("airShow", true) || !model.flag("skyCars", true)
        let labelsOn = model.flag("skyCarLabels", true)
        t.append(BKToggle(label: "Car names", on: labelsOn, needs: model.flag("airShow", true) ? "Needs Cars" : "Needs Planes", blocked: carsBlocked) {
            if carsBlocked { Haptics.nope(); return }
            model.setPatch(["skyCarLabels": !labelsOn])
        })
        let terrain = sg("skyTerrain", "Terrain", cols: 4, def: "teal", [("Off", "off"), ("Teal", "teal"), ("Sand", "sand"), ("Indigo", "indigo")])
        return BKBank(id: "sky", label: "SKY", title: "Sky on the ceiling",
                      note: "Radius is on the SKY rocker up top. Other sky switches dim while Planes is off.",
                      blocks: [.toggles(t), .seg(terrain)])
    }

    private func flightsBank() -> BKBank {
        let card = ("airCard", "the card")
        let labels = ("airLabels", "labels")
        var t: [BKToggle] = []
        t.append(tg("airCard", "Nearest-plane card"))
        t.append(tg("airCardPin", "Keep the card up", def: false, needs: card))
        t.append(tg("airCardHeli", "Helicopters in the card", needs: card))
        t.append(tg("airLabels", "Plane labels"))
        t.append(tg("airLabelsSmall", "Tags on small planes", needs: labels))
        t.append(tg("airKey", "Sky key", def: false))
        t.append(tg("issTag", "Space Station name"))
        return BKBank(id: "flights", label: "FLIGHTS", title: "Flights", note: "What the plane layer shows.", blocks: [.toggles(t)])
    }

    private func starsBank() -> BKBank {
        let stars = ("skyStars", "Stars")
        var t: [BKToggle] = []
        t.append(tg("skyStars", "Stars"))
        t.append(tg("skyStarLabels", "Star names", needs: stars))
        t.append(tg("skyGrid", "Sky grid", needs: stars))
        t.append(tg("skyMoon", "Moon"))
        t.append(tg("skySun", "Sun"))
        t.append(tg("skyPlanets", "Planets"))
        return BKBank(id: "stars", label: "STARS", title: "Stars, sun and moon", note: "The night sky layer.", blocks: [.toggles(t)])
    }

    private func alertsBank() -> BKBank {
        let master = model.flag("skyAlerts", true)
        let cats: [(String, String)] = [
            ("fire_medical", "Fire and medical"), ("police", "Police"), ("sheriff_city", "Sheriff"), ("earthquake", "Earthquakes"),
            ("wildfire", "Wildfire"), ("power", "Power outages"), ("closures", "Road closures"), ("transit", "Transit"),
            ("weather", "Weather"), ("traffic", "Traffic")
        ]
        var t: [BKToggle] = []
        t.append(tg("skyAlerts", "Local alerts"))
        for c in cats {
            let on = model.mapFlag("alertCats", c.0)
            t.append(BKToggle(label: c.1, on: on, needs: "Needs Local alerts", blocked: !master) {
                if !master { Haptics.nope(); return }
                model.setMap("alertCats", keys: WallModel.alertCatKeys, id: c.0, on: !on)
            })
        }
        return BKBank(id: "alerts", label: "LOCAL", title: "Local alerts on the sky",
                      note: "Which kinds of nearby alerts get drawn.", blocks: [.toggles(t)])
    }

    /// SKYBUSES_20261103: Buses on the sky (state.skyBuses, missing = on) and Mae's leave-now push (state.busPush, missing = on).
    /// Both go through model.setPatch -> Action.run (retry, wall_admin_get verify, rollback, toast, report).
    private func busesBank() -> BKBank {
        func bt(_ key: String, _ label: String, _ sub: String) -> BKToggle {
            let on = model.flag(key, true)
            return BKToggle(label: label, on: on, needs: nil, blocked: false, sub: sub) {
                model.setPatch([key: !on])
            }
        }
        let t = [
            bt("skyBuses", "Buses on the sky", "Bus pills, stops and walk path on the sky map"),
            bt("busPush", "Leave-now alerts", "Mae pings your iPhone when it's time to walk to the bus")
        ]
        return BKBank(id: "buses", label: "BUSES", title: "Buses", note: "Bus info on the sky map and the leave-now ping.", blocks: [.toggles(t)])
    }

    private func soundBank() -> BKBank {
        let dnd = model.obj("dnd")
        let dndOn = dnd?.bool("on") ?? false
        let from = dnd?.str("from") ?? "22:30"
        let to = dnd?.str("to") ?? "07:00"
        var t: [BKToggle] = []
        t.append(tg("sound", "Wall sounds"))
        t.append(BKToggle(label: "Quiet hours on a schedule", on: dndOn, needs: nil, blocked: false) {
            model.setDnd { d in
                d["on"] = !dndOn
                d["override"] = NSNull()
            }
        })
        let style = sg("soundPack", "Sound style", cols: 3, def: "glass", [("Glass", "glass"), ("Marimba", "marimba"), ("Keys", "keys")])
        func stepper(_ label: String, _ key: String, _ cur: String) -> BKStep {
            let m = WallClock.minutes(cur) ?? 0
            return BKStep(label: label, value: WallClock.label(cur),
                          minus: { Haptics.select(); model.setDnd { $0[key] = WallClock.hhmm(m - 15) } },
                          plus: { Haptics.select(); model.setDnd { $0[key] = WallClock.hhmm(m + 15) } },
                          minusLabel: "\(label), 15 minutes earlier", plusLabel: "\(label), 15 minutes later")
        }
        var acts: [BKAct] = []
        acts.append(act("Play a sample") { model.setPatch(["soundTest": WallModel.nowMs()], say: "SAMPLE|Playing a sample sound.") })
        acts.append(act("Quiet until \(WallClock.label(to))") {
            let until = WallClock.next(to, after: Date()) ?? Date().addingTimeInterval(3600)
            let ms = Int(until.timeIntervalSince1970 * 1000)
            model.setDnd(say: "QUIET|Quiet until \(WallClock.label(to)).") { $0["override"] = WallModel.dndOverride("on", ms) }
        })
        acts.append(act("Allow until morning") {
            let until = WallClock.next(to, after: Date()) ?? Date().addingTimeInterval(3600)
            let ms = Int(until.timeIntervalSince1970 * 1000)
            model.setDnd(say: "SOUNDS ON|Sounds allowed until \(WallClock.label(to)).") { $0["override"] = WallModel.dndOverride("off", ms) }
        })
        acts.append(act("Allow tonight", "past \(WallClock.label(from))") {
            let start = WallClock.next(from, after: Date()) ?? Date()
            let until = WallClock.next(to, after: start) ?? start.addingTimeInterval(32400)
            let ms = Int(until.timeIntervalSince1970 * 1000)
            model.setDnd(say: "SOUNDS ON|Sounds allowed until \(WallClock.label(to)).") { $0["override"] = WallModel.dndOverride("off", ms) }
        })
        acts.append(act("Back on the schedule") {
            model.setDnd(say: "SCHEDULE|Quiet hours follow the schedule again.") { $0["override"] = NSNull() }
        })
        return BKBank(id: "sound", label: "SOUND", title: "Sound and quiet hours",
                      note: "Volume is on the VOL rocker. Quick quiet keys are the red and green keys up top.",
                      blocks: [.toggles(t), .seg(style), .step(stepper("Quiet from", "from", from)), .step(stepper("Quiet until", "to", to)), .acts(acts, cols: 2)])
    }

    private func voiceBank() -> BKBank {
        let v = model.obj("voice")
        let on = v?.bool("on") ?? true
        let sens = v?.str("sensitivity") ?? "normal"
        let t = [BKToggle(label: "Hey Scout", on: on, needs: nil, blocked: false) { model.setVoice { $0["on"] = !on } }]
        var opts: [BKOption] = []
        for o in [("Low", "low"), ("Normal", "normal"), ("High", "high")] {
            opts.append(BKOption(label: o.0, swatch: nil, on: sens == o.1) {
                Haptics.select()
                model.setVoice { $0["sensitivity"] = o.1 }
            })
        }
        return BKBank(id: "voice", label: "VOICE", title: "Hey Scout", note: "Talk to Scout through the wall.",
                      blocks: [.toggles(t), .seg(BKSeg(label: "How easily it hears you", cols: 3, opts: opts))])
    }

    private func radioBank() -> BKBank {
        let r = model.obj("radio")
        let name = (r?.str("name") ?? "").components(separatedBy: " - ").first ?? ""
        let url = r?.str("url") ?? ""
        let playing = r?.bool("on") ?? false
        let airOn = model.flag("airplay", true)
        let readout: [String] = [
            "LAST STATION  " + (name.isEmpty ? "NONE YET" : name.uppercased()),
            playing ? "PLAYING ON THE DESK HOMEPOD" : "STOPPED"
        ]
        var acts: [BKAct] = []
        if playing {
            acts.append(act("Stop radio", name.isEmpty ? nil : name) { _ = model.toggleRadio() })
        } else if !url.isEmpty {
            acts.append(act("Play \(name)") { _ = model.toggleRadio() })
        }
        acts.append(act("Find a station", "stations near home") { sheet = .radio })
        acts.append(act("Restart AirPlay", dim: !airOn) { model.command("airplay_restart", say: "AIRPLAY|Restarting AirPlay. About 15\u{00A0}sec.") })
        return BKBank(id: "radio", label: "RADIO", title: "Radio and AirPlay",
                      note: "Key 8 up top plays or stops the radio. It plays on the Desk HomePod and turns the LAX tower off.",
                      blocks: [.readout(readout), .toggles([tg("airplay", "Show as Bestly Wall in AirPlay")]), .acts(acts, cols: 2)])
    }

    private func displayBank() -> BKBank {
        var t: [BKToggle] = []
        t.append(tg("presence", "Off when I leave home"))
        t.append(tg("leftDate", "Today's date on the left", def: false))
        let theme = sg("theme", "Theme", cols: 3, def: nil, [("Normal", nil), ("Halloween", "halloween"), ("Thanksgiving", "thanksgiving")])
        var acts: [BKAct] = []
        acts.append(act("Demo text", "left, middle, right") { sheet = .demo })
        acts.append(act("Sample Turo booking") {
            model.setPatch(["bookingDemo": WallModel.nowMs()], say: "SAMPLE|Sample Turo booking on the strip for 20\u{00A0}sec.")
        })
        return BKBank(id: "display", label: "DISPLAY", title: "Display", note: "Mode keys 1 to 5 are up top.",
                      blocks: [.toggles(t), .seg(theme), .acts(acts, cols: 2)])
    }

    private func stripBank() -> BKBank {
        let items: [(String, String)] = [
            ("news", "News"), ("turo$", "Turo earnings"), ("air", "Air quality and pollen"), ("energy", "Home energy"),
            ("mail", "Mail and deliveries"), ("habits", "Activity"), ("leo", "Leo today"), ("appstore", "App Store"), ("devices", "Devices")
        ]
        var t: [BKToggle] = []
        for i in items { t.append(mapToggle("widgets", i.0, i.1)) }
        return BKBank(id: "strip", label: "STRIP", title: "Strip widgets", note: "The row of small cards on the wall.", blocks: [.toggles(t)])
    }

    private func alarmBank() -> BKBank {
        let a = model.obj("alarm")
        let on = a?.bool("on") ?? false
        let time = a?.str("time") ?? "07:00"
        let days = a?.str("days") ?? "weekdays"
        let m = WallClock.minutes(time) ?? 420
        let t = [BKToggle(label: "Alarm on", on: on, needs: nil, blocked: false) { model.toggleAlarm() }]
        let step = BKStep(label: "Time", value: WallClock.label(time),
                          minus: { Haptics.select(); model.setAlarm { $0["time"] = WallClock.hhmm(m - 5); $0["on"] = true } },
                          plus: { Haptics.select(); model.setAlarm { $0["time"] = WallClock.hhmm(m + 5); $0["on"] = true } },
                          minusLabel: "Alarm 5 minutes earlier", plusLabel: "Alarm 5 minutes later")
        var opts: [BKOption] = []
        for o in [("Once", "once"), ("Weekdays", "weekdays"), ("Weekends", "weekends"), ("Daily", "daily")] {
            opts.append(BKOption(label: o.0, swatch: nil, on: days == o.1) {
                Haptics.select()
                model.setAlarm { $0["days"] = o.1 }
            })
        }
        var acts: [BKAct] = []
        acts.append(act("Stop alarm") { model.setAlarm(say: "ALARM|Stopped for now.") { $0["stop"] = WallModel.nowMs() } })
        acts.append(act("Preview", "20\u{00A0}sec") { model.setAlarm(say: "PREVIEW|Playing the alarm for 20\u{00A0}sec.") { $0["test"] = WallModel.nowMs() } })
        return BKBank(id: "alarm", label: "ALARM", title: "Wake-up alarm",
                      note: "Key * up top turns it on or off. The Pi wakes the projector a minute early.",
                      blocks: [.toggles(t), .step(step), .seg(BKSeg(label: "Repeat", cols: 4, opts: opts)), .acts(acts, cols: 2)])
    }

    private func liveBank() -> BKBank {
        var t: [BKToggle] = []
        t.append(mapToggle("liveActs", "plane", "Nearby aircraft"))
        t.append(mapToggle("liveActs", "sweep", "Move the car"))
        t.append(mapToggle("liveActs", "turo", "Turo trips"))
        t.append(mapToggle("liveActs", "incident", "Something's broken"))
        var acts: [BKAct] = []
        acts.append(act("Dismiss what's showing") {
            model.setPatch(["headsStop": WallModel.nowMs()], say: "CLEARED|Dismissed on the wall and your phone.")
        })
        acts.append(act("Packages", "open the list") { sheet = .packages })
        return BKBank(id: "live", label: "PHONE", title: "On your phone",
                      note: "Which wall cards can show up as Live Activities.", blocks: [.toggles(t), .acts(acts, cols: 2)])
    }

    private func neonBank() -> BKBank {
        let l = model.obj("ledSign")
        func ledToggle(_ key: String, _ label: String, def: Bool) -> BKToggle {
            let on = l?.bool(key) ?? def
            return BKToggle(label: label, on: on, needs: nil, blocked: false) { model.setLed { $0[key] = !on } }
        }
        let t = [ledToggle("on", "Glow on", def: false), ledToggle("notify", "React to alerts", def: true),
                 ledToggle("shield", "Keep other content off", def: true), ledToggle("outline", "Show outline", def: false)]
        let look = l?.str("look") ?? "lit"
        var lookOpts: [BKOption] = []
        for o in [("Lit", "lit"), ("Breathe", "breathe"), ("Wash", "wash"), ("Trace", "trace"), ("None", "none")] {
            lookOpts.append(BKOption(label: o.0, swatch: nil, on: look == o.1) {
                Haptics.select()
                model.setLed { $0["look"] = o.1 }
            })
        }
        let color = (l?.str("color") ?? "#F4EEFF").uppercased()
        var colorOpts: [BKOption] = []
        let swatches: [(String, UInt32)] = [("Cool", 0xF4EEFF), ("Warm", 0xFFF1DC), ("Pink", 0xFF6FD8), ("Violet", 0xA78BFA), ("Blue", 0x64D2FF), ("Amber", 0xFFB340)]
        for s in swatches {
            let hex = String(format: "#%06X", s.1)
            colorOpts.append(BKOption(label: s.0, swatch: AT.hex(s.1), on: color == hex) {
                Haptics.select()
                model.setLed { $0["color"] = hex }
            })
        }
        func test(_ label: String, _ fx: String) -> BKAct {
            act(label) {
                model.setLed(say: "TEST|Showing the \(fx) effect on the sign.") { o in
                    o["outline"] = false
                    o["test"] = WallModel.ledTest(fx)
                }
            }
        }
        return BKBank(id: "neon", label: "NEON", title: "Neon sign", note: "The glow on the sign wall.",
                      blocks: [.toggles(t), .seg(BKSeg(label: "Look", cols: 5, opts: lookOpts)), .seg(BKSeg(label: "Glow color", cols: 3, opts: colorOpts)),
                               .acts([test("Test sign", "sign"), test("Test Turo", "turo"), test("Test Scout", "scout")], cols: 3)])
    }

    private func signBank() -> BKBank {
        let seg = sg("signShow", "Show signatures", cols: 3, def: "auto", [("Auto", "auto"), ("On", "on"), ("Off", "off")])
        var acts: [BKAct] = []
        acts.append(act("Signatures", "hide or delete") { sheet = .signs })
        acts.append(BKAct(label: "Hold to clear the wall", sub: nil, red: true, dim: false, hold: true, tap: { clearWall() }))
        return BKBank(id: "sign", label: "SIGN", title: "Sign the wall", note: "Guests sign at www.bestly.tech/sign/jg8h",
                      blocks: [.seg(seg), .acts(acts, cols: 2)])
    }

    private func clearWall() {
        Task {
            let ok = await Action.run("wall.sign_clear", attempt: {
                try await AdminAPI.rpc("wall_admin_sign_action", ["p_action": "clear"])
            }, verify: {
                guard let r = try? await AdminAPI.rpc("wall_admin_signs"), let arr = r as? [Any] else { return false }
                return !arr.compactMap { $0 as? JSON }.contains { $0.bool("hidden") != true }
            })
            if ok { model.say("WALL CLEARED", "Names are hidden, not deleted.") }
        }
    }

    private func projBank() -> BKBank {
        let pm = model.status.obj("power_meter")
        var readout: [String] = []
        if let w = pm?.dbl("w") {
            readout.append("POWER NOW  " + String(format: "%.1f", w) + "\u{00A0}W")
        } else {
            readout.append("POWER NOW  NOT REPORTING")
        }
        if let k = pm?.dbl("kwh_month") {
            readout.append("THIS MONTH  " + String(format: "%.2f", k) + "\u{00A0}kWh")
        }
        let bearing = model.num("airBearing") ?? 0
        let nearest = Int((bearing / 45).rounded()) % 8
        let names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        var faces: [BKOption] = []
        for (i, n) in names.enumerated() {
            faces.append(BKOption(label: n, swatch: nil, on: nearest == i) {
                Haptics.select()
                model.setPatch(["airBearing": i * 45], say: "WALL FACES|The sky now faces \(n).")
            })
        }
        let busy = model.status.obj("focus")?.bool("busy") ?? false
        var acts: [BKAct] = []
        acts.append(act("Focus", "blurs about 15\u{00A0}sec") { model.command("focus", say: "FOCUS|Refocusing. Blurs about 15\u{00A0}sec.") })
        acts.append(act("Nudge left", dim: busy) { model.command("focus_left", say: "FOCUS|Nudged the sign wall focus left.") })
        acts.append(act("Nudge right", dim: busy) { model.command("focus_right", say: "FOCUS|Nudged the sign wall focus right.") })
        return BKBank(id: "proj", label: "PROJ", title: "Projector", note: "Power is the red key up top.",
                      blocks: [.readout(readout), .toggles([tg("autoKeystone", "Auto keystone", def: false)]),
                               .seg(BKSeg(label: "Wall faces", cols: 4, opts: faces)), .acts(acts, cols: 3)])
    }

    private func alignBank() -> BKBank {
        var t: [BKToggle] = []
        t.append(tg("calGrid", "Alignment grid", def: false))
        t.append(tg("mapping", "Guides on the wall", def: false))
        var acts: [BKAct] = []
        acts.append(act("Edit corners") { editor = true })
        acts.append(act("Undo") { model.geometry(redo: false) })
        acts.append(act("Redo") { model.geometry(redo: true) })
        return BKBank(id: "align", label: "ALIGN", title: "Alignment",
                      note: "Corner editor opens full screen with drag handles for the strip, mask, sign wall and sky.",
                      blocks: [.toggles(t), .acts(acts, cols: 3)])
    }

    private func testsBank() -> BKBank {
        var t: [BKToggle] = []
        t.append(tg("testSweep", "Move-car alert", def: false))
        t.append(tg("testScout", "Scout alert", def: false))
        var acts: [BKAct] = []
        acts.append(act("Someone's near") { model.setPatch(["signNear": WallModel.nowMs()], say: "TEST|Someone is near the sign.") })
        acts.append(act("Every sound") { model.setPatch(["soundTest": WallModel.nowMs()], say: "TEST|Playing every sound.") })
        return BKBank(id: "tests", label: "TESTS", title: "Tests", note: "Try a wall effect without waiting for it.",
                      blocks: [.toggles(t), .acts(acts, cols: 2)])
    }
}

// MARK: panel

struct BankPanel: View {
    let bank: BKBank

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(bank.title)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(AT.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text(bank.note)
                    .font(.system(size: 13))
                    .foregroundStyle(AT.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array(bank.blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 16)
        .padding(.bottom, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { well }
    }

    private var well: some View {
        let shape = RoundedRectangle(cornerRadius: 22, style: .continuous)
        return shape
            .fill(LinearGradient(colors: [WallInk.wellTop, WallInk.wellBottom], startPoint: .top, endPoint: .bottom))
            .overlay(
                shape.stroke(Color.black.opacity(0.7), lineWidth: 8).blur(radius: 5).clipShape(shape)
            )
            .overlay(shape.strokeBorder(Color.black.opacity(0.7), lineWidth: 1))
    }

    @ViewBuilder
    private func blockView(_ block: BKBlock) -> some View {
        switch block {
        case .readout(let lines): BankReadout(lines: lines)
        case .toggles(let list): BankToggles(list: list)
        case .seg(let s): BankSegView(seg: s)
        case .step(let s): BankStepView(step: s)
        case .acts(let list, let cols): BankActs(list: list, cols: cols)
        }
    }
}

struct BankReadout: View {
    let lines: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, l in
                Text(l)
                    .font(.system(size: 12, design: .monospaced))
                    .tracking(0.5)
                    .lcdGlow()
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(RadialGradient(colors: [AT.hex(0x1C2613), AT.hex(0x0E130B)], center: UnitPoint(x: 0.5, y: 0.4), startRadius: 0, endRadius: 200))
        )
        .accessibilityElement(children: .combine)
    }
}

struct BankToggles: View {
    let list: [BKToggle]
    private let columns: [GridItem] = Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .top), count: 2)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(Array(list.enumerated()), id: \.offset) { _, t in toggle(t) }
        }
    }

    private func toggle(_ t: BKToggle) -> some View {
        Button(action: t.tap) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.label)
                        .font(.system(size: 13, weight: .semibold))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if t.blocked, let n = t.needs {
                        Text(n).font(.system(size: 11)).foregroundStyle(AT.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    if !t.blocked, let sub = t.sub {
                        Text(sub).font(.system(size: 11)).foregroundStyle(AT.secondary).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 4)
                WLed(lit: t.on && !t.blocked, size: 7)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
            .opacity(t.blocked ? 0.42 : 1)
        }
        .buttonStyle(RemoteKey())
        .accessibilityLabel(t.label)
        .accessibilityValue(t.blocked ? (t.needs ?? "Unavailable") : (t.on ? "On" : "Off"))
        .accessibilityAddTraits(t.on && !t.blocked ? .isSelected : [])
    }
}

struct BankSegView: View {
    let seg: BKSeg

    var body: some View {
        let columns: [GridItem] = Array(repeating: GridItem(.flexible(), spacing: 8), count: max(1, seg.cols))
        return VStack(alignment: .leading, spacing: 8) {
            WEng(text: seg.label).multilineTextAlignment(.leading)
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(Array(seg.opts.enumerated()), id: \.offset) { _, o in option(o) }
            }
        }
    }

    private func option(_ o: BKOption) -> some View {
        Button(action: o.tap) {
            HStack(spacing: 6) {
                if let sw = o.swatch {
                    Circle().fill(sw).frame(width: 16, height: 16).shadow(color: sw.opacity(0.8), radius: 4)
                }
                Text(o.label)
                    .font(.system(size: 12, weight: .bold))
                    .fixedSize()
            }
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity, minHeight: 46)
        }
        .buttonStyle(RemoteKey(face: o.on ? .selected : .normal))
        .accessibilityLabel(o.label)
        .accessibilityAddTraits(o.on ? .isSelected : [])
    }
}

struct BankStepView: View {
    let step: BKStep

    var body: some View {
        HStack(spacing: 8) {
            WEng(text: step.label)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: step.minus) {
                Text("\u{2212}").font(.system(size: 22)).frame(width: 46, height: 46)
            }
            .buttonStyle(RemoteKey())
            .accessibilityLabel(step.minusLabel)
            Text(step.value)
                .font(.system(size: 15, design: .monospaced))
                .lcdGlow()
                .fixedSize()
                .frame(minWidth: 92)
                .accessibilityLabel("\(step.label): \(step.value)")
            Button(action: step.plus) {
                Text("+").font(.system(size: 22)).frame(width: 46, height: 46)
            }
            .buttonStyle(RemoteKey())
            .accessibilityLabel(step.plusLabel)
        }
    }
}

struct BankActs: View {
    let list: [BKAct]
    let cols: Int

    var body: some View {
        let columns: [GridItem] = Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .top), count: max(1, cols))
        return LazyVGrid(columns: columns, spacing: 10) {
            ForEach(Array(list.enumerated()), id: \.offset) { _, a in
                if a.hold { WallHoldKey(label: a.label, onDone: a.tap) } else { key(a) }
            }
        }
    }

    private func key(_ a: BKAct) -> some View {
        Button(action: a.tap) {
            VStack(spacing: 2) {
                Text(a.label)
                    .font(.system(size: 13, weight: .bold))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                if let s = a.sub {
                    Text(s)
                        .font(.system(size: 11))
                        .foregroundStyle(Color(white: 0.79))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 52)
            .opacity(a.dim ? 0.42 : 1)
        }
        .buttonStyle(RemoteKey(face: a.red ? .red : .normal))
        .accessibilityLabel(a.label + (a.sub.map { ", \($0)" } ?? ""))
        .accessibilityValue(a.dim ? "Unavailable" : "")
    }
}

/// Press and hold for 1 s. A ring fills around the key; letting go early cancels.
struct WallHoldKey: View {
    let label: String
    let onDone: () -> Void
    @State private var progress: CGFloat = 0

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        Text(label)
            .font(.system(size: 13, weight: .bold))
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .foregroundStyle(WallInk.redText)
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background {
                shape.fill(LinearGradient(colors: [WallInk.redTop, WallInk.redBottom], startPoint: .top, endPoint: .bottom))
                    .shadow(color: WallInk.keyEdge, radius: 0, y: 3)
                    .shadow(color: .black.opacity(0.55), radius: 9, y: 8)
            }
            .overlay {
                shape.trim(from: 0, to: progress)
                    .stroke(Color.white.opacity(0.85), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .shadow(color: Color.white.opacity(0.5), radius: 4)
            }
            .contentShape(shape)
            .onLongPressGesture(minimumDuration: 1.0, maximumDistance: 40, perform: {
                Haptics.thunk()
                onDone()
            }, onPressingChanged: { pressing in
                if pressing {
                    Haptics.tap()
                    withAnimation(.linear(duration: 1.0)) { progress = 1 }
                } else {
                    withAnimation(.easeOut(duration: 0.2)) { progress = 0 }
                }
            })
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .accessibilityHint("Press and hold for one second")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(named: "Clear the wall") { onDone() }
    }
}
