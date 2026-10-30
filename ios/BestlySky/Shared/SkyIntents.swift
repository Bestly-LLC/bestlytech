// Buttons on the sky-alert card. Both are LiveActivityIntents so they work from the Lock Screen and the Dynamic Island.
import AppIntents
import Foundation

/// "Watch ABC7" / "Watch FOX 11": asks the wall to put that station on. The edge function adds `op: action`;
/// if it is not live yet the call fails quietly. No alert is shown from the intent.
struct WatchStationIntent: LiveActivityIntent {
    static var title: LocalizedStringResource { "Watch live news" }
    static var isDiscoverable: Bool { false }

    @Parameter(title: "Station", default: "watch_abc7")
    var station: String

    init() {}

    init(station: String) {
        self.station = station
    }

    func perform() async throws -> some IntentResult {
        _ = try? await SkyAPI.post(["op": "action", "action": station])
        return .result()
    }
}

/// "See map": opens Bestly Sky, whose first screen is the live compass.
struct OpenMapIntent: LiveActivityIntent {
    static var title: LocalizedStringResource { "Open the compass" }
    static var isDiscoverable: Bool { false }
    static var openAppWhenRun: Bool { true }

    init() {}

    func perform() async throws -> some IntentResult {
        .result()
    }
}
