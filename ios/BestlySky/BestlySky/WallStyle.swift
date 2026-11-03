// Bestly Admin: Wall remote look. Keys, LED, LCD glow, scanlines, flow layout. Tokens live here, not in AdminTheme.
import SwiftUI

enum WallInk {
    static let keyTop = AT.hex(0x3B3B45)
    static let keyBottom = AT.hex(0x2C2C34)
    static let keyEdge = AT.hex(0x101014)
    static let muted = AT.hex(0x8E8E99)
    static let ledOff = AT.hex(0x45454E)
    static let ledRed = AT.hex(0xFF6B6B)
    static let selTop = AT.hex(0x46512F)
    static let selBottom = AT.hex(0x36401F)
    static let selText = AT.hex(0xE9FFC0)
    static let redTop = AT.hex(0x5A2424)
    static let redBottom = AT.hex(0x3E1717)
    static let redText = AT.hex(0xFFD9D9)
    static let bodyTop = AT.hex(0x2B2B33)
    static let bodyMid = AT.hex(0x1E1E25)
    static let bodyBottom = AT.hex(0x18181E)
    static let wellTop = AT.hex(0x121217)
    static let wellBottom = AT.hex(0x15151B)
}

enum RKFace { case normal, selected, red, clear, power }

private func radii(_ r: CGFloat) -> RectangleCornerRadii {
    RectangleCornerRadii(topLeading: r, bottomLeading: r, bottomTrailing: r, topTrailing: r)
}

/// Physical key: press-down (offset 2, shorter shadow, brightness .94). Reduce Motion drops the offset.
struct RemoteKey: ButtonStyle {
    var face: RKFace = .normal
    var corners: RectangleCornerRadii = radii(14)
    var haptic: Bool = true

    init(face: RKFace = .normal, radius: CGFloat = 14, haptic: Bool = true) {
        self.face = face
        self.corners = radii(radius)
        self.haptic = haptic
    }

    init(face: RKFace = .normal, corners: RectangleCornerRadii, haptic: Bool = true) {
        self.face = face
        self.corners = corners
        self.haptic = haptic
    }

    func makeBody(configuration: Configuration) -> some View {
        RemoteKeyBody(configuration: configuration, face: face, corners: corners, haptic: haptic)
    }
}

private struct RemoteKeyBody: View {
    let configuration: ButtonStyleConfiguration
    let face: RKFace
    let corners: RectangleCornerRadii
    let haptic: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var textColor: Color {
        switch face {
        case .selected: return WallInk.selText
        case .red: return WallInk.redText
        case .power: return AT.hex(0xFFF5F5)
        default: return AT.text
        }
    }

    private var fill: AnyShapeStyle {
        switch face {
        case .selected:
            return AnyShapeStyle(LinearGradient(colors: [WallInk.selTop, WallInk.selBottom], startPoint: .top, endPoint: .bottom))
        case .red:
            return AnyShapeStyle(LinearGradient(colors: [WallInk.redTop, WallInk.redBottom], startPoint: .top, endPoint: .bottom))
        case .power:
            return AnyShapeStyle(RadialGradient(colors: [AT.hex(0xF0605F), AT.hex(0xC93636), AT.hex(0x9E2525)],
                                                center: UnitPoint(x: 0.5, y: 0.35), startRadius: 0, endRadius: 46))
        default:
            return AnyShapeStyle(LinearGradient(colors: [WallInk.keyTop, WallInk.keyBottom], startPoint: .top, endPoint: .bottom))
        }
    }

    private var edgeColor: Color { face == .power ? AT.hex(0x5E1515) : WallInk.keyEdge }

    var body: some View {
        let pressed = configuration.isPressed
        let shape = UnevenRoundedRectangle(cornerRadii: corners, style: .continuous)
        configuration.label
            .foregroundStyle(textColor)
            .background { keyBody(shape: shape, pressed: pressed) }
            .contentShape(shape)
            .offset(y: (pressed && !reduceMotion && face != .clear) ? 2 : 0)
            .brightness(pressed ? -0.06 : 0)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.09), value: pressed)
            .onChange(of: pressed) { _, now in
                if now && haptic { Haptics.tap() }
            }
    }

    @ViewBuilder
    private func keyBody(shape: UnevenRoundedRectangle, pressed: Bool) -> some View {
        if face == .clear {
            Color.clear
        } else {
            shape.fill(fill)
                .overlay(
                    shape.strokeBorder(
                        LinearGradient(colors: [Color.white.opacity(pressed ? 0.06 : 0.14), Color.white.opacity(0)], startPoint: .top, endPoint: .center),
                        lineWidth: 1)
                )
                .shadow(color: edgeColor, radius: 0, x: 0, y: pressed ? 1 : 3)
                .shadow(color: glowColor(pressed), radius: pressed ? 4 : 9, x: 0, y: pressed ? 3 : 8)
        }
    }

    private func glowColor(_ pressed: Bool) -> Color {
        switch face {
        case .selected: return AT.lime.opacity(pressed ? 0.16 : 0.28)
        case .power: return AT.hex(0xC93636).opacity(pressed ? 0.35 : 0.55)
        default: return Color.black.opacity(pressed ? 0.45 : 0.55)
        }
    }
}

/// Small status lamp. Lit = lime (or red) with a soft double glow.
struct WLed: View {
    var lit: Bool
    var red: Bool = false
    var size: CGFloat = 6

    var body: some View {
        let c = red ? WallInk.ledRed : AT.lime
        Circle()
            .fill(lit ? c : WallInk.ledOff)
            .frame(width: size, height: size)
            .shadow(color: lit ? c.opacity(0.55) : .clear, radius: 3)
            .shadow(color: lit ? c.opacity(0.18) : .clear, radius: 7)
            .accessibilityHidden(true)
    }
}

extension View {
    /// Lime LCD text with a soft feathered glow.
    func lcdGlow() -> some View {
        self.foregroundStyle(AT.lime)
            .shadow(color: AT.lime.opacity(0.55), radius: 3)
            .shadow(color: AT.lime.opacity(0.22), radius: 9)
    }
}

/// Small uppercase caption used under keys.
struct WEng: View {
    var text: String
    var color: Color = WallInk.muted
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .bold))
            .tracking(0.9)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .multilineTextAlignment(.center)
    }
}

/// CRT scanlines, faded out toward the edges (feathered).
struct WallScanlines: View {
    var body: some View {
        Canvas { ctx, size in
            var y: CGFloat = 0
            while y < size.height {
                ctx.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 1)), with: .color(Color.white.opacity(0.035)))
                y += 3
            }
        }
        .mask(
            RadialGradient(colors: [.black, .black, .clear], center: .center, startRadius: 0, endRadius: 190)
        )
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// Wrapping row of small items.
struct WallFlow: Layout {
    var hSpacing: CGFloat = 12
    var vSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowH: CGFloat = 0
        var w: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > 0 && x + sz.width > maxW {
                y += rowH + vSpacing
                x = 0
                rowH = 0
            }
            x += sz.width + hSpacing
            rowH = max(rowH, sz.height)
            w = max(w, x - hSpacing)
        }
        return CGSize(width: w, height: y + rowH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + sz.width > bounds.maxX {
                y += rowH + vSpacing
                x = bounds.minX
                rowH = 0
            }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + hSpacing
            rowH = max(rowH, sz.height)
        }
    }
}

/// Soft-edged page background behind the remote.
struct WallBackdrop: View {
    var body: some View {
        ZStack {
            AT.bg
            RadialGradient(colors: [AT.hex(0x1A1A22), AT.hex(0x0B0B0F).opacity(0)],
                           center: UnitPoint(x: 0.5, y: 0.14), startRadius: 0, endRadius: 360)
        }
        .ignoresSafeArea()
    }
}
