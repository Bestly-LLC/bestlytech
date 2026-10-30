import ActivityKit
import SwiftUI

@main
struct BestlySkyApp: App {
    init() {
        // Runs on a normal launch AND when iOS wakes the app in the background after a push-to-start,
        // so the new activity's update token always reaches the server.
        Task { @MainActor in
            TokenSync.shared.start()
            #if DEBUG
            if CommandLine.arguments.contains("-turoLocalDemo") {       // starts a Demo return card locally (no guest data)
                try? await Task.sleep(for: .seconds(2))
                do {
                    let a = try Activity.request(attributes: TuroReturnAttributes(label: "Turo return"),
                                                 content: .init(state: .demo(stage: 1), staleDate: nil), pushType: .token)
                    NSLog("SkyTokens: local demo started %@", a.id)
                } catch { NSLog("SkyTokens: local demo failed %@", String(describing: error)) }
            }
            #endif
        }
    }

    var body: some Scene {
        WindowGroup {
            root
                .preferredColorScheme(.dark)
                .onAppear { TokenSync.shared.start() }
        }
    }

    @ViewBuilder private var root: some View {
        #if DEBUG
        if CommandLine.arguments.contains("-skyShots") {
            SkyShotsView()
        } else if CommandLine.arguments.contains("-turoPreview") {
            TuroPreviewGallery()
        } else {
            CompassView()
        }
        #else
        CompassView()
        #endif
    }
}
