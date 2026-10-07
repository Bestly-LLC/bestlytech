// The Turo RETURN Live Activity: Lock Screen card + Dynamic Island (compact / minimal / expanded).
import ActivityKit
import SwiftUI
import WidgetKit

struct TuroReturnLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TuroReturnAttributes.self) { context in
            TuroLockScreen(s: context.state, stale: context.isStale)
                .activityBackgroundTint(Color(white: 0.09, opacity: 0.86))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.state.url.flatMap(URL.init(string:)) ?? URL(string: "bestlysky://turo"))
        } dynamicIsland: { context in
            let s = context.state
            let tint = Color(skyHex: s.tint)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    TuroRing(s: s, size: 44, stroke: 4, glyph: 22).padding(.leading, 2)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(s.who).font(.system(size: 13)).foregroundStyle(Color(white: 0.8)).lineLimit(1).minimumScaleFactor(0.6)
                        Text(s.status).font(TuroStyle.rounded(15)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.6)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TrailValue(s: s, big: true).padding(.trailing, 2)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        TuroSteps(s: s, widthFraction: 0.70)
                        if let p = s.place {
                            Text(p).font(.system(size: 13)).foregroundStyle(Color(white: 0.7))
                                .lineLimit(1).minimumScaleFactor(0.6)
                        }
                    }
                }
            } compactLeading: {
                TuroRing(s: s, size: 24, stroke: 3, glyph: 13)
            } compactTrailing: {
                TrailValue(s: s, big: false)
            } minimal: {
                TuroRing(s: s, size: 24, stroke: 3, glyph: 13)
            }
            .keylineTint(tint)
            .widgetURL(s.url.flatMap(URL.init(string:)) ?? URL(string: "bestlysky://turo"))
        }
    }
}

