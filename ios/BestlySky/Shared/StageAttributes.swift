// Bestly Admin: the generic StageActivity Live Activity. One card type for anything with stages (or one continuous progress):
// N equal arcs around the icon, or a single arc for 0...1 progress. First user: the car service card (Blue Steel at Costco).
// Keys are shared with the database sender (car_service_native_*) and the wall-live-activity edge function (attr = stage):
// camelCase, unix seconds, no Date types. Every field decodes with a default, so an older payload can never crash the widget.
// The static attributes are set when the card starts: key (unique per card start, also the update-token key), kind, title, icon.
import ActivityKit
import Foundation
import SwiftUI

struct StageAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var stage: Int            // arcs done, 1...stageCount (ignored when stageCount == 0)
        var stageCount: Int       // N equal arcs; 0 = one continuous arc driven by `progress`
        var progress: Double      // 0...1 for the continuous arc
        var stageColor: String    // "#0A84FF"
        var icon: String          // car | wrench | arrow | check | clock | alert | bolt | pin
        var compactWord: String   // "Lot" | "Bay" | "Out" | "Ready" | "Check" (max 6)
        var dotsLine: String      // "●─○─○─○" (may be empty)
        var statusLine: String    // "Parked - Since: 11:47 AM" (max 24)
        var watchLine: String     // max 20, for the Apple Watch; empty = the title
        var subtitle: String      // who signs the card, "Mae"
        var url: String?
        var at: Double
        init(stage: Int = 1, stageCount: Int = 4, progress: Double = 0, stageColor: String = "#0A84FF", icon: String = "car",
             compactWord: String = "", dotsLine: String = "", statusLine: String = "", watchLine: String = "",
             subtitle: String = "", url: String? = nil, at: Double = 0) {
            self.stage = stage
            self.stageCount = stageCount
            self.progress = progress
            self.stageColor = stageColor
            self.icon = icon
            self.compactWord = compactWord
            self.dotsLine = dotsLine
            self.statusLine = statusLine
            self.watchLine = watchLine
            self.subtitle = subtitle
            self.url = url
            self.at = at
        }
        enum CodingKeys: String, CodingKey {
            case stage, stageCount, progress, stageColor, icon, compactWord, dotsLine, statusLine, watchLine, subtitle, url, at
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.init(stage: c.skyValue(.stage, 1),
                      stageCount: c.skyValue(.stageCount, 4),
                      progress: c.skyValue(.progress, 0.0),
                      stageColor: c.skyValue(.stageColor, "#0A84FF"),
                      icon: c.skyValue(.icon, "car"),
                      compactWord: c.skyValue(.compactWord, ""),
                      dotsLine: c.skyValue(.dotsLine, ""),
                      statusLine: c.skyValue(.statusLine, ""),
                      watchLine: c.skyValue(.watchLine, ""),
                      subtitle: c.skyValue(.subtitle, ""),
                      url: try? c.decodeIfPresent(String.self, forKey: .url),
                      at: c.skyValue(.at, 0.0))
        }
    }
    var key: String
    var kind: String
    var title: String
    var icon: String
}

enum StageIcons {
    /// Icon key (sent by the server) -> vector asset in Shared/Icons.xcassets.
    static func asset(_ key: String) -> String {
        switch key {
        case "car": return "mdi-car"
        case "wrench": return "mdi-car-wrench"
        case "arrow": return "mdi-car-arrow-right"
        case "check": return "mdi-check"
        case "clock": return "mdi-car-clock"
        case "alert": return "mdi-alert-circle"
        case "bolt": return "mdi-lightning-bolt"
        case "pin": return "mdi-map-marker"
        default: return "mdi-car"
        }
    }
}
