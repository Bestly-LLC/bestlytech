// The in-app screen: a TRUE compass to the sky-alert targets, from wherever the phone is.
// The ring turns with the phone's real heading; the big arrow points at the selected target.
// (The Live Activity can only show a bearing relative to north; turning with the phone needs the app open.)
import CoreLocation
import SwiftUI

struct SkyTarget: Identifiable, Hashable {
    let id: String
    var s: SkyState
}

@MainActor
final class Compass: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var heading: Double?          // degrees true (magnetic when true is unavailable)
    @Published var here: CLLocation?
    @Published var targets: [SkyTarget] = []
    @Published var selectedID: String?
    @Published var error: String?
    @Published private(set) var ringDeg: Double = 0
    @Published private(set) var arrowDeg: Double = 0
    private let lm = CLLocationManager()
    private var poll: Task<Void, Never>?

    override init() {
        super.init()
        lm.delegate = self
        lm.headingFilter = 2
        lm.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    var selected: SkyTarget? { targets.first { $0.id == selectedID } ?? targets.first }

    func select(_ id: String) {
        selectedID = id
        refreshAngles()
    }

    func start() {
        #if DEBUG
        if CommandLine.arguments.contains("-skyDemo") {
            targets = ["news", "police", "plane"].map { SkyTarget(id: $0, s: .demo($0)) }
            heading = 20
            refreshAngles()
            return
        }
        #endif
        if lm.authorizationStatus == .notDetermined { lm.requestWhenInUseAuthorization() }
        lm.startUpdatingLocation()
        if CLLocationManager.headingAvailable() { lm.startUpdatingHeading() }
        poll?.cancel()
        poll = Task { [weak self] in
            while !Task.isCancelled {
                await self?.fetch()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    func stop() {
        poll?.cancel()
        lm.stopUpdatingHeading()
        lm.stopUpdatingLocation()
    }

    /// Bearing + distance from the phone when we know where it is and where the target is; else the server's (from home).
    func geometry(for s: SkyState) -> (bearing: Double, miles: Double) {
        if let h = here, s.targetLat != 0 || s.targetLon != 0 {
            let a = h.coordinate
            return (Sky.bearing(a.latitude, a.longitude, s.targetLat, s.targetLon), Sky.miles(a.latitude, a.longitude, s.targetLat, s.targetLon))
        }
        return (s.bearingDeg, s.distMi)
    }

    private func refreshAngles() {
        let h = heading ?? 0
        ringDeg = Sky.unwrap(ringDeg, to: -h)
        if let t = selected { arrowDeg = Sky.unwrap(arrowDeg, to: geometry(for: t.s).bearing - h) }
    }

    private static func states(from r: [String: Any]) -> [SkyState] {
        var raw: [[String: Any]] = []
        for key in ["targets", "states"] { if let a = r[key] as? [[String: Any]] { raw += a } }
        if let st = r["state"] as? [String: Any] { raw.append(st) }
        let dec = JSONDecoder()
        return raw.compactMap { d -> SkyState? in
            guard let data = try? JSONSerialization.data(withJSONObject: d), let s = try? dec.decode(SkyState.self, from: data) else { return nil }
            return s.line1.isEmpty ? nil : s
        }
    }

    private func fetch() async {
        do {
            let r = try await SkyAPI.post(["op": "current"])
            var seen: [String: Int] = [:]
            targets = Self.states(from: r).map { s in
                let n = seen[s.kind, default: 0]
                seen[s.kind] = n + 1
                return SkyTarget(id: "\(s.kind)-\(n)", s: s)
            }
            if selectedID == nil || !targets.contains(where: { $0.id == selectedID }) { selectedID = targets.first?.id }
            error = nil
            refreshAngles()
        } catch {
            self.error = "Can't reach the wall right now"
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateHeading h: CLHeading) {
        let v = h.trueHeading >= 0 ? h.trueHeading : h.magneticHeading
        Task { @MainActor in
            self.heading = v
            self.refreshAngles()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard let l = locs.last else { return }
        Task { @MainActor in
            self.here = l
            self.refreshAngles()
        }
    }
}

struct CompassView: View {
    @StateObject private var c = Compass()
    @ObservedObject private var sync = TokenSync.shared
    @Environment(\.scenePhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let dialSize: CGFloat = 300

    var body: some View {
        ZStack {
            RadialGradient(colors: [Color(red: 20.0 / 255, green: 26.0 / 255, blue: 40.0 / 255), .black],
                           center: UnitPoint(x: 0.5, y: 0.38), startRadius: 0, endRadius: 460)
                .ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Overhead").font(.system(size: 34, weight: .bold)).tracking(-0.7).foregroundStyle(.white)
                        Text("Turn your phone. The arrow follows.").font(.system(size: 15)).foregroundStyle(Color.white.opacity(0.65))
                    }
                    if let t = c.selected {
                        dial(for: t).frame(maxWidth: .infinity).padding(.top, 6)
                        readout(for: t)
                        VStack(spacing: 8) {
                            ForEach(c.targets) { row($0) }
                        }
                    } else {
                        VStack(spacing: 8) {
                            Image(systemName: "airplane").font(.system(size: 34)).foregroundStyle(Color.white.opacity(0.5))
                            Text("Nothing overhead right now").font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
                            Text("When something shows up, it lands here and on your Lock Screen.")
                                .font(.system(size: 15)).foregroundStyle(Color.white.opacity(0.6)).multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity).padding(.top, 80)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        if let e = c.error { Label(e, systemImage: "wifi.exclamationmark").font(.footnote).foregroundStyle(.orange) }
                        Text("Live Activity: \(sync.lastRegistered)").font(.footnote).foregroundStyle(Color.white.opacity(0.45))
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 28)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .onAppear { c.start() }
        .onDisappear { c.stop() }
        .onChange(of: phase) { _, p in if p == .active { c.start() } else { c.stop() } }
    }

    // MARK: Dial

    private func dial(for t: SkyTarget) -> some View {
        let k = SkyKind(t.s.kind)
        let g = c.geometry(for: t.s)
        let rel = g.bearing - (c.heading ?? 0)
        return ZStack {
            Circle().fill(Color.white.opacity(0.04))
            Circle().strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
            ring
                .rotationEffect(.degrees(c.ringDeg))
                .animation(reduceMotion ? nil : .spring(response: 0.5, dampingFraction: 1.0), value: c.ringDeg)
            Capsule().fill(Color.white).frame(width: 4, height: 18)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top).offset(y: -6)
            SkyArrowShape().fill(k.tint)
                .frame(width: 96, height: 96)
                .shadow(color: k.tint.opacity(0.55), radius: 14)
                .rotationEffect(.degrees(c.arrowDeg))
                .animation(reduceMotion ? nil : .spring(response: 0.5, dampingFraction: 1.0), value: c.arrowDeg)
        }
        .frame(width: dialSize, height: dialSize)
        .background {
            Circle()
                .fill(RadialGradient(colors: [k.tint.opacity(0.22), k.tint.opacity(0.06), k.tint.opacity(0)],
                                     center: .center, startRadius: 0, endRadius: dialSize * 0.63))
                .frame(width: dialSize + 80, height: dialSize + 80)
        }
        .accessibilityElement()
        .accessibilityLabel("Arrow pointing toward \(k.subject), \(Sky.relPhrase(rel).lowercased())")
    }

    private var ring: some View {
        ZStack {
            ForEach(0..<36, id: \.self) { i in
                let major = i % 9 == 0
                Capsule()
                    .fill(Color.white.opacity(major ? 0.7 : 0.22))
                    .frame(width: 2, height: major ? 12 : 6)
                    .padding(.top, 6)
                    .frame(width: dialSize, height: dialSize, alignment: .top)
                    .rotationEffect(.degrees(Double(i) * 10))
            }
            letter("N", color: Color(red: 1.0, green: 69.0 / 255, blue: 58.0 / 255), size: 17, weight: .bold, angle: 0)
            letter("E", color: Color.white.opacity(0.7), size: 15, weight: .semibold, angle: 90)
            letter("S", color: Color.white.opacity(0.7), size: 15, weight: .semibold, angle: 180)
            letter("W", color: Color.white.opacity(0.7), size: 15, weight: .semibold, angle: 270)
        }
        .frame(width: dialSize, height: dialSize)
    }

    private func letter(_ t: String, color: Color, size: CGFloat, weight: Font.Weight, angle: Double) -> some View {
        Text(t).font(.system(size: size, weight: weight)).foregroundStyle(color)
            .padding(.top, 24)
            .frame(width: dialSize, height: dialSize, alignment: .top)
            .rotationEffect(.degrees(angle))
    }

    // MARK: Readout + list

    private func readout(for t: SkyTarget) -> some View {
        let k = SkyKind(t.s.kind)
        let g = c.geometry(for: t.s)
        return VStack(spacing: 2) {
            Text(Sky.miText(g.miles))
                .font(.system(size: 44, weight: .bold)).tracking(-0.9).monospacedDigit().foregroundStyle(.white).fixedSize()
            Text(c.heading == nil ? "Bearing from north, no compass" : Sky.relPhrase(g.bearing - (c.heading ?? 0)))
                .font(.system(size: 17, weight: .semibold)).foregroundStyle(k.tint)
        }
        .frame(maxWidth: .infinity)
    }

    private func row(_ t: SkyTarget) -> some View {
        let k = SkyKind(t.s.kind)
        let on = t.id == c.selected?.id
        let g = c.geometry(for: t.s)
        return Button { c.select(t.id) } label: {
            HStack(spacing: 12) {
                SkyChip(kind: k, size: 32)
                VStack(alignment: .leading, spacing: 1) {
                    Text(t.s.label).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                    Text("\(t.s.line1) · \(t.s.owner)").font(.system(size: 13)).foregroundStyle(Color.white.opacity(0.6)).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                Text(Sky.miText(g.miles)).font(.system(size: 15, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(Color.white.opacity(0.85)).fixedSize()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 60)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(on ? k.tint.opacity(0.16) : Color.white.opacity(0.06)))
            .overlay { if on { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(k.tint.opacity(0.45), lineWidth: 1) } }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
