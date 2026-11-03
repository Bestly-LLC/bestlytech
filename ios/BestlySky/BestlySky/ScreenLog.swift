// Bestly Admin: screen views and screen load failures go to the Scout watchdog (admin_app_report).
// screen_view is ignored by the watchdog (it only shows which screens get used); screen_load_failed counts toward admin.app.failing.
import SwiftUI

extension View {
    /// Reports "screen_view" with the screen name (at most once per 30 s per screen).
    func screenView(_ name: String) -> some View {
        onAppear { Task { await AdminAPI.report("screen_view", name) } }
    }
}

@MainActor
enum ScreenWatch {
    private static var attempts: [String: Int] = [:]
    private static var retrying: Set<String> = []

    /// A screen could not load. Tells Scout (once a minute per screen) and, if given, retries on its own after 5, 15 then 45 s.
    static func failed(_ screen: String, retry: (() async -> Void)? = nil) {
        Task { await AdminAPI.report("screen_load_failed", screen) }
        guard let retry, !retrying.contains(screen) else { return }
        let n = attempts[screen] ?? 0
        guard n < 3 else { return }
        attempts[screen] = n + 1
        retrying.insert(screen)
        let wait: UInt64 = [5, 15, 45][n]
        Task {
            try? await Task.sleep(nanoseconds: wait * 1_000_000_000)
            retrying.remove(screen)
            await retry()
        }
    }

    /// The screen loaded: reset the backoff.
    static func ok(_ screen: String) { attempts[screen] = nil }
}
