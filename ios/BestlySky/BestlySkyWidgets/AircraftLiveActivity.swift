// The sky-alert Live Activity: Lock Screen card + Dynamic Island (compact / minimal / expanded) + Apple Watch card.
// One layout for news helicopters, police helicopters and planes; the arrow always points at the aircraft.
// Bestly Admin (2026-11-02): compact leading and minimal sit inside a progress ring; the Watch gets a small family layout.
import ActivityKit
import SwiftUI
import WidgetKit

@main
struct BestlySkyWidgets: WidgetBundle {
    var body: some Widget {
        AircraftLiveActivity()
        TuroReturnLiveActivity()
        StageLiveActivity()
    }
}

struct AircraftActivityContent: View {
    @Environment(\.activityFamily) private var family
    let s: SkyState
    let stale: Bool
    var body: some View {
        switch family {
        case .small: AircraftWatchCard(s: s)
        default: SkyAlertCard(s: s, stale: stale)
        }
    }
}

/// Apple Watch Smart Stack: ring + arrow on the leading side, the kind in its color, and distance + direction (max 20 chars).
struct AircraftWatchCard: View {
    let s: SkyState
    var body: some View {
        let k = SkyKind(s.kind)
        HStack(spacing: 10) {
            SkyRing(s: s, size: 44, stroke: 4.5) {
                SkyArrow(tint: k.tint, size: 22, degrees: s.bearingDeg, glow: 3)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(k.watchWord).font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(k.tint).lineLimit(1).minimumScaleFactor(0.6)
                Text("\(Sky.miText(s.distMi)) \(Sky.dirWord(s.bearingDeg))")
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.6)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
    }
}

extension SkyKind {
    var watchWord: String {
        switch self {
        case .news: return "News"
        case .police: return "Police"
        case .plane: return "Plane"
        }
    }
}

struct AircraftLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AircraftAttributes.self) { context in
            AircraftActivityContent(s: context.state, stale: context.isStale)
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
        .supplementalActivityFamilies([.small])
    }
}
