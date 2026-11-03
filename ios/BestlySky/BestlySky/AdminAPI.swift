// Bestly Admin: calls the same RPCs and edge functions the web admin uses, with the admin session.
// Failures are reported to admin_app_report (throttled) so the Scout watchdog can see the app misbehaving.
import Foundation

struct AdminAPIError: LocalizedError {
    var status: Int
    var message: String
    var errorDescription: String? { message }
}

enum AdminAPI {
    private static var lastReport: [String: Date] = [:]
    private static let pendingKey = "adminPendingReports"

    /// POST /rest/v1/rpc/<name>
    static func rpc(_ name: String, _ params: JSON = [:]) async throws -> Any {
        try await call("/rest/v1/rpc/\(name)", params, label: "rpc \(name)")
    }

    /// POST /functions/v1/<fn>
    static func invoke(_ fn: String, _ body: JSON = [:]) async throws -> Any {
        try await call("/functions/v1/\(fn)", body, label: "fn \(fn)")
    }

    private static func call(_ path: String, _ body: JSON, label: String) async throws -> Any {
        do {
            return try await send(path, body, token: try await AdminAuth.shared.validAccessToken())
        } catch let e as AdminAPIError where e.status == 401 {
            do {
                let fresh = try await AdminAuth.shared.refresh()
                return try await send(path, body, token: fresh)
            } catch {
                await report("api_failed", "\(label): \(error.localizedDescription)")
                throw error
            }
        } catch {
            await report("api_failed", "\(label): \(error.localizedDescription)")
            throw error
        }
    }

    private static func send(_ path: String, _ body: JSON, token: String) async throws -> Any {
        var req = URLRequest(url: URL(string: AdminConfig.supabaseURL.absoluteString + path)!)
        req.httpMethod = "POST"
        req.timeoutInterval = path.contains("admin-chat") ? 130 : 25
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(AdminConfig.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        guard (200..<300).contains(code) else {
            let msg = (parsed as? JSON)?.str("message") ?? (parsed as? JSON)?.str("error") ?? "HTTP \(code)"
            throw AdminAPIError(status: code, message: msg)
        }
        return parsed ?? NSNull()
    }

    // MARK: watchdog reporting

    /// Throttled to one per kind per minute (screen_view and screen_load_failed: one per screen name; views every 30 s).
    /// Without a session the report waits on the phone and goes out after the next sign-in (screen views are dropped).
    static func report(_ kind: String, _ detail: String) async {
        let now = Date()
        let perScreen = kind == "screen_view" || kind == "screen_load_failed"
        let key = perScreen ? kind + "|" + detail : kind
        let window: TimeInterval = kind == "screen_view" ? 30 : 60
        if let last = lastReport[key], now.timeIntervalSince(last) < window { return }
        lastReport[key] = now
        let signedIn = await MainActor.run { AdminAuth.shared.isSignedIn }
        guard signedIn else { if kind != "screen_view" { queue(kind, detail, now) }; return }
        await sendReport(kind, detail)
    }

    private static func sendReport(_ kind: String, _ detail: String) async {
        // Current token as is: never refresh from here (a failed refresh reports itself, and waiting on it would deadlock).
        guard let token = await MainActor.run(body: { AdminAuth.shared.session?.accessToken }), !token.isEmpty else { queue(kind, detail, Date()); return }
        _ = try? await send("/rest/v1/rpc/admin_app_report",
                            ["p_kind": kind, "p_detail": String(detail.prefix(400)), "p_version": SkyAPI.appVersion], token: token)
    }

    private static func queue(_ kind: String, _ detail: String, _ at: Date) {
        var list = UserDefaults.standard.array(forKey: pendingKey) as? [[String: Any]] ?? []
        list.append(["k": kind, "d": detail, "t": at.timeIntervalSince1970])
        UserDefaults.standard.set(Array(list.suffix(10)), forKey: pendingKey)
    }

    /// After a sign-in: send the recent reports that were waiting (older than 30 minutes is noise).
    static func flushPending() async {
        let list = UserDefaults.standard.array(forKey: pendingKey) as? [[String: Any]] ?? []
        UserDefaults.standard.removeObject(forKey: pendingKey)
        let cutoff = Date().timeIntervalSince1970 - 1800
        for item in list.suffix(5) {
            guard let k = item["k"] as? String, let d = item["d"] as? String, (item["t"] as? Double ?? 0) > cutoff else { continue }
            await sendReport(k, "(queued) " + d)
        }
    }
}
