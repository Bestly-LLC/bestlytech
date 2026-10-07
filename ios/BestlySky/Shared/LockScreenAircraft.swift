// Aircraft Lock Screen card, shared by the widget extension and the in-app view.
import SwiftUI

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
