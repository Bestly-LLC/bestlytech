// Bestly Admin: Agents (matches the approved Agents screen). Ava opens her inbox; Maya, Reese, Leo and the rest show their call log below.
import SwiftUI

struct AgentsScreen: View {
    @StateObject private var m = AgentsModel()
    @ObservedObject private var ava = AvaStore.shared
    @Environment(\.scenePhase) private var phase
    @State private var showAva = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                agentList
                callsHeader
                filterBar
                callList
            }
            .padding(.horizontal, 16).padding(.bottom, 24)
        }
        .refreshable { await m.refresh() }
        .tScreen("Agents")
        .task {
            await m.loadAgents()
            await m.loadCalls()
            await ava.refresh()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                if phase == .active { await m.refresh() }
            }
        }
        .sheet(isPresented: $showAva) { AvaInboxView().preferredColorScheme(.dark) }
        .screenView("agents")
    }

    // MARK: agent list

    private var agentList: some View {
        VStack(spacing: 0) {
            if m.agents.isEmpty {
                TLoadingLine(text: m.agentsFailed ? "Couldn't load the agents. Retrying." : "Loading the agents").padding(16)
            }
            ForEach(Array(m.agents.enumerated()), id: \.element.slug) { i, g in
                if i > 0 { Rectangle().fill(Color.white.opacity(0.05)).frame(height: 1).padding(.leading, 68) }
                Button {
                    Haptics.tap()
                    if g.isAva { showAva = true } else { Task { await m.select(g.slug) } }
                } label: { agentRow(g) }
                .buttonStyle(.plain)
            }
        }
        .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
    }

    private func agentRow(_ g: AgentInfo) -> some View {
        let count = g.isAva ? ava.unreadCount : g.unread
        let picked = !g.isAva && g.slug == m.selected
        return HStack(spacing: 12) {
            Circle()
                .fill(RadialGradient(colors: [g.hi, g.lo], center: UnitPoint(x: 0.35, y: 0.3), startRadius: 0, endRadius: 28))
                .frame(width: 40, height: 40)
                .shadow(color: g.lo.opacity(0.5), radius: 8)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(g.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(AT.text)
                TSub(g.what)
            }
            Spacer(minLength: 8)
            if count > 0 { Text("\(count) new").font(.system(size: 13, weight: .semibold)).foregroundStyle(g.lo).fixedSize() }
            Image(systemName: g.isAva ? "chevron.right" : (picked ? "chevron.down" : "chevron.right"))
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(AT.hex(0x71717A))
        }
        .padding(.horizontal, 16).frame(minHeight: 64)
        .background(picked ? Color.white.opacity(0.04) : Color.clear)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(g.name), \(g.what)" + (count > 0 ? ", \(count) new" : ""))
    }

    // MARK: calls

    private var callsHeader: some View {
        HStack {
            TLabel("\(m.selectedAgent?.name ?? "Agent") \u{00B7} calls")
            Spacer(minLength: 8)
            if m.callsLoaded { TSub(m.calls.count >= 50 ? "Latest 50" : (m.calls.count == 1 ? "1 call" : "\(m.calls.count) calls")) }
        }
        .padding(.top, 4)
    }

    private var filterBar: some View {
        let unread = m.selectedAgent?.unread ?? 0
        let names = [unread > 0 ? "Unread \(unread)" : "Unread", "All", "Archived"]
        return HStack(spacing: 8) {
            ForEach(Array(names.enumerated()), id: \.offset) { i, n in
                Button {
                    Haptics.select(); m.filter = i; m.callsLoaded = false; Task { await m.loadCalls() }
                } label: {
                    Text(n).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(m.filter == i ? AT.bg : Color(white: 0.83))
                        .padding(.horizontal, 14).frame(minHeight: 44)
                        .background(m.filter == i ? AT.text : AT.card, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(m.filter == i ? .isSelected : [])
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder private var callList: some View {
        let agent = m.selectedAgent
        VStack(spacing: 0) {
            if !m.callsLoaded {
                TLoadingLine(text: m.callsFailed ? "Couldn't load the calls. Retrying." : "Loading the calls").padding(16).frame(maxWidth: .infinity, alignment: .leading)
            } else if m.calls.isEmpty {
                TSub(emptyText).padding(16).frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(Array(m.calls.enumerated()), id: \.element.id) { i, c in
                if i > 0 { Rectangle().fill(Color.white.opacity(0.05)).frame(height: 1) }
                if let agent {
                    NavigationLink { CallDetailView(agent: agent, call: c) { Task { await m.refresh() } } } label: { callRow(c, agent) }
                        .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 16)
        .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
    }

    private var emptyText: String {
        if m.selected == "reese" && m.filter == 2 { return "Archived Reese calls stay in the web admin." }
        return ["Nothing unread. You're caught up.", "No calls yet.", "No archived calls."][m.filter]
    }

    private func callRow(_ c: AgentCall, _ a: AgentInfo) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(c.unread ? a.hi : Color.clear).frame(width: 8, height: 8).padding(.top, 7).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(c.who).font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.text).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 6)
                    if let at = c.at { Text(TKit.when(at)).font(.system(size: 13)).foregroundStyle(AT.secondary).fixedSize() }
                }
                TSub(c.meta)
                if !c.summary.isEmpty {
                    Text(c.summary).font(.system(size: 14)).foregroundStyle(Color(white: 0.83)).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(c.unread ? "Unread. " : "")\(c.who). \(c.meta). \(c.summary)")
    }
}
