// The aircraft Live Activity: Lock Screen + Dynamic Island (compact / minimal / expanded), in the Flighty style.
import ActivityKit
import SwiftUI
import WidgetKit

@main
struct BestlySkyWidgets: WidgetBundle {
    var body: some Widget {
        AircraftLiveActivity()
    }
}

struct AircraftLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AircraftAttributes.self) { context in
            LockScreenAircraft(s: context.state, stale: context.isStale)
                .activityBackgroundTint(Color.black.opacity(0.82))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "bestlysky://checkin"))
        } dynamicIsland: { context in
            let s = context.state
            let tint = Color(skyHex: s.tint)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Image(systemName: Sky.glyph(s.kind)).font(.system(size: 15, weight: .semibold)).foregroundStyle(tint)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(s.flight).font(.system(.subheadline, design: .rounded).weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
                            if let t = s.type { Text(t).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                        }
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    HStack(spacing: 6) {
                        Text(Sky.shortDist(s.distMi)).font(.system(.subheadline, design: .rounded).weight(.semibold)).monospacedDigit().lineLimit(1)
                        BearingArrow(degrees: s.bearing, tint: tint, size: 28)
                    }
                    .padding(.trailing, 4)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(Sky.dist(s.distMi)) \(s.compass) of home")
                }
                DynamicIslandExpandedRegion(.center) {
                    if let f = s.from, let t = s.to {
                        HStack(spacing: 8) {
                            Text(f).font(.system(.title3, design: .rounded).weight(.bold))
                            RouteDots(tint: tint, glyph: Sky.glyph(s.kind))
                            Text(t).font(.system(.title3, design: .rounded).weight(.bold))
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(f) to \(t)")
                    } else if let n = s.note {
                        Text(n).font(.subheadline.weight(.medium)).lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 6) {
                        if let p = s.progress { ProgressLine(progress: p, tint: tint, glyph: Sky.glyph(s.kind)) }
                        HStack {
                            if let a = Sky.alt(s) { Stat(value: a, label: "Altitude") }
                            Spacer(minLength: 8)
                            if let v = Sky.speed(s) { Stat(value: v, label: "Speed") }
                            Spacer(minLength: 8)
                            Stat(value: s.compass, label: "From home")
                        }
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: Sky.glyph(s.kind)).foregroundStyle(tint)
                    .accessibilityLabel(s.flight)
            } compactTrailing: {
                HStack(spacing: 3) {
                    Image(systemName: "location.north.fill").font(.system(size: 11, weight: .bold))
                        .rotationEffect(.degrees(s.bearing)).foregroundStyle(tint)
                    Text(Sky.shortDist(s.distMi)).monospacedDigit().lineLimit(1)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(Sky.dist(s.distMi)) \(s.compass)")
            } minimal: {
                Image(systemName: "location.north.fill").font(.system(size: 12, weight: .bold))
                    .rotationEffect(.degrees(s.bearing)).foregroundStyle(tint)
                    .accessibilityLabel("\(s.flight), \(s.compass)")
            }
            .keylineTint(tint)
            .widgetURL(URL(string: "bestlysky://checkin"))
        }
    }
}

/// Lock Screen card — mirrors Flighty: header (airline + flight · type), big FROM ··✈·· TO codes with cities,
/// progress line, then altitude / speed / distance and the Find-My arrow.
struct LockScreenAircraft: View {
    var s: AircraftAttributes.ContentState
    var stale: Bool

    var body: some View {
        let tint = Color(skyHex: s.tint)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: Sky.glyph(s.kind))
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 22, height: 22).background(Circle().fill(tint))
                Text(s.flight).font(.system(.subheadline, design: .rounded).weight(.semibold)).lineLimit(1)
                if let t = s.type { Text("· " + t).font(.subheadline).foregroundStyle(.white.opacity(0.6)).lineLimit(1) }
                Spacer(minLength: 4)
                Text(stale ? "Not updating" : (s.note ?? "Overhead now"))
                    .font(.caption.weight(.medium)).foregroundStyle(stale ? .orange : .white.opacity(0.6)).lineLimit(1)
            }

            if let f = s.from, let t = s.to {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(f).font(.system(size: 30, weight: .bold, design: .rounded))
                        if let c = s.fromCity { Text(c).font(.caption).foregroundStyle(.white.opacity(0.6)).lineLimit(1) }
                    }
                    Spacer(minLength: 6)
                    RouteDots(tint: tint, glyph: Sky.glyph(s.kind)).padding(.top, 13)
                    Spacer(minLength: 6)
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(t).font(.system(size: 30, weight: .bold, design: .rounded))
                        if let c = s.toCity { Text(c).font(.caption).foregroundStyle(.white.opacity(0.6)).lineLimit(1) }
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("From \(s.fromCity ?? f) to \(s.toCity ?? t)")
                if let p = s.progress { ProgressLine(progress: p, tint: tint, glyph: Sky.glyph(s.kind)) }
            } else {
                Text(s.note ?? s.type ?? "Route unknown")
                    .font(.system(size: 22, weight: .bold, design: .rounded)).lineLimit(1).minimumScaleFactor(0.7)
            }

            HStack(alignment: .center, spacing: 14) {
                if let a = Sky.alt(s) { Stat(value: a, label: "Altitude") }
                if let v = Sky.speed(s) { Stat(value: v, label: "Speed") }
                Stat(value: Sky.dist(s.distMi), label: "From home")
                Spacer(minLength: 0)
                VStack(spacing: 2) {
                    BearingArrow(degrees: s.bearing, tint: tint, size: 38)
                    Text(s.compass).font(.system(size: 10, weight: .bold)).foregroundStyle(.white.opacity(0.7))
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(s.compass) of home")
            }
        }
        .foregroundStyle(.white)
        .padding(16)
    }
}
