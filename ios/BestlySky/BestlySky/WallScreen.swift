// Bestly Admin: Wall tab. The remote (matches the approved Main design) with the 16 switch banks below it.
import SwiftUI

enum WallSheet: String, Identifiable {
    case radio, signs, packages, demo
    var id: String { rawValue }
}

struct WallScreen: View {
    @StateObject private var model = WallModel()
    @Environment(\.scenePhase) private var phase
    @State private var bankOpen: String?
    @State private var sheet: WallSheet?
    @State private var showEditor = false

    var body: some View {
        ZStack {
            WallBackdrop()
            ScrollView {
                VStack(spacing: 0) {
                    WallHeader(model: model)
                    WallRemote(model: model, sheet: $sheet)
                    WallDoor(model: model, open: $bankOpen, sheet: $sheet, editor: $showEditor)
                }
                .padding(.bottom, 120)
            }
            .scrollIndicators(.hidden)
        }
        .overlay(alignment: .bottom) { toast }
        .onAppear {
            model.setVisible(true)
            model.setActive(phase == .active)
        }
        .onDisappear { model.setVisible(false) }
        .onChange(of: phase) { _, p in model.setActive(p == .active) }
        .sheet(item: $sheet) { s in
            WallSheetHost(model: model, sheet: s)
                .preferredColorScheme(.dark)
        }
        .fullScreenCover(isPresented: $showEditor) {
            WallCornerEditor(model: model)
                .preferredColorScheme(.dark)
        }
        .screenView("wall")
    }

    /// Door switches change things far below the LCD, so echo the LCD message here while a bank is open.
    @ViewBuilder
    private var toast: some View {
        if bankOpen != nil, let f = model.flash {
            VStack(spacing: 2) {
                Text(f.big).font(.system(size: 13, weight: .bold, design: .monospaced)).tracking(1)
                if !f.sub.isEmpty { Text(f.sub).font(.system(size: 13)).foregroundStyle(AT.secondary) }
            }
            .foregroundStyle(AT.text)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(minHeight: 44)
            .background(AT.inner, in: Capsule())
            .shadow(color: .black.opacity(0.4), radius: 12, y: 4)
            .padding(.bottom, 96)
            .transition(.opacity)
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: header

struct WallHeader: View {
    @ObservedObject var model: WallModel

    var body: some View {
        HStack(alignment: .center) {
            Text("Wall")
                .font(.system(size: 34, weight: .bold))
                .tracking(-0.6)
                .foregroundStyle(AT.text)
            Spacer(minLength: 8)
            HStack(spacing: 8) {
                WLed(lit: true, red: model.syncTone == .bad, size: 7)
                    .opacity(model.syncTone == .busy ? 0.55 : 1)
                Text(model.syncLabel)
                    .font(.system(size: 13))
                    .foregroundStyle(Color(white: 0.89))
                    .fixedSize()
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(AT.card, in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Wall sync: \(model.syncLabel)")
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 10)
    }
}

// MARK: remote

struct WallRemote: View {
    @ObservedObject var model: WallModel
    @Binding var sheet: WallSheet?

    var body: some View {
        VStack(spacing: 18) {
            Capsule()
                .fill(LinearGradient(colors: [AT.hex(0x5A1414), AT.hex(0x2A0808)], startPoint: .top, endPoint: .bottom))
                .frame(width: 64, height: 10)
                .accessibilityHidden(true)
            WallLCD(model: model)
            WallPowerRow(model: model)
            WallPad(model: model, sheet: $sheet)
            WallRockerRow(model: model)
            WallColorKeys(model: model)
            VStack(spacing: 10) {
                HStack(spacing: 6) {
                    WEng(text: "Every switch below")
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(WallInk.muted)
                }
                Text("BESTLY")
                    .font(.system(size: 15, weight: .heavy))
                    .tracking(6)
                    .foregroundStyle(AT.hex(0x121216))
                    .shadow(color: Color.white.opacity(0.07), radius: 0, y: 1)
            }
            .padding(.top, 6)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Every switch is in the banks below")
        }
        .padding(.top, 18)
        .padding(.bottom, 28)
        .padding(.horizontal, 22)
        .frame(maxWidth: 340)
        .background { remoteBody }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
    }

    private var remoteBody: some View {
        let shape = UnevenRoundedRectangle(cornerRadii: RectangleCornerRadii(topLeading: 46, bottomLeading: 58, bottomTrailing: 58, topTrailing: 46), style: .continuous)
        return shape
            .fill(LinearGradient(colors: [WallInk.bodyTop, WallInk.bodyMid, WallInk.bodyBottom], startPoint: .top, endPoint: .bottom))
            .overlay(
                shape.strokeBorder(
                    LinearGradient(colors: [Color.white.opacity(0.12), Color.white.opacity(0.03), Color.black.opacity(0.4)], startPoint: .top, endPoint: .bottom),
                    lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.7), radius: 30, x: 0, y: 24)
    }
}

// MARK: LCD

struct WallLCD: View {
    @ObservedObject var model: WallModel

    private var live: WallLive { model.live }

    private var bigText: String {
        if let f = model.flash { return f.big }
        if model.showsOff { return "OFF" }
        return model.modeInfo.word
    }

    private var subText: String {
        if let f = model.flash { return f.sub }
        if model.showsOff { return "Off until 7:00 AM, or press Power." }
        return live.sub
    }

    private var showModeLine: Bool { model.flash == nil && !model.showsOff && !model.modeInfo.desc.isEmpty }

    private var statusText: String { model.showsOff ? "POWER OFF" : live.title }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                HStack(alignment: .top, spacing: 6) {
                    WLed(lit: model.showsOff || live.tone != .idle, red: model.showsOff || live.tone == .bad || live.tone == .warn)
                        .padding(.top, 3)
                    Text(statusText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .lcdGlow()
                Spacer(minLength: 4)
                Text("CH\u{00A0}\(model.modeInfo.ch)")
                    .lcdGlow()
                    .fixedSize()
            }
            .font(.system(size: 11, design: .monospaced))
            .tracking(1)

            Text(bigText)
                .font(.system(size: 34, weight: .bold, design: .monospaced))
                .tracking(2)
                .lcdGlow()
                .fixedSize(horizontal: false, vertical: true)

            Text(subText)
                .font(.system(size: 12, design: .monospaced))
                .lcdGlow()
                .opacity(0.86)
                .fixedSize(horizontal: false, vertical: true)

            if showModeLine {
                Text(model.modeInfo.desc)
                    .font(.system(size: 11, design: .monospaced))
                    .lcdGlow()
                    .opacity(0.62)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let p = model.playing, model.flash == nil {
                Text(p)
                    .font(.system(size: 11, design: .monospaced))
                    .tracking(0.6)
                    .lcdGlow()
                    .opacity(0.86)
                    .fixedSize(horizontal: false, vertical: true)
            }

            WallFlow(hSpacing: 12, vSpacing: 6) {
                chip("VOL\u{00A0}\(model.volume)")
                chip("SKY\u{00A0}\(model.radiusMi)\u{00A0}mi")
                chip(model.quietText)
                if let f = model.projTempF { chip("PROJ\u{00A0}\(f)\u{00B0}F") }
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { lcdBackground }
        .overlay { WallScanlines().clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous)) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Wall screen: \(statusText). \(bigText). \(subText). Volume \(model.volume). Sky radius \(model.radiusMi) miles. \(model.quietText.capitalized)")
        .accessibilityAddTraits(.updatesFrequently)
    }

    private func chip(_ s: String) -> some View {
        Text(glue(s))
            .font(.system(size: 11, design: .monospaced))
            .tracking(0.6)
            .lcdGlow()
            .fixedSize(horizontal: false, vertical: true)
    }

    private var lcdBackground: some View {
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        return shape
            .fill(RadialGradient(colors: [AT.hex(0x1C2613), AT.hex(0x0E130B), AT.hex(0x090C07)],
                                 center: UnitPoint(x: 0.5, y: 0.4), startRadius: 0, endRadius: 230))
            .overlay(
                shape.stroke(Color.black.opacity(0.75), lineWidth: 7)
                    .blur(radius: 5)
                    .clipShape(shape)
            )
            .overlay(shape.strokeBorder(Color.black.opacity(0.8), lineWidth: 1))
    }
}

// MARK: power, mute, away

struct WallPowerRow: View {
    @ObservedObject var model: WallModel

    var body: some View {
        HStack(alignment: .bottom) {
            VStack(spacing: 8) {
                Button { model.togglePower() } label: {
                    Image(systemName: "power")
                        .font(.system(size: 26, weight: .bold))
                        .frame(width: 68, height: 68)
                }
                .buttonStyle(RemoteKey(face: .power, radius: 34, haptic: false))
                .accessibilityLabel(model.needsTurnOn ? "Power, turn on" : "Power, turn off")
                WEng(text: "Power \u{00B7} \(model.showsOff ? "Off" : "On")")
            }
            Spacer(minLength: 8)
            HStack(spacing: 12) {
                sideKey(label: "MUTE", cap: "Wall sounds", on: !model.flag("sound", true), red: true,
                        aria: "Mute wall sounds") {
                    let muted = model.flag("sound", true)
                    model.setPatch(["sound": !muted], say: muted ? "MUTED|Wall sounds are off." : "SOUND ON|Wall sounds are back.")
                }
                sideKey(label: "AWAY", cap: "Away mode", on: model.flag("away", false), red: false,
                        aria: "Away mode") {
                    let on = !model.flag("away", false)
                    model.setPatch(["away": on], say: on ? "AWAY|Pi leaves the projector alone." : "AWAY OFF|The wall is back to normal.")
                }
            }
        }
    }

    private func sideKey(label: String, cap: String, on: Bool, red: Bool, aria: String, action: @escaping () -> Void) -> some View {
        VStack(spacing: 8) {
            Button(action: action) {
                HStack(spacing: 8) {
                    WLed(lit: on, red: red)
                    Text(label).font(.system(size: 13, weight: .bold)).tracking(0.6)
                }
                .frame(width: 76, height: 50)
            }
            .buttonStyle(RemoteKey())
            .accessibilityLabel(aria)
            .accessibilityValue(on ? "On" : "Off")
            .accessibilityAddTraits(on ? .isSelected : [])
            WEng(text: cap)
        }
    }
}

// MARK: number pad

struct WallPad: View {
    @ObservedObject var model: WallModel
    @Binding var sheet: WallSheet?

    private struct Key: Identifiable {
        var id: String { n }
        var n: String
        var label: String
        var mode: String?
    }

    private let keys: [Key] = [
        Key(n: "1", label: "AUTO", mode: "auto"), Key(n: "2", label: "BOARD", mode: "board"), Key(n: "3", label: "AMBIENT", mode: "ambient"),
        Key(n: "4", label: "DEMO", mode: "demo"), Key(n: "5", label: "BLACK", mode: "off"), Key(n: "6", label: "PLANES", mode: nil),
        Key(n: "7", label: "NEON", mode: nil), Key(n: "8", label: "RADIO", mode: nil), Key(n: "9", label: "TOWER", mode: nil),
        Key(n: "*", label: "ALARM", mode: nil), Key(n: "0", label: "FOCUS", mode: nil), Key(n: "#", label: "CLEAR", mode: nil)
    ]

    private let columns: [GridItem] = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                WEng(text: "Mode 1\u{2013}5", color: AT.hex(0xA9C97A))
                Spacer()
                WEng(text: "Quick 6\u{2013}#", color: AT.hex(0xE8B79F))
            }
            .padding(.horizontal, 2)
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(keys) { k in padKey(k) }
            }
        }
    }

    private func isOn(_ k: Key) -> Bool {
        if let m = k.mode { return !model.showsOff && model.mode == m }
        switch k.n {
        case "6": return model.flag("airShow", true)
        case "7": return model.obj("ledSign")?.bool("on") ?? false
        case "8": return model.obj("radio")?.bool("on") ?? false
        case "9": return model.flag("atc", false)
        case "*": return model.obj("alarm")?.bool("on") ?? false
        default: return false
        }
    }

    private func ariaLabel(_ k: Key, on: Bool) -> String {
        if k.mode != nil { return "Mode \(k.label.lowercased())" + (on ? ", selected" : "") }
        switch k.n {
        case "0": return "Focus the projector"
        case "#": return "Clear the heads-up card"
        default: return k.label.capitalized + (on ? ", on" : ", off")
        }
    }

    private func padKey(_ k: Key) -> some View {
        let on = isOn(k)
        return Button { press(k) } label: {
            VStack(spacing: 1) {
                Text(k.n).font(.system(size: 21, weight: .bold)).lineLimit(1)
                Text(k.label)
                    .font(.system(size: 11, weight: .bold))
                    .tracking(0.7)
                    .foregroundStyle(k.mode != nil ? AT.lime : AT.peach)
                    .fixedSize()
            }
            .frame(maxWidth: .infinity, minHeight: 54)
            .overlay(alignment: .topTrailing) {
                WLed(lit: on)
                    .padding(.top, 8)
                    .padding(.trailing, 10)
            }
        }
        .buttonStyle(RemoteKey())
        .accessibilityLabel(ariaLabel(k, on: on))
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func press(_ k: Key) {
        if let m = k.mode {
            if model.mode != m || model.showsOff { Haptics.select() }
            let info = WallModel.modes.first { $0.key == m }
            model.setPatch(["mode": m], say: "\(info?.word ?? m.uppercased())|\(info?.desc ?? "")")
            return
        }
        switch k.n {
        case "6": model.togglePlanes()
        case "7": model.toggleNeon()
        case "8": if !model.toggleRadio() { sheet = .radio }
        case "9": model.toggleTower()
        case "*": model.toggleAlarm()
        case "0": model.command("focus", say: "FOCUS|Refocusing. Blurs about 15\u{00A0}sec.")
        default:
            model.setPatch(["headsStop": WallModel.nowMs()], say: "CLEARED|Heads-up card dismissed.")
        }
    }
}

// MARK: rockers and D-pad

struct WallRockerRow: View {
    @ObservedObject var model: WallModel

    var body: some View {
        HStack {
            rocker(label: "VOL", upAria: "Volume up", downAria: "Volume down",
                   up: { model.setDebounced(["volume": min(100, model.volume + 5)]) },
                   down: { model.setDebounced(["volume": max(0, model.volume - 5)]) })
            Spacer(minLength: 4)
            WallDpad(model: model)
            Spacer(minLength: 4)
            rocker(label: "SKY", upAria: "Sky radius up", downAria: "Sky radius down",
                   up: { model.setDebounced(["airRadiusMi": min(25, model.radiusMi + 1)]) },
                   down: { model.setDebounced(["airRadiusMi": max(2, model.radiusMi - 1)]) })
        }
        .padding(.vertical, 4)
    }

    private func rocker(label: String, upAria: String, downAria: String, up: @escaping () -> Void, down: @escaping () -> Void) -> some View {
        let upShape = RectangleCornerRadii(topLeading: 29, bottomLeading: 6, bottomTrailing: 6, topTrailing: 29)
        let downShape = RectangleCornerRadii(topLeading: 6, bottomLeading: 29, bottomTrailing: 29, topTrailing: 6)
        return VStack(spacing: 0) {
            Button(action: up) {
                Text("+").font(.system(size: 24, weight: .semibold)).frame(width: 58, height: 64)
            }
            .buttonStyle(RemoteKey(face: .clear, corners: upShape))
            .accessibilityLabel(upAria)
            WEng(text: label, color: AT.hex(0xB4B4BE)).padding(.vertical, 2)
            Button(action: down) {
                Text("\u{2212}").font(.system(size: 24, weight: .semibold)).frame(width: 58, height: 64)
            }
            .buttonStyle(RemoteKey(face: .clear, corners: downShape))
            .accessibilityLabel(downAria)
        }
        .frame(width: 58)
        .background {
            RoundedRectangle(cornerRadius: 29, style: .continuous)
                .fill(LinearGradient(colors: [WallInk.keyTop, AT.hex(0x2A2A32)], startPoint: .top, endPoint: .bottom))
                .shadow(color: WallInk.keyEdge, radius: 0, y: 3)
                .shadow(color: .black.opacity(0.55), radius: 9, y: 8)
        }
    }
}

struct WallDpad: View {
    @ObservedObject var model: WallModel

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [AT.hex(0x34343D), AT.hex(0x24242B)], startPoint: .top, endPoint: .bottom))
                    .shadow(color: WallInk.keyEdge, radius: 0, y: 3)
                    .shadow(color: .black.opacity(0.6), radius: 10, y: 10)
                arrow("chevron.up", w: 48, h: 44, x: 0, y: -62, aria: "Move home up on the sky") {
                    model.nudgeHome(dx: 0, dy: -0.05, label: "HOME \u{25B2}", text: "Home moved up on the sky.")
                }
                arrow("chevron.down", w: 48, h: 44, x: 0, y: 62, aria: "Move home down on the sky") {
                    model.nudgeHome(dx: 0, dy: 0.05, label: "HOME \u{25BC}", text: "Home moved down on the sky.")
                }
                arrow("chevron.left", w: 44, h: 44, x: -62, y: 0, aria: "Move home left on the sky") {
                    model.nudgeHome(dx: -0.05, dy: 0, label: "HOME \u{25C0}", text: "Home moved left on the sky.")
                }
                arrow("chevron.right", w: 44, h: 44, x: 62, y: 0, aria: "Move home right on the sky") {
                    model.nudgeHome(dx: 0.05, dy: 0, label: "HOME \u{25B6}", text: "Home moved right on the sky.")
                }
                Button { model.centerHome() } label: {
                    Text("MID").font(.system(size: 12, weight: .heavy)).tracking(0.8).frame(width: 58, height: 58)
                }
                .buttonStyle(RemoteKey(radius: 29))
                .accessibilityLabel("Center home on the sky")
            }
            .frame(width: 168, height: 168)
            WEng(text: "Home on the sky")
        }
    }

    private func arrow(_ icon: String, w: CGFloat, h: CGFloat, x: CGFloat, y: CGFloat, aria: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(AT.hex(0xD4D4DC))
                .frame(width: w, height: h)
        }
        .buttonStyle(RemoteKey(face: .clear, radius: 12))
        .offset(x: x, y: y)
        .accessibilityLabel(aria)
    }
}

// MARK: color keys

struct WallColorKeys: View {
    @ObservedObject var model: WallModel

    private struct CKey: Identifiable {
        var id: String { label }
        var label: String
        var color: Color
        var aria: String
    }

    private let keys: [CKey] = [
        CKey(label: "QUIET 1\u{00A0}HR", color: AT.hex(0xFF6B6B), aria: "Quiet for 1 hour"),
        CKey(label: "ALLOW 1\u{00A0}HR", color: AT.hex(0x4ADE80), aria: "Allow sounds for 1 hour"),
        CKey(label: "AIRPLAY", color: AT.hex(0xFACC15), aria: "Restart AirPlay"),
        CKey(label: "RELAUNCH", color: AT.hex(0x60A5FA), aria: "Relaunch the wall page")
    ]

    private let columns: [GridItem] = Array(repeating: GridItem(.flexible(), spacing: 10), count: 4)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(keys) { k in key(k) }
        }
    }

    private func airplayOff() -> Bool { !model.flag("airplay", true) }

    private func key(_ k: CKey) -> some View {
        let dim = k.label == "AIRPLAY" && airplayOff()
        return Button { press(k) } label: {
            VStack(spacing: 7) {
                Capsule()
                    .fill(k.color)
                    .frame(width: 34, height: 5)
                    .shadow(color: k.color.opacity(0.6), radius: 4)
                Text(k.label)
                    .font(.system(size: 11, weight: .bold))
                    .tracking(0.5)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 2)
            .frame(maxWidth: .infinity, minHeight: 54)
            .opacity(dim ? 0.42 : 1)
        }
        .buttonStyle(RemoteKey())
        .accessibilityLabel(k.aria)
        .accessibilityValue(dim ? "Unavailable, AirPlay is off" : "")
    }

    private func press(_ k: CKey) {
        switch k.label {
        case "AIRPLAY":
            if airplayOff() {
                Haptics.nope()
                model.say("AIRPLAY OFF", "Turn on Bestly Wall in the Radio bank first.")
            } else {
                model.command("airplay_restart", say: "AIRPLAY|Restarting AirPlay. About 15\u{00A0}sec.")
            }
        case "RELAUNCH":
            model.command("relaunch", say: "RELAUNCH|Wall page restarting. About 15\u{00A0}sec.")
        case "ALLOW 1\u{00A0}HR":
            model.quiet(for: "off")
        default:
            model.quiet(for: "on")
        }
    }
}
