// Bestly Sky: the Turo RETURN Live Activity (2026-10-06). Content state is built by the Pi (server.py "TURO RETURN LIVE ACTIVITY",
// _sky_ret_state) and delivered by the Supabase edge function wall-live-activity with attr=turo.
// Keys MUST match the JSON the Pi sends (camelCase, unix seconds, no Date types). The Pi pre-formats every string
// (12-hour times, non-breaking spaces between a number and its unit) so the widget stays dumb and never truncates.

import ActivityKit
import Foundation
import SwiftUI

struct TuroReturnAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var tripId: String
        var who: String            // "Hanseung · Blue Steel" (the Pi drops the car name when it would not fit)
        var status: String         // "Due 9 PM" | "Heading home" | "Back home" | "Done" | "Check the car"
        var big: String            // "Home ~8:42 PM" | "Back 8:59 PM" | "All good" | "Crash alert"
        var place: String?         // "23 min · 11 mi away" | "Kings Rd · 300 ft north"
        var pin: Bool              // show the pin glyph before `place`
        var charge: String         // "71% charge · on time" | "Low 33% · was 82%"
        var sc: String?            // "4 Supercharger stops · $36 to bill back"
        var stage: Int             // 0 out, 1 heading home, 2 back, 3 done
        var low: Bool              // came back low: "!" on dot 3
        var issue: Bool            // something else found at the end: "!" on the last dot (hook, no data source yet)
        var icon: String           // "ret" | "check" | "low" | "alert" | "ev"
        var tint: String           // "#0A84FF"
        var trail: String          // Dynamic Island compact trailing: "8:42" | "Back" | "Done" | "33%" | "Check" | "9"
        var trailSmall: String?    // "PM"
        var etaAt: Double?         // unix seconds: arrival estimate (drives the live last quarter of the ring)
        var etaStart: Double?      // unix seconds: when the car started heading home
        var url: String?           // trip page (tap on the card)
        var at: Double
    }

    var label: String
}

extension TuroReturnAttributes.ContentState {
    /// 0...1 of the ring that is static.
    var baseFraction: Double {
        switch stage {
        case 0: return 0.25
        case 1: return 0.75
        default: return 1
        }
    }

    /// 0...1 progress of the last quarter toward the ETA while heading home (the Pi re-pushes every ~90 s while driving and
    /// whenever the ETA shifts). iOS has no arc-shaped timer view (its circular timer draws a clock hand), so the fill is drawn here.
    func liveFraction(now: Date = Date()) -> Double {
        guard stage == 1, let eta = etaAt, let start = etaStart, eta - start >= 60 else { return 0 }
        return min(1, max(0, (now.timeIntervalSince1970 - start) / (eta - start)))
    }

    /// Whole ring: static quarters plus the live last quarter.
    var ringFraction: Double { baseFraction + (stage == 1 ? 0.25 * liveFraction() : 0) }

    static func demo(stage: Int, low: Bool = false, issue: Bool = false, long: Bool = false) -> Self {
        let now = Date().timeIntervalSince1970
        let tint = (stage == 3 && issue) || (stage >= 2 && low) ? "#FF9F0A" : stage == 3 ? "#30D158" : "#0A84FF"
        let icon = stage == 3 && issue ? "alert" : stage >= 2 && low ? "low" : stage == 3 ? "check" : "ret"
        let nb = "\u{00A0}"
        let who = long ? "Maximiliano" : "Hanseung · Blue Steel"
        let big = ["Out on the trip", "Home ~8:42\(nb)PM", "Back 8:59\(nb)PM", issue ? "Crash alert" : "All good"][stage]
        let place = [
            "62\(nb)mi from home", "23\(nb)min · 11\(nb)mi away",
            long ? "Willoughby Ave · 2 blocks away" : "Kings Rd · 300\(nb)ft north",
            long ? "Willoughby Ave · 2 blocks away" : "Out front of 733",
        ][stage]
        let trail = [("9", "PM"), ("8:42", "PM"), (low ? "33%" : "Back", nil), (issue ? "Check" : "Done", nil)][stage]
        return .init(
            tripId: "demo", who: who,
            status: ["Due 9\(nb)PM", "Heading home", "Back home", issue ? "Check the car" : "Done"][stage],
            big: big, place: place, pin: stage >= 2,
            charge: low && stage >= 2 ? "Low 33% · was 82%" : "71% charge · on time",
            sc: "4\(nb)Supercharger\(nb)stops · $36\(nb)to\(nb)bill\(nb)back",
            stage: stage, low: low, issue: issue, icon: icon, tint: tint,
            trail: trail.0, trailSmall: trail.1,
            etaAt: stage == 1 ? now + 20 * 60 : nil, etaStart: stage == 1 ? now - 20 * 60 : nil,
            url: nil, at: now)
    }
}
