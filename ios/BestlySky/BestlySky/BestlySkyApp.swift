import SwiftUI

@main
struct BestlySkyApp: App {
    init() {
        // Runs on a normal launch AND when iOS wakes the app in the background after a push-to-start,
        // so the new activity's update token always reaches the server.
        Task { @MainActor in TokenSync.shared.start() }
    }

    var body: some Scene {
        WindowGroup {
            CompassView()
                .preferredColorScheme(.dark)
                .onAppear { TokenSync.shared.start() }
        }
    }
}
