// Bestly Admin: Turo (matches the approved Turo screen). Blue Steel is the only car.
// Refreshes on appear and every 60 sec while the screen is showing.
import SwiftUI
import UIKit

struct TuroScreen: View {
    @StateObject private var m = TuroModel()
    @Environment(\.scenePhase) private var phase
    @State private var showCode = false
    @State private var copied = false

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                HStack { TSub("Blue Steel \u{00B7} 2020 Model 3"); Spacer(minLength: 0) }
                if m.loadFailed { TSub("Couldn't load the car. Retrying.", color: AT.orange).frame(maxWidth: .infinity, alignment: .leading) }
                batteryCard
                climateCard
                tripCard
                laxCard
                claimsCard
            }
            .padding(.horizontal, 16).padding(.bottom, 24)
        }
        .refreshable { await m.load() }
        .tScreen("Turo")
        .task {
            await m.load()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                if phase == .active { await m.load() }
            }
        }
        .sheet(isPresented: $showCode) { TuroCodeSheet(m: m).preferredColorScheme(.dark) }
        .tToast($m.toast)
        .screenView("turo")
    }

    // MARK: battery

    private var batteryCard: some View {
        ATCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        TLabel("Battery")
                        Text(m.battery.map { "\($0)%" } ?? "--").font(.system(size: 40, weight: .bold)).foregroundStyle(AT.text)
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(m.rangeMi.map { "\($0)\u{00A0}mi" } ?? "--").font(.system(size: 20, weight: .semibold)).foregroundStyle(AT.text)
                        TSub("real-world range")
                    }
                }
                batteryBar
                FlowPills(items: pills)
                lastSeen
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var batteryBar: some View {
        let frac = CGFloat(min(100, max(0, m.battery ?? 0))) / 100
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(AT.ringTrack)
                Capsule()
                    .fill(LinearGradient(colors: [AT.hex(0x8FBF4A), AT.lime], startPoint: .leading, endPoint: .trailing))
                    .frame(width: max(10, geo.size.width * frac))
                    .shadow(color: AT.lime.opacity(0.45), radius: 6)
            }
        }
        .frame(height: 10)
        .accessibilityLabel("Battery \(m.battery ?? 0) percent")
    }

    private var pills: [String] {
        var p: [String] = []
        if let l = m.locked { p.append(l ? "Locked" : "Unlocked") }
        p.append(m.chargingNow ? "Charging" : (m.pluggedIn ? "Plugged in" : "Not plugged in"))
        if let i = m.insideF { p.append("Inside \(i)\u{00A0}\u{00B0}F") }
        if let o = m.outsideF { p.append("Outside \(o)\u{00A0}\u{00B0}F") }
        if m.climateOn { p.append("A/C on") }
        return p
    }

    @ViewBuilder private var lastSeen: some View {
        if let seen = m.observed {
            let text = "Last seen \(TKit.ago(seen)) ago" + (m.stale ? ". The reading may be out of date." : "")
            TSub(text, color: m.stale ? AT.orange : AT.secondary)
        } else {
            TSub("No reading from the car yet")
        }
    }

    // MARK: climate

    private var climateCard: some View {
        ATCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    TLabel("Climate")
                    Spacer(minLength: 8)
                    Label("Face ID to send", systemImage: "faceid").font(.system(size: 13)).foregroundStyle(AT.secondary)
                }
                HStack(spacing: 8) {
                    Button { Task { await m.send(.cool) } } label: {
                        VStack(spacing: 2) {
                            Text("Cool it down")
                            Text("68\u{00A0}\u{00B0}F, 20\u{00A0}min").font(.system(size: 12, weight: .medium))
                        }
                        .frame(minHeight: 64)
                    }
                    .buttonStyle(TBtnStyle(fill: AT.sky.opacity(0.12), fg: AT.hex(0xDDF0FF)))
                    Button { Task { await m.send(.off) } } label: { Text("A/C off").frame(minHeight: 64) }
                        .buttonStyle(.tbtn)
                    Button { Task { await m.send(.refresh) } } label: { Text("Read the car").frame(minHeight: 64) }
                        .buttonStyle(.tbtn)
                }
                .disabled(isWorking)
                cmdLine
            }
        }
    }

    private var isWorking: Bool { if case .working = m.cmd { return true } else { return false } }

    @ViewBuilder private var cmdLine: some View {
        switch m.cmd {
        case .idle:
            EmptyView()
        case .working(let t):
            HStack(spacing: 8) { ProgressView().tint(AT.secondary); Text(t).font(.system(size: 13)).foregroundStyle(Color(white: 0.79)) }
        case .ok(let t):
            statusLine(t, AT.green)
        case .failed(let t):
            statusLine(t, AT.red)
        }
    }

    private func statusLine(_ t: String, _ c: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle().fill(c).frame(width: 8, height: 8)
            Text(t).font(.system(size: 13)).foregroundStyle(Color(white: 0.79)).fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: trip

    private var tripCard: some View {
        let t = m.trip
        return ATCard {
            HStack(spacing: 14) {
                TuroTripRing(stage: t.stage)
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.text).fixedSize(horizontal: false, vertical: true)
                    TSub(t.line)
                    if let w = t.warn { TSub(w, color: AT.orange) }
                }
                Spacer(minLength: 0)
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: LAX code

    private var laxCard: some View {
        ATCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    TLabel("LAX garage code")
                    Spacer(minLength: 8)
                    if m.lax != nil {
                        Text(m.laxLive ? "Live for guests" : "Needs \(m.laxMonthName)\u{2019}s code")
                            .font(.system(size: 13)).foregroundStyle(m.laxLive ? AT.lime : AT.orange)
                    }
                }
                if let link = m.laxLink {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(m.laxMonthName) code \u{00B7} guests use").font(.system(size: 15)).foregroundStyle(AT.text)
                        Text(link).font(.system(size: 15)).foregroundStyle(AT.lime)
                    }
                    if !m.laxLive { TSub("Add the new code so guests get the right one.", color: AT.orange) }
                } else {
                    TSub(m.loadedOnce ? "Couldn't load the garage code status. Pull down to try again." : "Loading the garage code status", color: m.loadedOnce ? AT.orange : AT.secondary)
                }
                HStack(spacing: 8) {
                    Button { showCode = true } label: { Text("Update code") }.buttonStyle(.tbtn)
                    Button { copyLink() } label: { Text(copied ? "Copied" : "Copy link") }.buttonStyle(.tbtn).disabled(m.laxSlug == nil)
                }
            }
        }
    }

    private func copyLink() {
        guard let s = m.laxSlug else { return }
        UIPasteboard.general.string = "https://www.bestly.tech/lax/\(s)"
        Haptics.ok(); copied = true
        Task { try? await Task.sleep(nanoseconds: 2_000_000_000); copied = false }
    }

    // MARK: claims

    private var claimsCard: some View {
        ATCard {
            VStack(alignment: .leading, spacing: 12) {
                TLabel("Claims Closer")
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                    claimTile(m.claimsLoaded ? "\(m.waitingOnGuest)" : "--", "Waiting on the guest")
                    claimTile(m.claimsLoaded ? "\(m.cleaningOpen)" : "--", "Cleaning reports")
                    claimTile(m.claimsLoaded ? "\(m.paid)" : "--", "Paid")
                    claimTile(m.claimsLoaded ? "\(m.closed)" : "--", "Closed")
                }
            }
        }
    }

    private func claimTile(_ n: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(n).font(.system(size: 20, weight: .semibold)).foregroundStyle(AT.text)
            TSub(label)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AT.inner, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Wrapping row of pills.
struct FlowPills: View {
    var items: [String]
    var body: some View {
        TFlow(spacing: 6) { ForEach(items, id: \.self) { TPill($0) } }
    }
}

struct TFlow: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > 0 && x + sz.width > w { x = 0; y += rowH + spacing; rowH = 0 }
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
        return CGSize(width: w, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + sz.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
    }
}

/// Four-quadrant ring: one quadrant per stage reached (same look as the Today trip ring, larger).
struct TuroTripRing: View {
    var stage: Int
    var body: some View {
        ZStack {
            Circle().stroke(AT.ringTrack, lineWidth: 3.5)
            ForEach(0..<4, id: \.self) { i in
                if i < stage {
                    Circle()
                        .trim(from: CGFloat(i) * 0.25 + 0.012, to: CGFloat(i + 1) * 0.25 - 0.012)
                        .stroke(AT.sky, style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
            }
            Image(systemName: "car.fill").font(.system(size: 17)).foregroundStyle(stage > 0 ? AT.sky : AT.secondary)
        }
        .frame(width: 48, height: 48)
        .accessibilityLabel(stage == 0 ? "No trip in progress" : "Trip stage \(stage) of 4")
    }
}
