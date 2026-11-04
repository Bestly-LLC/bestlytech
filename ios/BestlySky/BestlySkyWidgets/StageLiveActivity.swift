// Bestly Admin: the StageActivity Live Activity: Lock Screen card, Dynamic Island (compact / minimal / expanded) and the
// Apple Watch Smart Stack card (activity family .small).
import ActivityKit
import SwiftUI
import WidgetKit

struct StageActivityContent: View {
    @Environment(\.activityFamily) private var family
    let a: StageAttributes
    let s: StageState
    var body: some View {
        switch family {
        case .small: StageWatchCard(a: a, s: s)
        default: StageLockScreen(a: a, s: s)
        }
    }
}

struct StageLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: StageAttributes.self) { context in
            StageActivityContent(a: context.attributes, s: context.state)
                .activityBackgroundTint(StageStyle.card)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.state.url.flatMap(URL.init(string:)))
        } dynamicIsland: { context in
            let s = context.state
            let tint = Color(stageHex: s.stageColor)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    StageRing(s: s, size: 46, stroke: 4.2, glyph: 24, glow: true).padding(.leading, 2)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title)
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(s.compactWord)
                        .font(.system(size: 15, weight: .bold)).foregroundStyle(tint).lineLimit(1).minimumScaleFactor(0.7)
                        .fixedSize(horizontal: true, vertical: false).padding(.trailing, 2)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        StageDots(s: s)
                        Text(s.statusLine).font(.system(size: s.stageLabels.isEmpty ? 16 : 17, weight: .medium)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.7)
                        StageBar(s: s).padding(.top, 2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                StageRing(s: s, size: 26, stroke: 2.8, glyph: 15)
            } compactTrailing: {
                Text(s.compactWord)
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(tint).lineLimit(1).minimumScaleFactor(0.7)
                    .fixedSize(horizontal: true, vertical: false).frame(maxWidth: 56, alignment: .trailing)
            } minimal: {
                StageRing(s: s, size: 28, stroke: 3, glyph: 16)
            }
            .keylineTint(tint)
            .widgetURL(s.url.flatMap(URL.init(string:)))
        }
        .supplementalActivityFamilies([.small])
    }
}
