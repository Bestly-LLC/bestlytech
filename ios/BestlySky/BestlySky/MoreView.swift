// Bestly Admin: More (matches the approved More screen). Four native tiles, the web admin list, the sky compass, sign out.
import SwiftUI

struct MoreView: View {
    @ObservedObject private var auth = AdminAuth.shared
    @ObservedObject private var state = AdminState.shared
    @State private var confirmSignOut = false

    private struct Tile: Identifiable { var id: String { name }; var name: String; var line: String; var tint: Color; var icon: String }
    private let tiles = [
        Tile(name: "Home", line: "Wall, callbox, automations", tint: AT.sky, icon: "house.fill"),
        Tile(name: "Studio", line: "Review and approve posts", tint: AT.peach, icon: "play.rectangle.fill"),
        Tile(name: "AI Team", line: "Who is working, who is stuck", tint: AT.lime, icon: "checkmark.shield.fill"),
        Tile(name: "Agents", line: "Ava, Maya and Reese", tint: AT.lavender, icon: "phone.fill"),
    ]
    private let web: [(String, String)] = [
        ("Sky map", "/admin/sky"), ("Claims Closer", "/admin/claims"), ("Google Voice", "/admin/skytouch"),
        ("Street sweeping", "/admin/street-sweeping"), ("Plug Puller", "/admin/turo"), ("Pipeline", "/admin/pipeline"),
    ]

    var body: some View {
        NavigationStack {
            ZStack {
                AT.bg.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("More").font(.system(size: 34, weight: .bold)).foregroundStyle(AT.text).padding(.top, 8)
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                            ForEach(tiles) { t in
                                NavigationLink { destination(for: t.name) } label: { tile(t) }.buttonStyle(.plain)
                            }
                        }
                        Text("IN THE WEB ADMIN").font(.system(size: 13, weight: .semibold)).tracking(0.3).foregroundStyle(AT.secondary).padding(.top, 6)
                        VStack(spacing: 0) {
                            ForEach(web, id: \.0) { w in
                                NavigationLink { AdminWebScreen(title: w.0, url: AdminWeb.adminURL(w.1), showsTitle: true) } label: { row(w.0) }.buttonStyle(.plain)
                                divider
                            }
                            NavigationLink { CompassView() } label: { row("Sky compass") }.buttonStyle(.plain)
                        }
                        .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
                        Button { confirmSignOut = true } label: {
                            Text("Sign out").font(.system(size: 17)).foregroundStyle(AT.orange)
                                .frame(maxWidth: .infinity, minHeight: 50)
                                .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
                        }
                        .padding(.top, 6)
                        Text("Build \(SkyAPI.appVersion)").font(.system(size: 12)).foregroundStyle(AT.secondary).frame(maxWidth: .infinity).padding(.top, 4)
                    }
                    .padding(.horizontal, 16).padding(.bottom, 24)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .confirmationDialog("Sign out of Bestly Admin?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { auth.signOut() }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private var divider: some View { Rectangle().fill(Color.white.opacity(0.05)).frame(height: 1) }

    private func row(_ title: String) -> some View {
        HStack {
            Text(title).font(.system(size: 16)).foregroundStyle(AT.text)
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(AT.hex(0x71717A))
        }
        .padding(.horizontal, 16).frame(minHeight: 48)
        .contentShape(Rectangle())
    }

    private func tile(_ t: Tile) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: t.icon).font(.system(size: 17, weight: .semibold)).foregroundStyle(AT.hex(0x111114))
                .frame(width: 36, height: 36).background(t.tint, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            Text(t.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.text)
            Text(t.line).font(.system(size: 13)).foregroundStyle(AT.secondary).lineLimit(2).minimumScaleFactor(0.85).multilineTextAlignment(.leading)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 112, alignment: .topLeading)
        .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
    }

    @ViewBuilder private func destination(for name: String) -> some View {
        switch name {
        case "Home": AdminWebScreen(title: "Home", url: AdminWeb.adminURL("/admin/home-hub"), showsTitle: true)
        case "Studio": AdminWebScreen(title: "Studio", url: URL(string: "https://studio.bestly.tech")!, injectSession: false, showsTitle: true)
        case "AI Team": AdminWebScreen(title: "AI Team", url: AdminWeb.adminURL("/admin/team"), showsTitle: true)
        default: AgentsList()
        }
    }
}

/// Agents: Ava is native (the existing inbox); Maya and Reese open in the web admin.
struct AgentsList: View {
    @ObservedObject private var avaStore = AvaStore.shared
    @ObservedObject private var state = AdminState.shared

    var body: some View {
        ZStack {
            AT.bg.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 0) {
                    Button { state.showAva = true } label: {
                        agentRow("Ava", avaStore.unreadCount > 0 ? "\(avaStore.unreadCount) new" : "Your messages")
                    }.buttonStyle(.plain)
                    Rectangle().fill(Color.white.opacity(0.05)).frame(height: 1)
                    NavigationLink { AdminWebScreen(title: "Maya", url: AdminWeb.adminURL("/admin/maya"), showsTitle: true) } label: { agentRow("Maya", "Sales and customer calls") }.buttonStyle(.plain)
                    Rectangle().fill(Color.white.opacity(0.05)).frame(height: 1)
                    NavigationLink { AdminWebScreen(title: "Reese", url: AdminWeb.adminURL("/admin/roofguard"), showsTitle: true) } label: { agentRow("Reese (RoofGuard)", "Roof program outreach") }.buttonStyle(.plain)
                }
                .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
                .padding(16)
            }
        }
        .navigationTitle("Agents")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(AT.bg, for: .navigationBar)
    }

    private func agentRow(_ name: String, _ line: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.system(size: 16, weight: .semibold)).foregroundStyle(AT.text)
                Text(line).font(.system(size: 13)).foregroundStyle(AT.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(AT.hex(0x71717A))
        }
        .padding(.horizontal, 16).frame(minHeight: 60)
        .contentShape(Rectangle())
    }
}
