// Bestly Admin: shared SwiftUI pieces of the StageActivity: the ring around the icon, the dots line, the segment bar,
// the Lock Screen card and the small Apple Watch card.
// Rules (Jared): never "..." (scale or shorten instead), a number never wraps from its unit (the server sends NBSP),
// 12-hour times, dark card, Lock Screen height under 160 pt, glows are feathered radial gradients (no hard edges).
import SwiftUI

typealias StageState = StageAttributes.ContentState

extension Color {
    init(stageHex: String) {
        var h = stageHex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        var v: UInt64 = 0
        Scanner(string: h).scanHexInt64(&v)
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

enum StageStyle {
    static let track = Color.white.opacity(0.26)
    static let bar = Color.white.opacity(0.18)
    static let card = Color(red: 28.0 / 255, green: 28.0 / 255, blue: 30.0 / 255)      // #1C1C1E, fixed so light and dark Lock Screens match
    static func rounded(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font { .system(size: size, weight: weight, design: .rounded) }
}

/// The ring around the icon. N equal arcs with small round-capped gaps (stageCount > 0), or one continuous arc (stageCount == 0).
/// Starts at 12 o'clock and runs clockwise. Done arcs are in the stage color, the rest are a dim track.
struct StageRing: View {
    let s: StageState
    let size: CGFloat
    let stroke: CGFloat
    let glyph: CGFloat
    var glow: Bool = false

    var body: some View {
        let tint = Color(stageHex: s.stageColor)
        let circ = CGFloat.pi * (size - stroke)
        let pad = (stroke * 1.8) / 2 / circ          // round caps reach stroke / 2 past each end, plus a gap of 0.8 x stroke
        ZStack {
            if s.stageCount > 0 {
                ForEach(0..<s.stageCount, id: \.self) { i in
                    let n = CGFloat(s.stageCount)
                    let a = CGFloat(i) / n + pad
                    let b = max(a + 0.002, CGFloat(i + 1) / n - pad)
                    Circle().trim(from: a, to: b)
                        .stroke(i < s.stage ? tint : StageStyle.track, style: StrokeStyle(lineWidth: stroke, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
            } else {
                Circle().stroke(StageStyle.track, style: StrokeStyle(lineWidth: stroke))
                Circle().trim(from: 0, to: CGFloat(min(1, max(0.03, s.progress))))
                    .stroke(tint, style: StrokeStyle(lineWidth: stroke, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            MDI(name: StageIcons.asset(s.icon), color: tint, size: glyph)
        }
        .padding(stroke / 2)
        .frame(width: size, height: size)
        .background {
            if glow {
                Circle()
                    .fill(RadialGradient(colors: [tint.opacity(0.26), tint.opacity(0.08), .clear], center: .center, startRadius: 0, endRadius: size * 0.95))
                    .frame(width: size * 2, height: size * 2)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(s.statusLine)
    }
}

struct StageDots: View {
    let s: StageState
    var size: CGFloat = 19
    var body: some View {
        if !s.dotsLine.isEmpty {
            Text(s.dotsLine)
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(Color(stageHex: s.stageColor))
                .lineLimit(1).minimumScaleFactor(0.5)
        }
    }
}

struct StageBar: View {
    let s: StageState
    var body: some View {
        let tint = Color(stageHex: s.stageColor)
        if s.stageCount > 0 {
            VStack(spacing: 5) {
                HStack(spacing: 4) {
                    ForEach(0..<s.stageCount, id: \.self) { i in
                        Capsule().fill(i < s.stage ? tint : StageStyle.bar).frame(height: 5)
                    }
                }
                if s.stageLabels.count == s.stageCount {
                    // Delivery cards: a label under each segment. Current = stage tint and bold, done = white 85%, upcoming = gray.
                    HStack(spacing: 4) {
                        ForEach(0..<s.stageCount, id: \.self) { i in
                            let current = i == s.stage - 1
                            Text(s.stageLabels[i])
                                .font(.system(size: 11, weight: current ? .bold : .regular))
                                .foregroundStyle(current ? tint : (i < s.stage - 1 ? Color.white.opacity(0.85) : Color(red: 142.0 / 255, green: 142.0 / 255, blue: 147.0 / 255)))
                                .lineLimit(1).minimumScaleFactor(0.7)
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
            }
        } else {
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(StageStyle.bar)
                    Capsule().fill(tint).frame(width: max(5, g.size.width * CGFloat(min(1, max(0, s.progress)))))
                }
            }
            .frame(height: 5)
        }
    }
}

/// Lock Screen card: the approved layout (title, owner top-right, dots line, status line, segment bar) with ring + icon.
struct StageLockScreen: View {
    let a: StageAttributes
    let s: StageState
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 10) {
                StageRing(s: s, size: 38, stroke: 3.6, glyph: 19, glow: true)
                Text(a.title).font(.system(size: s.stageLabels.isEmpty ? 15 : 17, weight: .semibold)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.6)
                Spacer(minLength: 4)
                if !s.subtitle.isEmpty {
                    Text(s.subtitle).font(.system(size: 12)).foregroundStyle(Color(white: 0.62)).lineLimit(1)
                }
            }
            StageDots(s: s)
            Text(s.statusLine).font(.system(size: s.stageLabels.isEmpty ? 16 : 17, weight: .medium)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.7)
            StageBar(s: s).padding(.top, 2)
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .frame(maxHeight: 160)
    }
}

/// Apple Watch Smart Stack (activity family .small): ring + icon on the leading side, a short word, one status line (max 20 chars).
struct StageWatchCard: View {
    let a: StageAttributes
    let s: StageState
    var body: some View {
        let tint = Color(stageHex: s.stageColor)
        HStack(spacing: 10) {
            StageRing(s: s, size: 44, stroke: 4.5, glyph: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(s.compactWord.isEmpty ? a.title : s.compactWord)
                    .font(StageStyle.rounded(18, .bold)).foregroundStyle(tint).lineLimit(1).minimumScaleFactor(0.6)
                Text(s.watchLine.isEmpty ? a.title : s.watchLine)
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.6)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
    }
}
