// Bestly Admin: the app's home. Ava first, then the sky compass the app already had.
import SwiftUI

struct RootView: View {
    @State private var tab = 0
    @ObservedObject private var store = AvaStore.shared

    var body: some View {
        TabView(selection: $tab) {
            AvaInboxView()
                .tabItem { Label("Ava", systemImage: "phone.bubble.fill") }
                .badge(store.unreadCount)
                .tag(0)
            CompassView()
                .tabItem { Label("Sky", systemImage: "location.north.circle.fill") }
                .tag(1)
        }
        .tint(AvaStyle.orange)
        .onOpenURL { url in
            if let n = AvaDeepLink.callNo(url) { tab = 0; Task { await store.open(callNo: n) } }
            else if url.scheme == "bestlyadmin" { tab = 0 }
            else { tab = 1 }
        }
        .onChange(of: store.pendingOpen) { _, n in consume(n) }
        .onAppear { consume(store.pendingOpen) }
    }

    private func consume(_ n: Int?) {
        guard let n else { return }
        store.pendingOpen = nil
        tab = 0
        Task { await store.open(callNo: n) }
    }
}
