// Bestly Admin: Today (matches the approved Main screen). Pull to refresh; also refreshes on foreground and every 2 minutes.
import SwiftUI

struct TodayView: View {
    @StateObject private var model = TodayModel()
    @ObservedObject private var state = AdminState.shared
    @Environment(\.scenePhase) private var phase
    @State private var webSheet: WebTarget?

    struct WebTarget: Identifiable { var id: String { path }; var path: String; var title: String }

    var body: some View {
        NavigationStack {
            ZStack {
                AT.bg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 14) {
                        header
                        if let s = model.stuck { stuckCard(s) } else if model.stuckFailed { oneLine("Couldn't load what's stuck. Retrying.") }
                        moneyCard
                        turoCard
                        myDayCard
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
                .refreshable { await model.load() }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .task {
            await model.load()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 120_000_000_000)
                if phase == .active { await model.load() }
            }
        }
        .onChange(of: phase) { _, p in if p == .active { Task { await model.load() } } }
        .sheet(item: $webSheet) { t in
            NavigationStack { AdminWebScreen(title: t.title, url: Self.url(t.path), showsTitle: true) }
                .preferredColorScheme(.dark)
        }
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15)).foregroundStyle(AT.text)
                    .padding(.horizontal, 16).frame(minHeight: 44)
                    .background(AT.inner, in: Capsule())
                    .padding(.bottom, 12)
                    .task { try? await Task.sleep(nanoseconds: 3_000_000_000); model.toast = nil }
            }
        }
    }

    static func url(_ path: String) -> URL {
        if path.hasPrefix("http"), let u = URL(string: path) { return u }
        return URL(string: AdminConfig.adminBase + (path.hasPrefix("/") ? path : "/" + path)) ?? AdminWeb.adminURL("/admin")
    }

    // MARK: header

    private var header: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 2) {
                Text(AdminFmt.header.string(from: Date()).uppercased())
                    .font(.system(size: 13, weight: .semibold)).tracking(0.3).foregroundStyle(AT.secondary)
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text("Today").font(.system(size: 34, weight: .bold)).foregroundStyle(AT.text)
            }
            Spacer(minLength: 8)
            Button { webSheet = WebTarget(path: "/admin/overview", title: "Status") } label: {
                HStack(spacing: 8) {
                    Circle().fill(healthColor).frame(width: 9, height: 9).shadow(color: healthColor.opacity(0.45), radius: 5)
                    Text(healthText).font(.system(size: 13)).foregroundStyle(Color(white: 0.83)).lineLimit(1).minimumScaleFactor(0.8)
                }
                .padding(.horizontal, 14).frame(minHeight: 44)
                .background(AT.card, in: Capsule())
            }
            .accessibilityLabel("System health: \(healthText)")
        }
        .padding(.top, 8)
    }

    private var healthColor: Color {
        guard model.healthKnown else { return AT.secondary }
        return model.health.issues == 0 ? AT.green : (model.health.red ? AT.red : AT.orange)
    }
    private var healthText: String {
        guard model.healthKnown else { return "Checking" }
        let n = model.health.issues
        return n == 0 ? "All good" : (n == 1 ? "1 issue" : "\(n) issues")
    }

    // MARK: stuck

    private func stuckCard(_ s: StuckSummary) -> some View {
        let working = s.actionStatus == "working" || model.fixing
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "clock").foregroundStyle(AT.orange).font(.system(size: 18, weight: .semibold))
                Text(s.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.text).lineLimit(2).minimumScaleFactor(0.85)
                Spacer(minLength: 6)
                if let since = s.since {
                    Text(Self.age(since)).font(.system(size: 13)).foregroundStyle(AT.hex(0xFDBA74)).lineLimit(1)
                }
            }
            if !s.sentence.isEmpty {
                Text(s.sentence).font(.system(size: 15)).foregroundStyle(AT.hex(0xE4E4E7)).fixedSize(horizontal: false, vertical: true)
            }
            if let note = s.actionNote, s.actionStatus != nil {
                Text(note).font(.system(size: 13)).foregroundStyle(AT.hex(0xFDBA74)).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                Button { Task { await model.runFix() } } label: {
                    HStack(spacing: 6) {
                        if working { ProgressView().tint(Color.black) }
                        Text(working ? "Working" : (s.actionStatus == "failed" ? "Try again" : "Run fix")).font(.system(size: 15, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(AT.orange, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .foregroundStyle(AT.hex(0x1A0E05))
                }
                .disabled(working)
                Button { webSheet = WebTarget(path: s.link ?? "/admin/overview", title: "Details") } label: {
                    Text("Show me").font(.system(size: 15))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .foregroundStyle(AT.text)
                }
            }
            Text("From \(s.employee)").font(.system(size: 12)).foregroundStyle(AT.hex(0xFDBA74))
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AT.hex(0x2A1A10), in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: AT.radius, style: .continuous).stroke(AT.orange.opacity(0.22), lineWidth: 1))
    }

    private static func age(_ d: Date) -> String {
        let m = max(1, Int(Date().timeIntervalSince(d) / 60))
        if m < 60 { return "\(m)\u{00A0}min" }
        let h = m / 60
        if h < 48 { return "\(h)\u{00A0}hr" }
        return "\(h / 24)\u{00A0}days"
    }

    // MARK: money

    private var moneyCard: some View {
        ATCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("MONEY").font(.system(size: 13, weight: .semibold)).tracking(0.3).foregroundStyle(AT.secondary)
                    Spacer()
                    Text("Mercury, read only").font(.system(size: 12)).foregroundStyle(AT.secondary)
                }
                if let m = model.money {
                    Text(AdminFmt.usd(m.total))
                        .font(.system(size: 40, weight: .bold)).monospacedDigit().foregroundStyle(AT.text)
                        .lineLimit(1).minimumScaleFactor(0.6)
                    HStack(spacing: 8) {
                        deltaTile("In, last 30\u{00A0}days", AdminFmt.usd(m.inDelta, signed: true), AT.lime)
                        deltaTile("Out, last 30\u{00A0}days", AdminFmt.usd(-abs(m.outDelta), signed: true), AT.peach)
                    }
                } else {
                    Text(model.moneyFailed ? "Couldn't load money. Retrying." : "Loading money")
                        .font(.system(size: 15)).foregroundStyle(AT.secondary)
                }
            }
        }
    }

    private func deltaTile(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 12)).foregroundStyle(AT.secondary).lineLimit(1).minimumScaleFactor(0.8)
            Text(value).font(.system(size: 20, weight: .semibold)).monospacedDigit().foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.6)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AT.inner, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: turo strip

    @ViewBuilder private var turoCard: some View {
        if let t = model.turo {
            Button { state.tab = 3 } label: {
                HStack(spacing: 12) {
                    QuarterRing(stage: t.stage, tint: t.tint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(t.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.text).lineLimit(2).minimumScaleFactor(0.85)
                        Text(t.line).font(.system(size: 13)).foregroundStyle(AT.secondary).lineLimit(2).minimumScaleFactor(0.85)
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(AT.hex(0x71717A))
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .frame(maxWidth: .infinity, minHeight: 68, alignment: .leading)
                .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
            }
            .buttonStyle(.plain)
        } else if model.turoFailed {
            oneLine("Couldn't load Turo. Retrying.")
        }
    }

    // MARK: my day

    private var myDayCard: some View {
        ATCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Text("MY DAY").font(.system(size: 13, weight: .semibold)).tracking(0.3).foregroundStyle(AT.secondary)
                    Spacer()
                    Text("West Hollywood" + (model.nowTempF.map { " \($0)\u{00A0}\u{00B0}F" } ?? ""))
                        .font(.system(size: 13)).foregroundStyle(AT.secondary).lineLimit(1).minimumScaleFactor(0.8)
                }
                if model.hours.isEmpty {
                    Text(model.weatherFailed ? "Couldn't load the weather. Retrying." : "Loading the weather")
                        .font(.system(size: 15)).foregroundStyle(AT.secondary)
                } else {
                    HStack(alignment: .bottom, spacing: 4) {
                        let temps = model.hours.map { $0.tempF }
                        let lo = temps.min() ?? 0, hi = max(temps.max() ?? 1, lo + 1)
                        ForEach(model.hours) { h in
                            VStack(spacing: 6) {
                                Text(h.label).font(.system(size: 12)).foregroundStyle(AT.secondary).lineLimit(1).minimumScaleFactor(0.7)
                                ZStack(alignment: .bottom) {
                                    Color.clear.frame(height: 56)
                                    Capsule()
                                        .fill(LinearGradient(colors: [AT.peach.opacity(0.15), AT.peach], startPoint: .bottom, endPoint: .top))
                                        .frame(width: 10, height: 20 + 36 * CGFloat(h.tempF - lo) / CGFloat(hi - lo))
                                }
                                Text("\(h.tempF)\u{00B0}").font(.system(size: 15, weight: .semibold)).monospacedDigit().foregroundStyle(AT.text)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                }
                VStack(spacing: 6) {
                    if model.events.isEmpty {
                        Text(model.eventsFailed ? "Couldn't load the calendar. Retrying." : "Nothing else on the calendar.")
                            .font(.system(size: 15)).foregroundStyle(AT.secondary)
                    }
                    ForEach(model.events) { e in
                        HStack(spacing: 10) {
                            RoundedRectangle(cornerRadius: 2).fill(AT.lavender).frame(width: 4, height: 28)
                            Text(e.title).font(.system(size: 15)).foregroundStyle(AT.text).lineLimit(2).minimumScaleFactor(0.85)
                            Spacer(minLength: 6)
                            Text(glue(e.when)).font(.system(size: 13)).foregroundStyle(AT.secondary).lineLimit(1).minimumScaleFactor(0.8)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(AT.inner, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }
        }
    }

    private func oneLine(_ s: String) -> some View {
        Text(s).font(.system(size: 15)).foregroundStyle(AT.secondary)
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
    }
}

/// Four quadrants around a car: filled count = stage.
struct QuarterRing: View {
    var stage: Int
    var tint: Color
    var body: some View {
        ZStack {
            Circle().stroke(AT.ringTrack, lineWidth: 3.5)
            ForEach(0..<4, id: \.self) { i in
                if i < stage {
                    Circle()
                        .trim(from: CGFloat(i) * 0.25 + 0.012, to: CGFloat(i + 1) * 0.25 - 0.012)
                        .stroke(tint, style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
            }
            Image(systemName: "car.fill").font(.system(size: 15)).foregroundStyle(AT.text)
        }
        .frame(width: 44, height: 44)
        .accessibilityLabel(stage == 0 ? "No trip in progress" : "Trip stage \(stage) of 4")
    }
}
