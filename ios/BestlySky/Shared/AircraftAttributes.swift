// Bestly Sky: the sky-alert Live Activity (news helicopters, police helicopters, planes).
// ONE activity type. `kind` switches the look in place, so every field lives in ContentState and the static
// attributes are only {"version": 2}. Keys are shared with the Pi and the wall-live-activity edge function
// (camelCase, unix seconds, no Date types). Every field decodes with a default, so an older payload can never crash the widget.

import ActivityKit
import Foundation
import SwiftUI

extension KeyedDecodingContainer {
    /// Decodes a value, or returns the fallback when the key is missing or has the wrong shape.
    func skyValue<T: Decodable>(_ key: Key, _ fallback: T) -> T {
        (try? decodeIfPresent(T.self, forKey: key)) ?? fallback
    }
}

struct AircraftAttributes: ActivityAttributes {
    struct Action: Codable, Hashable, Identifiable {
        var id: String
        var title: String

        init(id: String, title: String) {
            self.id = id
            self.title = title
        }

        enum CodingKeys: String, CodingKey { case id, title }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = c.skyValue(.id, "")
            title = c.skyValue(.title, "")
        }
    }

    struct Route: Codable, Hashable {
        var from: String
        var to: String
        var progress: Double
        var eta: String

        init(from: String = "", to: String = "", progress: Double = 0, eta: String = "") {
            self.from = from
            self.to = to
            self.progress = progress
            self.eta = eta
        }

        enum CodingKeys: String, CodingKey { case from, to, progress, eta }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            from = c.skyValue(.from, "")
            to = c.skyValue(.to, "")
            progress = c.skyValue(.progress, 0.0)
            eta = c.skyValue(.eta, "")
        }
    }

    struct ContentState: Codable, Hashable {
        var kind: String              // "news" | "police" | "plane"
        var label: String             // "News helicopters" | "Police helicopter" | "Plane overhead"
        var owner: String             // the AI employee who signs the alert
        var line1: String             // <= 26 chars
        var distMi: Double
        var bearingDeg: Double        // true bearing observer -> target, 0 = north, clockwise
        var fromPhone: Bool
        var line3: String             // <= 32 chars
        var actions: [Action]         // 0-2
        var footnote: String?         // <= 24 chars
        var route: Route?             // planes only
        var targetLat: Double
        var targetLon: Double
        var updatedAt: Double         // epoch seconds

        init(kind: String = "plane", label: String = "", owner: String = "", line1: String = "", distMi: Double = 0,
             bearingDeg: Double = 0, fromPhone: Bool = false, line3: String = "", actions: [Action] = [],
             footnote: String? = nil, route: Route? = nil, targetLat: Double = 0, targetLon: Double = 0, updatedAt: Double = 0) {
            let k = SkyKind(kind)
            self.kind = kind
            self.label = label.isEmpty ? k.defaultLabel : label
            self.owner = owner.isEmpty ? k.defaultOwner : owner
            self.line1 = line1
            self.distMi = distMi
            self.bearingDeg = bearingDeg
            self.fromPhone = fromPhone
            self.line3 = line3
            self.actions = actions
            self.footnote = footnote
            self.route = route
            self.targetLat = targetLat
            self.targetLon = targetLon
            self.updatedAt = updatedAt
        }

        enum CodingKeys: String, CodingKey {
            case kind, label, owner, line1, distMi, bearingDeg, fromPhone, line3, actions, footnote, route, targetLat, targetLon, updatedAt
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.init(kind: c.skyValue(.kind, "plane"),
                      label: c.skyValue(.label, ""),
                      owner: c.skyValue(.owner, ""),
                      line1: c.skyValue(.line1, ""),
                      distMi: c.skyValue(.distMi, 0.0),
                      bearingDeg: c.skyValue(.bearingDeg, 0.0),
                      fromPhone: c.skyValue(.fromPhone, false),
                      line3: c.skyValue(.line3, ""),
                      actions: c.skyValue(.actions, [Action]()),
                      footnote: try? c.decodeIfPresent(String.self, forKey: .footnote),
                      route: try? c.decodeIfPresent(Route.self, forKey: .route),
                      targetLat: c.skyValue(.targetLat, 0.0),
                      targetLon: c.skyValue(.targetLon, 0.0),
                      updatedAt: c.skyValue(.updatedAt, 0.0))
        }
    }

    var version: Int

    init(version: Int = 2) { self.version = version }

    enum CodingKeys: String, CodingKey { case version }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.skyValue(.version, 2)
    }
}

// MARK: - Kinds

enum SkyKind {
    case news, police, plane

    init(_ raw: String) {
        switch raw.lowercased() {
        case "news": self = .news
        case "police": self = .police
        default: self = .plane
        }
    }

    var tint: Color {
        switch self {
        case .news: return Color(red: 1.0, green: 159.0 / 255, blue: 10.0 / 255)            // #FF9F0A
        case .police: return Color(red: 10.0 / 255, green: 132.0 / 255, blue: 1.0)          // #0A84FF
        case .plane: return Color(red: 100.0 / 255, green: 210.0 / 255, blue: 1.0)          // #64D2FF
        }
    }

    /// Text colour for tinted capsule buttons (police uses a lighter blue so it reads on the 24% fill).
    var buttonText: Color {
        self == .police ? Color(red: 140.0 / 255, green: 196.0 / 255, blue: 1.0) : tint
    }

    var symbol: String { "airplane" }

    var defaultLabel: String {
        switch self {
        case .news: return "News helicopters"
        case .police: return "Police helicopter"
        case .plane: return "Plane overhead"
        }
    }

    var defaultOwner: String { self == .news ? "Home Hub" : "Sky Sync" }

    var subject: String {
        switch self {
        case .news: return "the news helicopters"
        case .police: return "the police helicopter"
        case .plane: return "the plane"
        }
    }
}

// MARK: - Formatting + geometry shared by the widget and the app (a number never wraps away from its unit: U+00A0).

enum Sky {
    static let nb = "\u{00A0}"

    /// "0.8 mi", always one decimal, number and unit glued together.
    static func miText(_ mi: Double) -> String {
        String(format: "%.1f", max(0, mi)) + nb + "mi"
    }

    static func dirWord(_ bearing: Double) -> String {
        let dirs = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]
        let n = ((bearing.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360)
        return dirs[Int((n / 45).rounded()) % 8]
    }

    /// Relative angle folded to -180...180 (positive = to the right).
    static func fold(_ deg: Double) -> Double {
        ((deg.truncatingRemainder(dividingBy: 360)) + 540).truncatingRemainder(dividingBy: 360) - 180
    }

    static func relPhrase(_ rel: Double) -> String {
        let a = abs(fold(rel)), side = fold(rel) > 0 ? "right" : "left"
        if a < 20 { return "Straight ahead" }
        if a < 70 { return "Ahead, to your \(side)" }
        if a < 110 { return "To your \(side)" }
        if a < 160 { return "Behind you, to the \(side)" }
        return "Behind you"
    }

    /// Moves `previous` to `target` by the shortest turn so animated arrows never spin the long way round.
    static func unwrap(_ previous: Double, to target: Double) -> Double {
        previous + fold(target - previous)
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

// MARK: - Sample states (previews, screenshots, demo mode)

extension AircraftAttributes.ContentState {
    static func demo(_ kind: String) -> AircraftAttributes.ContentState {
        let now = Date().timeIntervalSince1970
        switch SkyKind(kind) {
        case .news:
            return .init(kind: "news", label: "News helicopters", owner: "Home Hub", line1: "3 circling a scene", distMi: 0.8, bearingDeg: 42,
                         line3: "Since 11:32 PM · 1,200 ft up",
                         actions: [.init(id: "watch_abc7", title: "Watch ABC7"), .init(id: "watch_fox11", title: "Watch FOX 11")],
                         targetLat: 34.0905, targetLon: -118.3650, updatedAt: now)
        case .police:
            return .init(kind: "police", label: "Police helicopter", owner: "Sky Sync", line1: "LAPD circling low", distMi: 0.3, bearingDeg: 214,
                         line3: "Since 11:32 PM · 800 ft up", actions: [.init(id: "open_map", title: "See map")], footnote: "Circling 15 min",
                         targetLat: 34.0810, targetLon: -118.3740, updatedAt: now)
        case .plane:
            return .init(kind: "plane", label: "Plane overhead", owner: "Sky Sync", line1: "American 2401 · A321", distMi: 1.2, bearingDeg: 250,
                         line3: "3,400 ft · 210 mph", route: .init(from: "JFK", to: "LAX", progress: 0.96, eta: "Lands 11:58 PM"),
                         targetLat: 34.0780, targetLon: -118.3900, updatedAt: now)
        }
    }
}
