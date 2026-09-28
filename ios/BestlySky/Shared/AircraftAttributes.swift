// Bestly Sky — the aircraft Live Activity (wall round 4, W6).
// The content state is written by the Pi (server.py "W6 SKY LIVE ACTIVITY") and delivered by the Supabase edge function
// wall-live-activity over APNs. Keys here MUST match the JSON the Pi sends (camelCase, unix seconds, no Date types).

import ActivityKit
import Foundation
import SwiftUI

struct AircraftAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var hex: String
        var flight: String            // "American 1001", "LAPD Air Support", "N123AB"
        var code: String?             // airline IATA code, "AA"
        var type: String?             // "A321", "737 MAX", "H125"
        var from: String?             // "LAX"
        var to: String?               // "JFK"
        var fromCity: String?
        var toCity: String?
        var progress: Double?         // 0...1 along the route, nil when the route is unknown
        var altFt: Int?
        var climb: Int                // 1 climbing, -1 descending, 0 level
        var mph: Int?
        var distMi: Double            // from home
        var bearing: Double           // degrees true, from home to the aircraft
        var compass: String           // "NE"
        var tint: String              // "#1E90FF"
        var kind: String              // "jet" | "heli" | "police" | "news" | "private"
        var note: String?             // "Over Koreatown", "KTLA 5"
        var lat: Double?
        var lon: Double?
        var at: Double                // unix seconds of this fix
    }

    var home: String
    var lat: Double
    var lon: Double
}

// MARK: - Formatting shared by the widget and the app (a number never wraps away from its unit: U+00A0).

enum Sky {
    static let nb = "\u{00A0}"

    static func alt(_ s: AircraftAttributes.ContentState) -> String? {
        guard let a = s.altFt, a > 0 else { return nil }
        let rounded = Int((Double(a) / 100).rounded()) * 100
        let arrow = s.climb > 0 ? nb + "↑" : s.climb < 0 ? nb + "↓" : ""
        return rounded.formatted(.number.grouping(.automatic)) + nb + "ft" + arrow
    }

    static func speed(_ s: AircraftAttributes.ContentState) -> String? {
        guard let m = s.mph, m > 0 else { return nil }
        return "\(m)" + nb + "mph"
    }

    static func dist(_ mi: Double) -> String {
        if mi < 0.3 { return "Overhead" }
        return (mi < 10 ? String(format: "%.1f", mi) : String(Int(mi.rounded()))) + nb + "mi"
    }

    static func shortDist(_ mi: Double) -> String {
        if mi < 0.3 { return "Here" }
        return (mi < 10 ? String(format: "%.1f", mi) : String(Int(mi.rounded()))) + nb + "mi"
    }

    static func glyph(_ kind: String) -> String {
        switch kind {
        case "heli", "police", "news": return "helicopter"   // SF Symbols 6+
        default: return "airplane"
        }
    }

    static func headline(_ s: AircraftAttributes.ContentState) -> String {
        if let f = s.from, let t = s.to { return "\(f) to \(t)" }
        return s.note ?? s.type ?? s.flight
    }

    /// Bearing in degrees true from (lat1, lon1) to (lat2, lon2).
    static func bearing(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let p1 = lat1 * .pi / 180, p2 = lat2 * .pi / 180, dl = (lon2 - lon1) * .pi / 180
        let y = sin(dl) * cos(p2), x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl)
        return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }

    static func miles(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let r = 3958.8, p1 = lat1 * .pi / 180, p2 = lat2 * .pi / 180
        let dp = p2 - p1, dl = (lon2 - lon1) * .pi / 180
        let a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * r * asin(min(1, sqrt(a)))
    }
}

extension Color {
    init(skyHex: String) {
        var s = skyHex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        var v: UInt64 = 0
        guard s.count == 6, Scanner(string: s).scanHexInt64(&v) else { self = .blue; return }
        self = Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}
