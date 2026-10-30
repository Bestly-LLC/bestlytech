// The sky-alert card, shared by the Lock Screen, the Dynamic Island and the debug screenshot harness.
// House rules baked in: nothing is ever truncated with "...", numbers never wrap away from their unit,
// glows are feathered radial gradients (no hard edges), times and units are US.
import AppIntents
import SwiftUI

typealias SkyState = AircraftAttributes.ContentState

// MARK: - Arrow

/// Find My style arrow, same shape as the approved preview.
struct SkyArrowShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
        var path = Path()
        path.move(to: p(12, 2.5))
        path.addLine(to: p(19, 20))
        path.addLine(to: p(12, 16.2))
        path.addLine(to: p(5, 20))
        path.closeSubpath()
        return path
    }
}

struct SkyArrow: View {
    var tint: Color
    var size: CGFloat
    var degrees: Double
    var glow: CGFloat = 6

    var body: some View {
        ZStack {
            SkyArrowShape().fill(tint)
            SkyArrowShape().stroke(tint, style: StrokeStyle(lineWidth: size / 16, lineJoin: .round))
        }
        .frame(width: size, height: size)
        .shadow(color: tint.opacity(0.6), radius: glow)
        .rotationEffect(.degrees(degrees))
        .animation(.spring(response: 0.6, dampingFraction: 1.0), value: degrees)
    }
}

// MARK: - Dial

struct SkyDial: View {
    var degrees: Double
    var tint: Color
    var size: CGFloat
    var description: String

    var body: some View {
        ZStack {
            Circle().fill(Color.white.opacity(0.06))
            Circle().strokeBorder(Color.white.opacity(0.14), lineWidth: 1)
            Text("N")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.65))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .padding(.top, 3)
            Capsule().fill(Color.white.opacity(0.25)).frame(width: 2, height: 5)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom).padding(4)
            Capsule().fill(Color.white.opacity(0.25)).frame(width: 5, height: 2)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading).padding(4)
            Capsule().fill(Color.white.opacity(0.25)).frame(width: 5, height: 2)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing).padding(4)
            SkyArrow(tint: tint, size: size * 0.44, degrees: degrees)
        }
        .frame(width: size, height: size)
        .background {
            Circle()
                .fill(RadialGradient(colors: [tint.opacity(0.35), tint.opacity(0.12), tint.opacity(0)],
                                     center: .center, startRadius: 0, endRadius: size * 0.75))
                .frame(width: size * 1.5, height: size * 1.5)
        }
        .accessibilityElement()
        .accessibilityLabel(description)
    }
}

// MARK: - Header pieces

/// Helicopter glyph from the approved preview (SF Symbols has no helicopter), drawn on a 24 x 24 grid.
struct SkyHeliShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
        var path = Path()
        path.move(to: p(4, 4)); path.addLine(to: p(20, 4))                 // rotor
        path.move(to: p(12, 4)); path.addLine(to: p(12, 8))                // mast
        path.move(to: p(8, 14))                                            // cabin
        path.addCurve(to: p(12, 8), control1: p(8, 11.2), control2: p(9.4, 8))
        path.addLine(to: p(14, 8))
        path.addCurve(to: p(19, 13), control1: p(16.76, 8), control2: p(19, 10.24))
        path.addLine(to: p(19, 14))
        path.addLine(to: p(8, 14))
        path.move(to: p(8, 12)); path.addLine(to: p(2, 12))                // tail
        path.move(to: p(2, 10)); path.addLine(to: p(2, 14))                // tail rotor
        path.move(to: p(10, 18)); path.addLine(to: p(19, 18))              // skid
        path.move(to: p(12, 14)); path.addLine(to: p(12, 18))              // strut
        path.move(to: p(17, 14)); path.addLine(to: p(17, 18))              // strut
        return path
    }
}

struct SkyChip: View {
    var kind: SkyKind
    var size: CGFloat = 24

    var body: some View {
        ZStack {
            Circle().fill(kind.tint.opacity(0.2))
            if kind == .plane {
                Image(systemName: "airplane")
                    .font(.system(size: size * 0.54, weight: .semibold))
                    .foregroundStyle(kind.tint)
            } else {
                SkyHeliShape()
                    .stroke(kind.tint, style: StrokeStyle(lineWidth: size * 0.67 / 12, lineCap: .round, lineJoin: .round))
                    .frame(width: size * 0.67, height: size * 0.67)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct SkyLabelRow: View {
    var s: SkyState

    var body: some View {
        let k = SkyKind(s.kind)
        HStack(spacing: 8) {
            SkyChip(kind: k)
            Text(s.label)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(k.tint)
                .fixedSize()
        }
    }
}

struct SkyOwnerText: View {
    var s: SkyState

    var body: some View {
        Text(s.owner)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Color.white.opacity(0.6))
            .fixedSize()
    }
}

/// Row 1: icon chip + label on the left, the AI employee who signs the alert on the right.
struct SkyHeader: View {
    var s: SkyState

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                SkyLabelRow(s: s)
                Spacer(minLength: 8)
                SkyOwnerText(s: s)
            }
            HStack(spacing: 8) {
                SkyLabelRow(s: s)
                Spacer(minLength: 0)
            }
        }
        .frame(minHeight: 24)
    }
}

// MARK: - Row 2: text column + dial

struct SkyTextColumn: View {
    var s: SkyState

    var body: some View {
        ViewThatFits(in: .horizontal) {
            column(withLine3: true, withWord: true)
            column(withLine3: false, withWord: true)
            column(withLine3: false, withWord: false)
            distance
        }
    }

    private var distance: some View {
        Text(Sky.miText(s.distMi))
            .font(.system(size: 30, weight: .bold, design: .rounded))
            .monospacedDigit()
            .tracking(-0.6)
            .foregroundStyle(.white)
            .fixedSize()
    }

    private func column(withLine3: Bool, withWord: Bool) -> some View {
        VStack(alignment: .leading, spacing: -3) {
            if !s.line1.isEmpty {
                Text(s.line1)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.92))
                    .fixedSize()
            }
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                distance
                if withWord {
                    Text(Sky.dirWord(s.bearingDeg))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.7))
                        .fixedSize()
                }
            }
            if withLine3 && !s.line3.isEmpty {
                Text(s.line3)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.6))
                    .fixedSize()
            }
        }
    }
}

struct SkyMain: View {
    var s: SkyState
    var dial: CGFloat = 64

    var body: some View {
        let k = SkyKind(s.kind)
        HStack(spacing: 12) {
            SkyTextColumn(s: s).frame(maxWidth: .infinity, alignment: .leading)
            SkyDial(degrees: s.bearingDeg, tint: k.tint, size: dial,
                    description: "Arrow pointing \(Sky.dirWord(s.bearingDeg)) toward \(k.subject)\(s.fromPhone ? ", from you" : "")")
        }
        .frame(height: dial)
    }
}

// MARK: - Row 3: buttons, footnote or route

struct SkyPill: View {
    var title: String
    var kind: SkyKind
    var height: CGFloat
    var fontSize: CGFloat = 14
    var fill: Bool = true

    var body: some View {
        Text(title)
            .font(.system(size: fontSize, weight: .semibold))
            .foregroundStyle(kind.buttonText)
            .fixedSize()
            .padding(.horizontal, 14)
            .frame(maxWidth: fill ? .infinity : nil)
            .frame(height: height)
            .background(Capsule().fill(kind.tint.opacity(fill ? 0.22 : 0.24)))
            .contentShape(Capsule())
    }
}

struct SkyActionButton: View {
    var action: AircraftAttributes.Action
    var kind: SkyKind
    var height: CGFloat
    var fontSize: CGFloat = 14
    var fill: Bool = true

    var body: some View {
        if action.id == "open_map" {
            Button(intent: OpenMapIntent()) { SkyPill(title: action.title, kind: kind, height: height, fontSize: fontSize, fill: fill) }
                .buttonStyle(.plain)
        } else {
            Button(intent: WatchStationIntent(station: action.id)) { SkyPill(title: action.title, kind: kind, height: height, fontSize: fontSize, fill: fill) }
                .buttonStyle(.plain)
        }
    }
}

struct SkyRouteBar: View {
    var route: AircraftAttributes.Route
    var tint: Color

    var body: some View {
        ViewThatFits(in: .horizontal) {
            bar(withEta: true)
            bar(withEta: false)
        }
    }

    private func bar(withEta: Bool) -> some View {
        HStack(spacing: 10) {
            Text(route.from).font(.system(size: 13, weight: .bold)).foregroundStyle(.white).fixedSize()
            track.frame(minWidth: 40).frame(height: 14)
            Text(route.to).font(.system(size: 13, weight: .bold)).foregroundStyle(.white).fixedSize()
            if withEta && !route.eta.isEmpty {
                Text(route.eta).font(.system(size: 13, weight: .medium)).foregroundStyle(Color.white.opacity(0.6)).fixedSize()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(route.from) to \(route.to), \(Int(min(max(route.progress, 0), 1) * 100)) percent of the way. \(route.eta)")
    }

    private var track: some View {
        GeometryReader { g in
            let p = min(max(route.progress, 0), 1)
            let x = g.size.width * p
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.14)).frame(height: 4)
                Capsule()
                    .fill(LinearGradient(colors: [tint.opacity(0), tint], startPoint: .leading, endPoint: .trailing))
                    .frame(width: max(0, x), height: 4)
                Circle().fill(tint).frame(width: 12, height: 12)
                    .shadow(color: tint.opacity(0.6), radius: 5)
                    .offset(x: x - 6)
            }
            .frame(width: g.size.width, height: g.size.height)
        }
    }
}

struct SkyBottom: View {
    var s: SkyState
    var height: CGFloat = 32

    var body: some View {
        let k = SkyKind(s.kind)
        let watch = Array(s.actions.filter { $0.id.hasPrefix("watch_") }.prefix(2))
        let hasMap = s.actions.contains { $0.id == "open_map" }
        let note = s.footnote ?? ""
        if k == .plane, let r = s.route {
            SkyRouteBar(route: r, tint: k.tint).frame(height: height)
        } else if !watch.isEmpty {
            HStack(spacing: 8) {
                ForEach(watch) { a in SkyActionButton(action: a, kind: k, height: height) }
            }
        } else if hasMap || !note.isEmpty {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    noteText(note)
                    Spacer(minLength: 8)
                    mapButton(k)
                }
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    mapButton(k)
                }
            }
            .frame(height: height)
        }
    }

    @ViewBuilder private func noteText(_ note: String) -> some View {
        if !note.isEmpty {
            Text(note).font(.system(size: 13, weight: .medium)).foregroundStyle(Color.white.opacity(0.6)).fixedSize()
        }
    }

    @ViewBuilder private func mapButton(_ k: SkyKind) -> some View {
        if let a = s.actions.first(where: { $0.id == "open_map" }) {
            SkyActionButton(action: a, kind: k, height: height, fontSize: 13, fill: false)
        }
    }
}

// MARK: - The Lock Screen card

struct SkyAlertCard: View {
    var s: SkyState
    var stale: Bool = false

    var body: some View {
        let k = SkyKind(s.kind)
        VStack(spacing: 6) {
            SkyHeader(s: s)
            SkyMain(s: s, dial: 64)
            SkyBottom(s: s, height: 32)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(alignment: .topTrailing) {
            Circle()
                .fill(RadialGradient(colors: [k.tint.opacity(0.20), k.tint.opacity(0.07), k.tint.opacity(0)],
                                     center: .center, startRadius: 0, endRadius: 130))
                .frame(width: 260, height: 260)
                .offset(x: 60, y: -40)
        }
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .opacity(stale ? 0.6 : 1)
    }
}

// MARK: - Dynamic Island pieces

struct SkyCompactLeading: View {
    var s: SkyState
    var body: some View { SkyChip(kind: SkyKind(s.kind), size: 22) }
}

struct SkyCompactTrailing: View {
    var s: SkyState

    var body: some View {
        let k = SkyKind(s.kind)
        HStack(spacing: 5) {
            SkyArrow(tint: k.tint, size: 14, degrees: s.bearingDeg, glow: 4)
            Text(Sky.miText(s.distMi))
                .font(.system(size: 14, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(k.tint)
                .fixedSize()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Sky.miText(s.distMi)) \(Sky.dirWord(s.bearingDeg))")
    }
}

struct SkyMinimal: View {
    var s: SkyState

    var body: some View {
        SkyArrow(tint: SkyKind(s.kind).tint, size: 16, degrees: s.bearingDeg, glow: 4)
            .accessibilityLabel("\(SkyKind(s.kind).subject), \(Sky.dirWord(s.bearingDeg))")
    }
}

/// The rows of the expanded island below the camera: header, main with a 64 pt dial, bottom row.
struct SkyExpandedBody: View {
    var s: SkyState

    var body: some View {
        VStack(spacing: 8) {
            SkyHeader(s: s)
            SkyMain(s: s, dial: 64)
            SkyBottom(s: s, height: 34)
        }
    }
}
