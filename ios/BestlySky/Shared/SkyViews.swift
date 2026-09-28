// Flighty-style building blocks shared by the Live Activity (widget extension) and the app.
import SwiftUI

/// FROM ··✈·· TO — the dotted route line with the plane glyph in the middle.
struct RouteDots: View {
    var tint: Color
    var glyph: String = "airplane"
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<2, id: \.self) { _ in Circle().frame(width: 3, height: 3) }
            Image(systemName: glyph).font(.system(size: 13, weight: .semibold)).foregroundStyle(tint)
            ForEach(0..<2, id: \.self) { _ in Circle().frame(width: 3, height: 3) }
        }
        .foregroundStyle(.white.opacity(0.45))
        .accessibilityHidden(true)
    }
}

/// The progress line: a thin track, the flown part in the airline tint, a plane riding the line.
/// Only shown when the route (and so the progress) is known.
struct ProgressLine: View {
    var progress: Double
    var tint: Color
    var glyph: String = "airplane"
    var body: some View {
        GeometryReader { g in
            let p = min(max(progress, 0), 1)
            let x = 8 + (g.size.width - 16) * p
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.18)).frame(height: 3)
                Capsule().fill(tint).frame(width: max(3, x), height: 3)
                Image(systemName: glyph)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(3)
                    .background(Circle().fill(tint))
                    .position(x: x, y: g.size.height / 2)
            }
            .frame(height: g.size.height)
        }
        .frame(height: 20)
        .accessibilityElement()
        .accessibilityLabel("Flight progress")
        .accessibilityValue("\(Int((min(max(progress, 0), 1)) * 100)) percent")
    }
}

/// Find-My-style arrow: points from home toward the aircraft, relative to north (a Live Activity can't read the compass).
struct BearingArrow: View {
    var degrees: Double
    var tint: Color
    var size: CGFloat = 40
    var body: some View {
        ZStack {
            Circle().fill(tint.opacity(0.22))
            Image(systemName: "location.north.fill")
                .font(.system(size: size * 0.46, weight: .bold))
                .foregroundStyle(tint)
                .rotationEffect(.degrees(degrees))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// One stat, value on top, small caps label under it (Flighty's "1h 20m / UNTIL GATE ARRIVAL" rhythm).
struct Stat: View {
    var value: String
    var label: String
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.system(.subheadline, design: .rounded).weight(.semibold)).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.8)
            Text(label).font(.system(size: 10, weight: .semibold)).foregroundStyle(.white.opacity(0.55)).textCase(.uppercase)
        }
        .accessibilityElement(children: .combine)
    }
}
