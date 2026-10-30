// Registers the push-to-start token and every running activity's update token with wall-live-activity, so the Pi
// can start, update and end the aircraft Live Activity by push while the app is closed.
import ActivityKit
import Foundation
import UIKit

@MainActor
final class TokenSync: ObservableObject {
    static let shared = TokenSync()
    @Published var lastRegistered: String = "Not yet"
    private var started = false
    private var watching = Set<String>()

    func start() {
        guard !started else { return }
        started = true
        track(AircraftAttributes.self, attr: "aircraft")
        track(TuroReturnAttributes.self, attr: "turo")
    }

    /// One push-to-start token per attributes type, plus every running activity's update token.
    private func track<A: ActivityAttributes>(_ type: A.Type, attr: String) {
        Task {
            for await data in Activity<A>.pushToStartTokenUpdates {
                await register(kind: "start", attr: attr, token: data, activityID: nil)
            }
        }
        Task {
            for await activity in Activity<A>.activityUpdates { watch(activity, attr: attr) }
        }
        for activity in Activity<A>.activities { watch(activity, attr: attr) }
        NSLog("SkyTokens: %@ running activities at launch: %d", attr, Activity<A>.activities.count)
    }

    private func watch<A: ActivityAttributes>(_ activity: Activity<A>, attr: String) {
        guard !watching.contains(activity.id) else { return }
        watching.insert(activity.id)
        NSLog("SkyTokens: watching %@ activity %@", attr, activity.id)
        Task {
            for await data in activity.pushTokenUpdates {
                await register(kind: "update", attr: attr, token: data, activityID: activity.id)
            }
        }
        // Belt and braces: the token stream can stay silent after a background wake; poll the property for a while too.
        Task {
            var last: Data?
            for _ in 0..<120 {
                if activity.activityState == .ended || activity.activityState == .dismissed { return }
                NSLog("SkyTokens: poll %@ %@ state=%@ token=%@", attr, activity.id, String(describing: activity.activityState), activity.pushToken == nil ? "nil" : "set")
                if let t = activity.pushToken, t != last {
                    last = t
                    await register(kind: "update", attr: attr, token: t, activityID: activity.id)
                }
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    private func register(kind: String, attr: String, token: Data, activityID: String?) async {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        var body: [String: Any] = [
            "op": "register", "kind": kind, "attr": attr, "token": hex, "env": SkyAPI.env,
            "device": UIDevice.current.identifierForVendor?.uuidString ?? "iphone",
            "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0",
        ]
        if let a = activityID { body["activity_id"] = a }
        for attempt in 0..<4 {
            let res = try? await SkyAPI.post(body)
            NSLog("SkyTokens: register %@ %@ attempt %d ok=%@", attr, kind, attempt, String(describing: res?["ok"]))
            if let r = res, r["ok"] as? Bool == true {
                lastRegistered = "\(attr) \(kind) token · " + Date().formatted(date: .omitted, time: .shortened)
                return
            }
            try? await Task.sleep(for: .seconds(Double(2 << attempt)))
        }
    }
}
