// Bestly Admin: the Home Assistant automations card (newest-run first, with switches) and the full searchable list.
import SwiftUI

struct HomeAutomationsCard: View {
    @ObservedObject var m: HomeModel

    var body: some View {
        ATCard {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    TLabel("Automations")
                    Spacer(minLength: 8)
                    TSub(m.autosLoaded ? "\(m.autos.count) total" : "")
                }
                .padding(.bottom, 6)
                if !m.autosLoaded {
                    TLoadingLine(text: "Loading automations").padding(.vertical, 8)
                } else if m.autos.isEmpty {
                    TSub("No automations came back from Home Assistant.").padding(.vertical, 8)
                }
                ForEach(m.autos.prefix(4)) { a in
                    Rectangle().fill(Color.white.opacity(0.05)).frame(height: 1)
                    HomeAutoRow(m: m, a: a)
                }
                if let n = m.notice { TSub(n, color: AT.orange).padding(.top, 8) }
                if m.autos.count > 4 {
                    NavigationLink { HomeAutomationsList(m: m) } label: {
                        HStack {
                            Text("See all \(m.autos.count)")
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(AT.hex(0x71717A))
                        }
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.text)
                        .padding(.horizontal, 14).frame(maxWidth: .infinity, minHeight: 44)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .padding(.top, 6)
                }
            }
        }
    }
}

struct HomeAutoRow: View {
    @ObservedObject var m: HomeModel
    var a: HomeAuto

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(a.name).font(.system(size: 15)).foregroundStyle(AT.text).fixedSize(horizontal: false, vertical: true)
                TSub(HomeModel.ranText(a.lastRun))
            }
            Spacer(minLength: 8)
            TSwitch(isOn: Binding(get: { m.isOn(a) }, set: { _ in }), label: "\(a.name) \(m.isOn(a) ? "on" : "off")") { v in
                Task { await m.toggle(a, to: v) }
            }
        }
        .padding(.vertical, 8)
        .frame(minHeight: 56)
    }
}

struct HomeAutomationsList: View {
    @ObservedObject var m: HomeModel
    @State private var query = ""

    private var shown: [HomeAuto] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? m.autos : m.autos.filter { $0.name.lowercased().contains(q) }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if let n = m.notice { TSub(n, color: AT.orange).padding(16) }
                if shown.isEmpty { TSub("Nothing matches that.").padding(16) }
                ForEach(Array(shown.enumerated()), id: \.element.id) { i, a in
                    if i > 0 { Rectangle().fill(Color.white.opacity(0.05)).frame(height: 1) }
                    HomeAutoRow(m: m, a: a).padding(.horizontal, 16)
                }
            }
            .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
            .padding(16)
        }
        .tScreen("Automations")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search automations")
        .refreshable { await m.load() }
        .screenView("home")
    }
}
