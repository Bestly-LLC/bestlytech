// Shared SwiftUI pieces of the Turo RETURN Live Activity: the icon ring, the dots stepper, the Lock Screen card.
// Rules (Jared): never "..." (scale or shorten instead), a number never wraps from its unit (the Pi sends NBSP),
// 12-hour times, SF Pro Rounded for numbers, dark card, Lock Screen height under 160 pt.

import SwiftUI

typealias TuroState = TuroReturnAttributes.ContentState

enum TuroStyle {
    static let track = Color.white.opacity(0.16)
    static func rounded(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font { .system(size: size, weight: weight, design: .rounded) }
}

// MARK: - Material Design Icons (vector template assets in Shared/Icons.xcassets)

struct MDI: View {
    let name: String
    let color: Color
    let size: CGFloat
    var body: some View {
        Image(name).renderingMode(.template).resizable().scaledToFit()
            .frame(width: size, height: size).foregroundStyle(color)
    }
}

func turoIconAsset(_ key: String) -> String {
    switch key {
    case "check": return "mdi-check-circle"
    case "low": return "mdi-battery-alert-variant-outline"
    case "alert": return "mdi-alert-circle"
    case "ev": return "mdi-ev-station"
    default: return "mdi-car-arrow-left"
    }
}

// MARK: - Ring around the icon

/// Hollow ring in the card's tint. Out = 1/4, heading home = 3/4 plus the last quarter filling toward the ETA,
/// back / done = full.
struct TuroRing: View {
    let s: TuroState
    let size: CGFloat
    let stroke: CGFloat
    let glyph: CGFloat

    var body: some View {
        let tint = Color(skyHex: s.tint)
        ZStack {
            Circle().stroke(TuroStyle.track, style: StrokeStyle(lineWidth: stroke))
            Circle().trim(from: 0, to: s.ringFraction)
                .stroke(tint, style: StrokeStyle(lineWidth: stroke, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.easeInOut(duration: 0.6), value: s.ringFraction)
            MDI(name: turoIconAsset(s.icon), color: tint, size: glyph)
        }
        .padding(stroke / 2)
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(s.status)
    }
}

// MARK: - Dots stepper: out -> heading home -> back -> done

struct HLine: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.midY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.midY))
        return p
    }
}

struct TuroSteps: View {
    let s: TuroState
    var widthFraction: CGFloat = 0.66

    var body: some View {
        let color = Color(skyHex: s.tint)
        let flags = [true, s.stage >= 1, s.stage >= 2, s.stage >= 3]
        GeometryReader { geo in
            HStack(spacing: 0) {
                ForEach(0..<4, id: \.self) { i in
                    if i > 0 {
                        if flags[i] && flags[i - 1] {
                            Capsule().fill(color).frame(height: 2).padding(.horizontal, 4)
                        } else {
                            HLine().stroke(color.opacity(0.45), style: StrokeStyle(lineWidth: 2, dash: [3, 3]))
                                .frame(height: 2).padding(.horizontal, 4)
                        }
                    }
                    dot(i, on: flags[i], color: color)
                }
            }
            .frame(width: geo.size.width * widthFraction, height: 18)
            .frame(maxWidth: .infinity)
        }
        .frame(height: 18)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(min(s.stage + 1, 4)) of 4")
    }

    @ViewBuilder
    private func dot(_ i: Int, on: Bool, color: Color) -> some View {
        if i == 2 && s.low && s.stage >= 2 {
            badge(color) { Text("!").font(TuroStyle.rounded(11, .heavy)).foregroundStyle(.black) }
        } else if i == 3 && on {
            if s.issue {
                badge(color) { Text("!").font(TuroStyle.rounded(11, .heavy)).foregroundStyle(.black) }
            } else {
                badge(color) { MDI(name: "mdi-check", color: .black, size: 13) }
            }
        } else if on {
            Circle().fill(color).frame(width: 14, height: 14)
        } else {
            Circle().strokeBorder(color, lineWidth: 2).frame(width: 14, height: 14)
        }
    }

    private func badge<C: View>(_ color: Color, @ViewBuilder _ c: () -> C) -> some View {
        ZStack { Circle().fill(color); c() }.frame(width: 18, height: 18)
    }
}

// MARK: - Lock Screen card

struct TuroLockScreen: View {
    let s: TuroState
    var stale: Bool = false

    var body: some View {
        let tint = Color(skyHex: s.tint)
        VStack(spacing: 6) {
            HStack(spacing: 12) {
                TuroRing(s: s, size: 52, stroke: 4.5, glyph: 26)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(s.who).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                            .lineLimit(1).minimumScaleFactor(0.6)
                        Spacer(minLength: 4)
                        Text(stale ? "Not updating" : s.status).font(.system(size: 13)).foregroundStyle(stale ? .orange : Color(white: 0.8))
                            .lineLimit(1).minimumScaleFactor(0.6).layoutPriority(1)
                    }
                    Text(s.big).font(TuroStyle.rounded(24, .bold)).foregroundStyle(.white)
                        .lineLimit(1).minimumScaleFactor(0.6).monospacedDigit()
                    if let p = s.place {
                        HStack(spacing: 4) {
                            if s.pin { MDI(name: "mdi-map-marker", color: Color(white: 0.92), size: 15) }
                            Text(p).font(.system(size: 13.5)).foregroundStyle(Color(white: 0.92))
                                .lineLimit(1).minimumScaleFactor(0.6)
                        }
                    }
                }
            }
            TuroSteps(s: s)
            VStack(spacing: 3) {
                Text(s.charge).font(.system(size: 13.5)).foregroundStyle(Color(white: 0.8))
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let sc = s.sc {
                    HStack(spacing: 5) {
                        MDI(name: "mdi-lightning-bolt", color: Color(skyHex: "#30D158"), size: 14)
                        Text(sc).font(.system(size: 13)).foregroundStyle(Color(white: 0.7))
                            .lineLimit(1).minimumScaleFactor(0.6)
                        Spacer(minLength: 0)
                    }
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .frame(maxHeight: 160)
        .tint(tint)
    }
}

// MARK: - Dynamic Island trailing value

/// ONE short value: the ETA as "8:42" with a small "PM", or Back / Done / 33% / Check.
struct TrailValue: View {
    let s: TuroState
    let big: Bool
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(s.trail).font(TuroStyle.rounded(big ? 22 : 15, big ? .bold : .semibold)).monospacedDigit()
            if let u = s.trailSmall { Text(u).font(TuroStyle.rounded(big ? 12 : 10, .semibold)).opacity(0.85) }
        }
        .lineLimit(1).minimumScaleFactor(0.7).fixedSize(horizontal: true, vertical: false)
        .foregroundStyle(.white)
        .frame(maxWidth: big ? nil : 56, alignment: .trailing)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(s.trail + " " + (s.trailSmall ?? ""))
    }
}
