// Registers the push-to-start token and every running activity's update token with wall-live-activity, so the Pi
// can start, update and end the aircraft Live Activity by push while the app is closed.
import ActivityKit
import Foundation
import UIKit

enum SkyAPI {
    static let url = URL(string: "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/wall-live-activity")!
    static let publishable = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"
    #if DEBUG
    static let env = "sandbox"          // development-signed build -> APNs sandbox
    #else
    static let env = "production"
    #endif

    static func post(_ body: [String: Any]) async throws -> [String: Any] {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(publishable, forHTTPHeaderField: "apikey")
        req.setValue(SkyKey.value, forHTTPHeaderField: "x-sky-key")     // SkyKey.swift is generated at build time
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
}

@MainActor
final class TokenSync: ObservableObject {
    static let shared = TokenSync()
    @Published var lastRegistered: String = "Not yet"
    private var started = false
    private var watching = Set<String>()

    func start() {
        guard !started else { return }
        started = true
        Task {
            for await data in Activity<AircraftAttributes>.pushToStartTokenUpdates {
                await register(kind: "start", token: data, activityID: nil)
            }
        }
        Task {
            for await activity in Activity<AircraftAttributes>.activityUpdates { watch(activity) }
        }
        for activity in Activity<AircraftAttributes>.activities { watch(activity) }
    }

    private func watch(_ activity: Activity<AircraftAttributes>) {
        guard !watching.contains(activity.id) else { return }
        watching.insert(activity.id)
        Task {
            for await data in activity.pushTokenUpdates {
                await register(kind: "update", token: data, activityID: activity.id)
            }
        }
    }

    private func register(kind: String, token: Data, activityID: String?) async {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        var body: [String: Any] = [
            "op": "register", "kind": kind, "token": hex, "env": SkyAPI.env,
            "device": UIDevice.current.identifierForVendor?.uuidString ?? "iphone",
            "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0",
        ]
        if let a = activityID { body["activity_id"] = a }
        for attempt in 0..<4 {
            if let r = try? await SkyAPI.post(body), r["ok"] as? Bool == true {
                lastRegistered = "\(kind) token · " + Date().formatted(date: .omitted, time: .shortened)
                return
            }
            try? await Task.sleep(for: .seconds(Double(2 << attempt)))
        }
    }
}
