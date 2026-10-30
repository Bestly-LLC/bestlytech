// The sky-alert Live Activity: Lock Screen card + Dynamic Island (compact / minimal / expanded).
// One layout for news helicopters, police helicopters and planes; the arrow always points at the aircraft.
import ActivityKit
import SwiftUI
import WidgetKit

@main
struct BestlySkyWidgets: WidgetBundle {
    var body: some Widget {
        AircraftLiveActivity()
        TuroReturnLiveActivity()
    }
}

struct AircraftLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AircraftAttributes.self) { context in
            SkyAlertCard(s: context.state, stale: context.isStale)
                .activityBackgroundTint(Color(red: 30.0 / 255, green: 30.0 / 255, blue: 34.0 / 255).opacity(0.74))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "bestlysky://compass"))
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    SkyHeader(s: s).frame(maxWidth: .infinity)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        SkyMain(s: s, dial: 64)
                        SkyBottom(s: s, height: 34)
                    }
                }
            } compactLeading: {
                SkyCompactLeading(s: s)
            } compactTrailing: {
                SkyCompactTrailing(s: s)
            } minimal: {
                SkyMinimal(s: s)
            }
            .keylineTint(SkyKind(s.kind).tint)
            .widgetURL(URL(string: "bestlysky://compass"))
        }
    }
}
