// Bestly Admin: one runner for every button that touches the server.
// Retry once, check the effect, tell Jared plainly when it fails, and report to Scout so a silent dead button cannot happen.
import SwiftUI

struct ActionFailure: Identifiable {
    let id = UUID()
    var at: Date
    var actionId: String
    var reason: String
}

@MainActor
final class ActionToastCenter: ObservableObject {
    static let shared = ActionToastCenter()
    @Published var message: String?
    @Published var isError = false
    private var token = 0

    func show(_ text: String, error: Bool) {
        token += 1
        let mine = token
        message = text
        isError = error
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: error ? 5_000_000_000 : 2_500_000_000)
            guard let self, self.token == mine else { return }
            self.message = nil
        }
    }
    func dismiss() { token += 1; message = nil }
}

@MainActor
enum Action {
    /// Last 20 failures, newest first (More > long-press the build footer).
    static var lastFailures: [ActionFailure] = []
    private static var lastReported: [String: Date] = [:]

    /// Runs one button's server call with retry, effect check, toast and Scout report.
    @discardableResult
    static func run(_ id: String,
                    idempotent: Bool = true,
                    okSay: String? = nil,
                    attempt: @escaping () async throws -> Any?,
                    verify: (() async -> Bool)? = nil) async -> Bool {
        var failure: String?
        var tries = 0
        let maxTries = idempotent ? 2 : 1
        while tries < maxTries {
            tries += 1
            do {
                let result = try await attempt()
                if let bad = resultProblem(result) { failure = bad } else { failure = nil }
            } catch {
                failure = reason(for: error)
            }
            guard failure != nil else { break }
            if tries < maxTries, !isPermanent(failure!) { try? await Task.sleep(nanoseconds: 1_500_000_000) } else { break }
        }
        if failure == nil, let verify {
            var seen = await verify()
            if !seen {
                for delay in [1.0, 1.5, 2.5, 3.0] {          // checks at about 1 s, 2.5 s, 5 s and 8 s after the call
                    try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    if await verify() { seen = true; break }
                }
            }
            if !seen { failure = "the change didn't show up on the server" }
        }
        if let failure {
            fail(id, failure)
            return false
        }
        Haptics.ok()
        if let okSay { ActionToastCenter.shared.show(okSay, error: false) }
        return true
    }

    // MARK: failure handling

    private static func fail(_ id: String, _ reason: String) {
        Haptics.fail()
        ActionToastCenter.shared.show("That didn't work: \(reason). Scout has it.", error: true)
        lastFailures.insert(ActionFailure(at: Date(), actionId: id, reason: reason), at: 0)
        if lastFailures.count > 20 { lastFailures.removeLast(lastFailures.count - 20) }
        let now = Date()
        if let last = lastReported[id], now.timeIntervalSince(last) < 60 { return }
        lastReported[id] = now
        Task { await AdminAPI.reportAction(id, reason) }
    }

    /// A 2xx body that still says no: {"ok": false} or an "error" key.
    private static func resultProblem(_ result: Any?) -> String? {
        guard let obj = result as? JSON else { return nil }
        if let e = obj["error"], !(e is NSNull) {
            let s = (e as? String) ?? "\(e)"
            if !s.isEmpty { return plain(s) }
        }
        if let ok = obj["ok"] as? Bool, ok == false { return "the server said no" }
        return nil
    }

    private static func reason(for error: Error) -> String {
        if let u = error as? URLError {
            switch u.code {
            case .timedOut: return "no answer"
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed: return "no connection"
            default: break
            }
        }
        if let a = error as? AdminAPIError {
            if a.status == 401 || a.status == 403 { return "you're signed out" }
            if a.status == 404 { return "the app and server disagree" }
            return plain(a.message)
        }
        return plain(error.localizedDescription)
    }

    /// Server text to short plain words.
    private static func plain(_ raw: String) -> String {
        let s = raw.lowercased()
        if s.contains("not_admin") || s.contains("not admin") || s.contains("jwt") || s.contains("not authenticated") { return "you're signed out" }
        if s.contains("could not find the function") || s.contains("does not exist") || s.contains("pgrst202") || s.contains("pgrst203") || s.contains("42883") { return "the app and server disagree" }
        if s.contains("timed out") || s.contains("timeout") { return "no answer" }
        if s.contains("permission denied") { return "not allowed" }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "the server said no" }
        return String(trimmed.prefix(80))
    }

    private static func isPermanent(_ reason: String) -> Bool {
        reason == "you're signed out" || reason == "the app and server disagree" || reason == "not allowed"
    }
}

/// Global toast. Attached once in RootView.
struct ActionToast: View {
    @ObservedObject private var center = ActionToastCenter.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack {
            Spacer()
            if let text = center.message {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: center.isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(center.isError ? AT.orange : AT.lime)
                    Text(text)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(AT.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .frame(minHeight: 44)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .background(AT.card.opacity(0.85), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .shadow(color: .black.opacity(0.35), radius: 18, x: 0, y: 6)
                .padding(.horizontal, 16)
                .padding(.bottom, 64)
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .bottom)))
                .onTapGesture { center.dismiss() }
                .accessibilityElement(children: .combine)
            }
        }
        .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.85), value: center.message)
        .allowsHitTesting(center.message != nil)
    }
}
