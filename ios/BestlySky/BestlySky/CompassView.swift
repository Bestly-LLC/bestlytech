// The in-app view: a TRUE compass arrow to the plane on the wall's name tag, from wherever the phone is.
// (The Live Activity can only show the bearing from home relative to north; turning with the phone needs the app open.)
import CoreLocation
import SwiftUI

@MainActor
final class Compass: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var heading: Double?          // degrees true
    @Published var here: CLLocation?
    @Published var state: AircraftAttributes.ContentState?
    @Published var updatedAt: Date?
    @Published var error: String?
    private let lm = CLLocationManager()
    private var poll: Task<Void, Never>?

    override init() {
        super.init()
        lm.delegate = self
        lm.headingFilter = 2
        lm.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func start() {
        if lm.authorizationStatus == .notDetermined { lm.requestWhenInUseAuthorization() }
        lm.startUpdatingLocation()
        if CLLocationManager.headingAvailable() { lm.startUpdatingHeading() }
        poll?.cancel()
        poll = Task { [weak self] in
            while !Task.isCancelled {
                await self?.fetch()
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }

    func stop() {
        poll?.cancel()
        lm.stopUpdatingHeading()
        lm.stopUpdatingLocation()
    }

    private func fetch() async {
        do {
            let r = try await SkyAPI.post(["op": "current"])
            if let st = r["state"], !(st is NSNull) {
                let data = try JSONSerialization.data(withJSONObject: st)
                state = try JSONDecoder().decode(AircraftAttributes.ContentState.self, from: data)
            } else {
                state = nil
            }
            updatedAt = Date()
            error = nil
        } catch {
            self.error = "Can't reach the wall right now"
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateHeading h: CLHeading) {
        let v = h.trueHeading >= 0 ? h.trueHeading : h.magneticHeading
        Task { @MainActor in self.heading = v }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard let l = locs.last else { return }
        Task { @MainActor in self.here = l }
    }
}

struct CompassView: View {
    @StateObject private var c = Compass()
    @ObservedObject private var sync = TokenSync.shared
    @Environment(\.scenePhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    if let s = c.state {
                        let tint = Color(skyHex: s.tint)
                        let (brg, mi) = target(s)
                        let rel = brg - (c.heading ?? 0)
                        ZStack {
                            Circle().stroke(.white.opacity(0.12), lineWidth: 2)
                            Circle().fill(tint.opacity(0.14)).padding(28)
                            Image(systemName: "location.north.fill")
                                .font(.system(size: 96, weight: .bold))
                                .foregroundStyle(tint)
                                .rotationEffect(.degrees(rel))
                                .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.8), value: rel)
                        }
                        .frame(width: 260, height: 260)
                        .accessibilityElement()
                        .accessibilityLabel("Arrow pointing to \(s.flight)")
                        .accessibilityValue(c.heading == nil ? "Bearing \(Int(brg)) degrees from north" : "Turn \(Int((rel + 540).truncatingRemainder(dividingBy: 360) - 180)) degrees")

                        VStack(spacing: 4) {
                            Text(Sky.dist(mi)).font(.system(size: 44, weight: .bold, design: .rounded)).monospacedDigit()
                            Text(c.heading == nil ? "Bearing from north · no compass" : (c.here == nil ? "From home" : "From you"))
                                .font(.subheadline).foregroundStyle(.secondary)
                        }

                        LockScreenAircraft(s: s, stale: false)
                            .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Color.white.opacity(0.08)))
                    } else {
                        ContentUnavailableView("No plane on the wall", systemImage: "airplane",
                                               description: Text("When the wall tags a plane, it shows up here and on your Lock Screen."))
                            .padding(.top, 60)
                    }
                    if let e = c.error { Label(e, systemImage: "wifi.exclamationmark").font(.footnote).foregroundStyle(.orange) }
                    Text("Live Activity: \(sync.lastRegistered)").font(.footnote).foregroundStyle(.secondary)
                }
                .padding(20)
            }
            .navigationTitle("Sky")
        }
        .onAppear { c.start() }
        .onChange(of: phase) { _, p in if p == .active { c.start() } else { c.stop() } }
    }

    /// Bearing + distance from the phone when we know where it is and the plane's position; else from home.
    private func target(_ s: AircraftAttributes.ContentState) -> (Double, Double) {
        if let here = c.here, let la = s.lat, let lo = s.lon {
            let a = here.coordinate
            return (Sky.bearing(a.latitude, a.longitude, la, lo), Sky.miles(a.latitude, a.longitude, la, lo))
        }
        return (s.bearing, s.distMi)
    }
}
