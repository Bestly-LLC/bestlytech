// Bestly Admin: shared colors, the Scout binoculars mark, and tiny JSON helpers for the admin screens.
import SwiftUI

enum AT {
    static func hex(_ v: UInt32, _ a: Double = 1) -> Color {
        Color(.sRGB, red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255, opacity: a)
    }
    static let bg = hex(0x0B0B0F)
    static let card = hex(0x16161C)
    static let inner = hex(0x1E1E26)
    static let text = hex(0xF5F5F7)
    static let secondary = hex(0xA1A1AA)
    static let lime = hex(0xC8F169)
    static let lavender = hex(0xCFC6FF)
    static let peach = hex(0xFFD5BF)
    static let sky = hex(0xBFE3FF)
    static let orange = hex(0xFB923C)
    static let green = hex(0x4ADE80)
    static let red = hex(0xF87171)
    static let ringTrack = hex(0x2A2A33)
    static let radius: CGFloat = 20
}

/// Keeps a number and its unit on one line ("6:30 PM", "78%").
func glue(_ s: String) -> String {
    var out = s
    for unit in ["AM", "PM", "mph", "hours", "hour", "min", "psi", "mi"] {
        out = out.replacingOccurrences(of: " \(unit)", with: "\u{00A0}\(unit)")
    }
    return out
}

// MARK: - JSON helpers (the admin RPCs return loose JSON; we read what we need and ignore the rest)

typealias JSON = [String: Any]

extension Dictionary where Key == String, Value == Any {
    func str(_ k: String) -> String? { self[k] as? String }
    func dbl(_ k: String) -> Double? {
        if let d = self[k] as? Double { return d }
        if let i = self[k] as? Int { return Double(i) }
        if let s = self[k] as? String { return Double(s) }
        return nil
    }
    func int(_ k: String) -> Int? { dbl(k).map { Int($0) } }
    func bool(_ k: String) -> Bool? { self[k] as? Bool }
    func obj(_ k: String) -> JSON? { self[k] as? JSON }
    func arr(_ k: String) -> [JSON] { (self[k] as? [Any])?.compactMap { $0 as? JSON } ?? [] }
}

enum AdminFmt {
    static let la = TimeZone(identifier: "America/Los_Angeles")!
    private static func f(_ pattern: String) -> DateFormatter {
        let d = DateFormatter()
        d.locale = Locale(identifier: "en_US_POSIX")
        d.timeZone = la
        d.dateFormat = pattern
        return d
    }
    static let hour = f("h a")            // 8 PM
    static let time = f("h:mm a")         // 6:30 PM
    static let dayTime = f("EEE h:mm a")  // Tue 10:00 AM
    static let header = f("EEEE, MMM d")  // Monday, Nov 2
    static let iso: ISO8601DateFormatter = {
        let i = ISO8601DateFormatter(); i.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return i
    }()
    static let isoPlain = ISO8601DateFormatter()
    static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        return iso.date(from: s) ?? isoPlain.date(from: s)
    }
    static func whenShort(_ d: Date, now: Date = Date()) -> String {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = la
        if cal.isDate(d, inSameDayAs: now) { return "Today " + time.string(from: d) }
        if let t = cal.date(byAdding: .day, value: 1, to: now), cal.isDate(d, inSameDayAs: t) { return "Tomorrow " + time.string(from: d) }
        return dayTime.string(from: d)
    }
    static func usd(_ v: Double, signed: Bool = false) -> String {
        let n = NumberFormatter()
        n.numberStyle = .currency; n.currencyCode = "USD"; n.maximumFractionDigits = 0; n.locale = Locale(identifier: "en_US")
        let body = n.string(from: NSNumber(value: abs(v))) ?? "$0"
        if signed { return (v < 0 ? "\u{2212}" : "+") + body }
        return (v < 0 ? "\u{2212}" : "") + body
    }
}

// MARK: - Scout binoculars mark (from the approved Scout screen, 40 pt grid)

struct ScoutMark: View {
    var size: CGFloat = 40
    var tint: Color = AT.lavender
    var body: some View {
        Canvas { ctx, sz in
            let s = sz.width / 40
            func c(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) -> Path {
                Path(ellipseIn: CGRect(x: (x - r) * s, y: (y - r) * s, width: 2 * r * s, height: 2 * r * s))
            }
            ctx.fill(c(20, 20, 20), with: .color(AT.inner))
            ctx.stroke(c(13.5, 22, 6), with: .color(tint), lineWidth: 2 * s)
            ctx.stroke(c(26.5, 22, 6), with: .color(tint), lineWidth: 2 * s)
            var bridge = Path()
            bridge.move(to: CGPoint(x: 8 * s, y: 18.5 * s))
            bridge.addCurve(to: CGPoint(x: 19 * s, y: 18.5 * s), control1: CGPoint(x: 10 * s, y: 16.5 * s), control2: CGPoint(x: 17 * s, y: 16.5 * s))
            bridge.move(to: CGPoint(x: 21 * s, y: 18.5 * s))
            bridge.addCurve(to: CGPoint(x: 32 * s, y: 18.5 * s), control1: CGPoint(x: 23 * s, y: 16.5 * s), control2: CGPoint(x: 30 * s, y: 16.5 * s))
            ctx.stroke(bridge, with: .color(tint), style: StrokeStyle(lineWidth: 2.4 * s, lineCap: .round))
            ctx.fill(c(15, 23, 1.8), with: .color(AT.text))
            ctx.fill(c(28, 23, 1.8), with: .color(AT.text))
        }
        .frame(width: size, height: size)
        .accessibilityLabel("Scout")
    }
}

/// Card container used across the admin screens.
struct ATCard<Content: View>: View {
    var fill: Color = AT.card
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
    }
}
