// Bestly Admin: the app's home. Signed out: the sign-in screen. Signed in: Today, Needs you, Scout, Turo, More.
// Deep links keep working: bestlyadmin://ava/<n> (and a tapped Ava push) opens that call; bestlysky:// opens the compass.
import SwiftUI

struct RootView: View {
    @ObservedObject private var auth = AdminAuth.shared
    @ObservedObject private var state = AdminState.shared
    @ObservedObject private var ava = AvaStore.shared
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            if auth.isSignedIn { tabs } else { SignInView() }
        }
        .tint(AT.lime)
        .preferredColorScheme(.dark)
        .sheet(isPresented: $state.showAva) { AvaInboxView().preferredColorScheme(.dark) }
        .sheet(isPresented: $state.showCompass) { CompassView().preferredColorScheme(.dark) }
        .onOpenURL { url in
            if let n = AvaDeepLink.callNo(url) { state.showAva = true; Task { await ava.open(callNo: n) } }
            else if url.scheme == "bestlyadmin" { state.showAva = true }
            else { state.showCompass = true }
        }
        .onChange(of: ava.pendingOpen) { _, n in consume(n) }
        .onChange(of: phase) { _, p in
            if p == .active, auth.isSignedIn { Task { _ = try? await auth.validAccessToken(); await state.refreshBadge() } }
        }
        .onAppear { consume(ava.pendingOpen); state.startPolling() }
    }

    private var tabs: some View {
        TabView(selection: $state.tab) {
            TodayView()
                .tabItem { Label("Today", systemImage: "house.fill") }
                .tag(0)
            NavigationStack { AdminWebScreen(title: "Needs you", url: AdminWeb.adminURL("/admin/needs-you"), isTabRoot: true) }
                .tabItem { Label("Needs you", systemImage: "bell.fill") }
                .badge(state.needsYou)
                .tag(1)
            NavigationStack { AdminWebScreen(title: "Scout", url: AdminWeb.adminURL("/admin?scout=open"), isTabRoot: true) }
                .tabItem { Label("Scout", systemImage: "binoculars.fill") }
                .tag(2)
            NavigationStack { AdminWebScreen(title: "Turo", url: AdminWeb.adminURL("/admin/turo"), isTabRoot: true) }
                .tabItem { Label("Turo", systemImage: "car.fill") }
                .tag(3)
            MoreView()
                .tabItem { Label("More", systemImage: "ellipsis") }
                .tag(4)
        }
    }

    private func consume(_ n: Int?) {
        guard let n else { return }
        ava.pendingOpen = nil
        state.showAva = true
        Task { await ava.open(callNo: n) }
    }
}
