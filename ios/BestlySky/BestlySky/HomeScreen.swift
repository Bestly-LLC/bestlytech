// Bestly Admin: Home (matches the approved Home screen): Hestia status, callbox, automations, Tinker.
import SwiftUI

struct HomeScreen: View {
    @StateObject var m = HomeModel()
    @StateObject var tinker = HomeTinkerModel()
    @Environment(\.scenePhase) private var phase
    @State var showExpect = false
    @State var showHistory = false
    @State var showPartyPicker = false
    @State var showFix = false

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                agentCard
                callboxCard
                HomeAutomationsCard(m: m)
                HomeTinkerCard(t: tinker, showFix: $showFix)
            }
            .padding(.horizontal, 16).padding(.bottom, 24)
        }
        .refreshable { await m.load(); await tinker.refresh() }
        .tScreen("Home")
        .task {
            await m.load()
            await tinker.refresh()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if phase == .active { await m.load() }
            }
        }
        .sheet(isPresented: $showExpect) { HomeExpectSheet(m: m).preferredColorScheme(.dark) }
        .sheet(isPresented: $showHistory) { HomeDoorHistorySheet(m: m).preferredColorScheme(.dark) }
        .sheet(isPresented: $showFix) { HomeFixSheet(t: tinker).preferredColorScheme(.dark) }
        .confirmationDialog("How long is the party?", isPresented: $showPartyPicker, titleVisibility: .visible) {
            Button("1 hour") { Task { await m.startParty(until: Date().addingTimeInterval(3600)) } }
            Button("2 hours") { Task { await m.startParty(until: Date().addingTimeInterval(7200)) } }
            Button("4 hours") { Task { await m.startParty(until: Date().addingTimeInterval(14400)) } }
            Button("Tonight") { Task { await m.startParty(until: Self.tonight()) } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("The door opens for everyone until then.") }
        .tToast($m.toast)
        .screenView("home")
    }

    static func tonight() -> Date {
        var c = Calendar(identifier: .gregorian); c.timeZone = AdminFmt.la
        let t = c.date(bySettingHour: 23, minute: 59, second: 0, of: Date()) ?? Date().addingTimeInterval(3600)
        return max(t, Date().addingTimeInterval(3600))
    }

    // MARK: Hestia

    private var agentCard: some View {
        ATCard {
            HStack(spacing: 12) {
                Circle().fill(dotColor).frame(width: 10, height: 10).shadow(color: dotColor.opacity(0.45), radius: 5)
                VStack(alignment: .leading, spacing: 2) {
                    Text(agentTitle).font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.text)
                    TSub(agentLine)
                }
                Spacer(minLength: 0)
            }
        }
        .accessibilityElement(children: .combine)
    }
    private var dotColor: Color { m.agent == nil ? AT.secondary : (m.agentOnline ? AT.green : AT.red) }
    private var agentTitle: String {
        if m.agent == nil { return m.agentFailed ? "Couldn't reach Hestia's status" : "Checking Hestia" }
        return "\(m.host) is \(m.agentOnline ? "online" : "offline")"
    }
    private var agentLine: String {
        guard let seen = m.lastSeen else { return m.agentFailed ? "Retrying" : "One moment" }
        return "Checked in \(TKit.ago(seen)) ago" + (m.agentVersion.map { " \u{00B7} agent \($0)" } ?? "")
    }

    // MARK: callbox

    private var callboxCard: some View {
        ATCard {
            VStack(alignment: .leading, spacing: 12) {
                if m.settings == nil {
                    TLabel("Callbox")
                    TLoadingLine(text: m.callboxFailed ? "Couldn't load the callbox. Retrying." : "Loading the callbox")
                } else {
                    HStack {
                        TLabel("Callbox" + (m.unitCode.map { " \u{00B7} unit \($0)" } ?? ""))
                        Spacer(minLength: 8)
                        TSwitch(isOn: Binding(get: { m.enabled }, set: { _ in }), label: m.enabled ? "Callbox on" : "Callbox off") { v in
                            Task { await m.patch(["enabled": v]) { $0["enabled"] = v } }
                        }
                    }
                    TSegments(options: ["Smart", "Ask", "Party", "Off"], selection: Binding(get: { Self.modes.firstIndex(of: m.mode) ?? 0 }, set: { _ in })) { i in
                        let mode = Self.modes[i]
                        if mode == "party" { showPartyPicker = true } else { Task { await m.setMode(mode) } }
                    }
                    Text(m.modeLine()).font(.system(size: 13)).foregroundStyle(Color(white: 0.79)).fixedSize(horizontal: false, vertical: true)
                    if m.partyLive {
                        Button { Task { await m.setMode("smart") } } label: { Text("End the party") }.buttonStyle(.tbtn)
                    }
                    ForEach(Array(m.liveExpected.enumerated()), id: \.offset) { _, e in expectedRow(e) }
                    HStack(spacing: 8) {
                        Button { showExpect = true } label: { Text("Expect someone") }.buttonStyle(.tbtn)
                        Button { showHistory = true } label: { Text("Door history") }.buttonStyle(.tbtn)
                    }
                    TSub(expectedSummary + " \u{00B7} " + m.selfTestWords)
                }
            }
        }
    }

    static let modes = ["smart", "ask", "party", "off"]

    private var expectedSummary: String {
        let n = m.liveExpected.count
        return n == 0 ? "No one expected right now" : "\(n) expected"
    }

    private func expectedRow(_ e: JSON) -> some View {
        let until = AdminFmt.date(e.str("window_end")).map { TKit.clock($0) }
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(e.str("label") ?? "Someone").font(.system(size: 15)).foregroundStyle(AT.text)
                if let until { TSub("Until \(until)") }
            }
            Spacer(minLength: 8)
            Button { Task { await m.cancelExpected(e) } } label: { Text("Cancel").font(.system(size: 14, weight: .semibold)).foregroundStyle(AT.orange).frame(minWidth: 60, minHeight: 44) }
                .accessibilityLabel("Cancel expecting \(e.str("label") ?? "someone")")
        }
        .padding(.horizontal, 12)
        .background(AT.inner, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
