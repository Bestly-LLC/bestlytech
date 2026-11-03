// Bestly Admin: the app's home. Signed out: the sign-in screen. Signed in: Today, Needs you, Scout, Wall, More.
// Deep links keep working: bestlyadmin://ava/<n> (and a tapped Ava push) opens that call; bestlysky:// opens the compass.
import SwiftUI

struct RootView: View {
    @ObservedObject private var auth = AdminAuth.shared
    @ObservedObject private var state = AdminState.shared
    @ObservedObject private var ava = AvaStore.shared
    @ObservedObject private var needs = NeedsYouModel.shared
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            if auth.isSignedIn { tabs } else { SignInView() }
        }
        .tint(AT.lime)
        .preferredColorScheme(.dark)
        .overlay(alignment: .bottom) { ActionToast() }
        .sheet(isPresented: $state.showAva) { AvaInboxView().preferredColorScheme(.dark) }
        .sheet(isPresented: $state.showCompass) { CompassView().preferredColorScheme(.dark) }
        .onOpenURL { url in
            if let n = AvaDeepLink.callNo(url) { state.showAva = true; Task { await ava.open(callNo: n) } }
            else if url.scheme == "bestlyadmin" { state.showAva = true }
            else { state.showCompass = true }
        }
        .onChange(of: ava.pendingOpen) { _, n in consume(n) }
        .onChange(of: phase) { _, p in
            if p == .active, auth.isSignedIn { Task { _ = try? await auth.validAccessToken(); await needs.load() } }
        }
        .onChange(of: auth.isSignedIn) { _, on in if on { needs.start() } }
        .onAppear { consume(ava.pendingOpen); if auth.isSignedIn { needs.start() } }
    }

    private var tabs: some View {
        TabView(selection: $state.tab) {
            TodayView()
                .tabItem { Label("Today", systemImage: "house.fill") }
                .tag(0)
            NeedsYouScreen()
                .tabItem { Label("Needs you", systemImage: "bell.fill") }
                .badge(needs.badgeCount)
                .tag(1)
            ScoutScreen()
                .tabItem { Label("Scout", systemImage: "binoculars.fill") }
                .tag(2)
            WallScreen()
                .tabItem { Label("Wall", systemImage: "av.remote.fill") }
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
