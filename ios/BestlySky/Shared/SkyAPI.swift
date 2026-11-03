// Talks to the wall-live-activity edge function. Shared by the app (token sync, compass) and the Live Activity buttons.
import Foundation

enum SkyAPI {
    static let url = URL(string: "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/wall-live-activity")!
    /// "1.0 (3)": the build number lets the server tell which build is installed (stage cards need build 3 or newer).
    static var appVersion: String {
        let i = Bundle.main.infoDictionary
        return "\(i?["CFBundleShortVersionString"] as? String ?? "1.0") (\(i?["CFBundleVersion"] as? String ?? "0"))"
    }
    static let publishable = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"
    #if DEBUG
    static let env = "sandbox"          // development-signed build -> APNs sandbox
    #else
    static let env = "production"       // TestFlight / App Store build -> APNs production
    #endif

    @discardableResult
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
