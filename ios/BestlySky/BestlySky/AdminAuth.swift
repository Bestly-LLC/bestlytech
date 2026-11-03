// Bestly Admin: passkey sign-in and the Supabase session.
// Flow (same as the web admin): webauthn-authenticate options -> platform passkey assertion -> verify returns a
// token_hash -> POST /auth/v1/verify (magiclink) gives the real session (has_role admin works). Passkeys only.
import AuthenticationServices
import Foundation
import Security
import UIKit

enum AdminConfig {
    static let supabaseURL = URL(string: "https://rcqfqhguwpmaarseifqg.supabase.co")!
    static var anonKey: String { SkyAPI.publishable }
    static let origin = "https://www.bestly.tech"
    static let rpId = "www.bestly.tech"
    static let storageKey = "sb-rcqfqhguwpmaarseifqg-auth-token"   // supabase-js v2 localStorage key
    static let userAgentToken = "BestlyAdminApp"
    static let adminBase = "https://www.bestly.tech"
}

extension Data {
    var b64url: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    init?(b64url s: String) {
        var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while t.count % 4 != 0 { t += "=" }
        self.init(base64Encoded: t)
    }
}

enum AdminKeychain {
    private static let service = "tech.bestly.admin.session"
    private static let account = "supabase"
    static func save(_ data: Data) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
        var add = q
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
    static func load() -> Data? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }
    static func clear() {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
    }
}

struct AdminSession {
    var raw: JSON
    var accessToken: String { raw.str("access_token") ?? "" }
    var refreshToken: String { raw.str("refresh_token") ?? "" }
    var expiresAt: TimeInterval { raw.dbl("expires_at") ?? 0 }
    var userId: String? { raw.obj("user")?.str("id") }
    init?(_ json: JSON) {
        var j = json
        guard let a = j.str("access_token"), !a.isEmpty, let r = j.str("refresh_token"), !r.isEmpty else { return nil }
        if j.dbl("expires_at") == nil { j["expires_at"] = Date().timeIntervalSince1970 + (j.dbl("expires_in") ?? 3600) }
        if j["token_type"] == nil { j["token_type"] = "bearer" }
        self.raw = j
    }
    var data: Data { (try? JSONSerialization.data(withJSONObject: raw)) ?? Data() }
    var jsonString: String { String(data: data, encoding: .utf8) ?? "{}" }
}

struct AdminDeviceRequest: Equatable {
    var code: String
    var match: Int
    var expiresAt: Date
}

struct AdminAuthError: LocalizedError {
    var message: String
    var errorDescription: String? { message }
}

@MainActor
final class AdminAuth: NSObject, ObservableObject {
    static let shared = AdminAuth()

    @Published private(set) var isSignedIn = false
    @Published var busy = false
    @Published var error: String?
    @Published var device: AdminDeviceRequest?

    private(set) var session: AdminSession?
    private var refreshTask: Task<String, Error>?
    private var devicePoll: Task<Void, Never>?
    private var refreshTimer: Task<Void, Never>?

    private override init() {
        super.init()
        if let d = AdminKeychain.load(), let j = (try? JSONSerialization.jsonObject(with: d)) as? JSON, let s = AdminSession(j) {
            session = s
            isSignedIn = true
            scheduleRefresh()
            Task { await AdminAPI.flushPending() }
        }
    }

    // MARK: token access

    /// A token that is good for at least a minute; refreshes first when it is not.
    func validAccessToken() async throws -> String {
        guard let s = session else { throw AdminAuthError(message: "Not signed in") }
        if s.expiresAt - 60 > Date().timeIntervalSince1970 { return s.accessToken }
        return try await refresh()
    }

    /// Single-flight refresh. A rejected refresh token signs out; a network error keeps the session.
    @discardableResult
    func refresh() async throws -> String {
        if let t = refreshTask { return try await t.value }
        let task = Task<String, Error> { [weak self] in
            guard let self else { throw AdminAuthError(message: "Not signed in") }
            guard let rt = await self.session?.refreshToken, !rt.isEmpty else { throw AdminAuthError(message: "Not signed in") }
            do {
                let (json, code) = try await AdminAuth.post("/auth/v1/token?grant_type=refresh_token", ["refresh_token": rt])
                guard code == 200, let s = AdminSession(json) else {
                    if code == 400 || code == 401 || code == 403 { await self.dropSession() }
                    throw AdminAuthError(message: json.str("msg") ?? json.str("error_description") ?? "Refresh failed (\(code))")
                }
                await self.store(s)
                return s.accessToken
            } catch {
                await AdminAPI.report("refresh_failed", String(describing: error.localizedDescription))
                throw error
            }
        }
        refreshTask = task
        defer { refreshTask = nil }
        return try await task.value
    }

    private func store(_ s: AdminSession) {
        session = s
        AdminKeychain.save(s.data)
        isSignedIn = true
        scheduleRefresh()
    }

    private func dropSession() {
        session = nil
        AdminKeychain.clear()
        isSignedIn = false
        refreshTimer?.cancel()
    }

    private func scheduleRefresh() {
        refreshTimer?.cancel()
        guard let s = session else { return }
        let wait = max(15, s.expiresAt - Date().timeIntervalSince1970 - 120)
        refreshTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            if Task.isCancelled { return }
            _ = try? await self?.refresh()
        }
    }

    /// The web pages refresh their own copy of the session; take theirs when it is newer so the two never fight.
    func adoptWebSession(_ jsonString: String) {
        guard let d = jsonString.data(using: .utf8), let j = (try? JSONSerialization.jsonObject(with: d)) as? JSON,
              let s = AdminSession(j), let mine = session, s.userId == mine.userId, s.expiresAt > mine.expiresAt else { return }
        store(s)
    }

    func signOut() {
        devicePoll?.cancel()
        device = nil
        dropSession()
        error = nil
        Task { await AdminWeb.clearSession() }
    }

    // MARK: passkey

    func signInWithPasskey() async {
        guard !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let (opt, oc) = try await Self.post("/functions/v1/webauthn-authenticate", ["action": "options", "origin": AdminConfig.origin])
            guard oc == 200, let chStr = opt.str("challenge"), let challenge = Data(b64url: chStr) else {
                throw AdminAuthError(message: opt.str("error") ?? "Sign-in is not available right now")
            }
            let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: AdminConfig.rpId)
            let req = provider.createCredentialAssertionRequest(challenge: challenge)
            req.userVerificationPreference = .preferred
            let auth = try await PasskeyCoordinator().perform([req])
            guard let a = auth.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
                throw AdminAuthError(message: "That was not a passkey")
            }
            let cred: JSON = [
                "id": a.credentialID.b64url, "rawId": a.credentialID.b64url, "type": "public-key",
                "response": [
                    "clientDataJSON": a.rawClientDataJSON.b64url,
                    "authenticatorData": a.rawAuthenticatorData.b64url,
                    "signature": a.signature.b64url,
                    "userHandle": a.userID.b64url,
                ] as JSON,
            ]
            let (ver, vc) = try await Self.post("/functions/v1/webauthn-authenticate", ["action": "verify", "origin": AdminConfig.origin, "credential": cred])
            guard vc == 200, let th = ver.str("token_hash") else {
                throw AdminAuthError(message: ver.str("error") ?? "Sign-in was refused")
            }
            try await exchange(tokenHash: th)
        } catch {
            if (error as? ASAuthorizationError)?.code == .canceled { return }     // he closed the sheet; not a failure
            self.error = error.localizedDescription
            await AdminAPI.report("sign_in_failed", error.localizedDescription)
        }
    }

    private func exchange(tokenHash: String) async throws {
        let (json, code) = try await Self.post("/auth/v1/verify", ["type": "magiclink", "token_hash": tokenHash])
        guard code == 200, let s = AdminSession(json) else {
            throw AdminAuthError(message: json.str("msg") ?? json.str("error_description") ?? "Could not start the session (\(code))")
        }
        store(s)
        Task { await AdminAPI.flushPending() }
    }

    // MARK: approve from another device

    func startDeviceLogin() async {
        guard !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let (j, c) = try await Self.post("/functions/v1/admin-device-login", ["op": "start", "silent": false])
            guard c == 200, j.bool("ok") != false, let code = j.str("code"), let id = j.str("id"), let secret = j.str("secret") else {
                throw AdminAuthError(message: j.str("error") ?? "Could not start. Try again.")
            }
            let exp = AdminFmt.date(j.str("expires_at")) ?? Date().addingTimeInterval(300)
            device = AdminDeviceRequest(code: code, match: j.int("match") ?? 0, expiresAt: exp)
            devicePoll?.cancel()
            devicePoll = Task { [weak self] in await self?.pollDevice(id: id, secret: secret, until: exp) }
        } catch {
            self.error = error.localizedDescription
            await AdminAPI.report("sign_in_failed", "device start: \(error.localizedDescription)")
        }
    }

    func cancelDeviceLogin() {
        devicePoll?.cancel()
        device = nil
    }

    private func pollDevice(id: String, secret: String, until: Date) async {
        while !Task.isCancelled && Date() < until {
            if let (j, _) = try? await Self.post("/functions/v1/admin-device-login", ["op": "poll", "id": id, "secret": secret]) {
                let status = j.str("status")
                if status == "approved", let th = j.str("token_hash") {
                    do { try await exchange(tokenHash: th); device = nil } catch {
                        self.error = error.localizedDescription
                        await AdminAPI.report("sign_in_failed", "device exchange: \(error.localizedDescription)")
                        device = nil
                    }
                    return
                }
                if status == "denied" || status == "expired" || status == "used" {
                    self.error = status == "denied" ? "That sign-in was denied." : "That code expired. Start again."
                    device = nil
                    return
                }
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
        if !Task.isCancelled { device = nil; error = "That code expired. Start again." }
    }

    // MARK: HTTP

    nonisolated static func post(_ path: String, _ body: JSON) async throws -> (JSON, Int) {
        var req = URLRequest(url: URL(string: AdminConfig.supabaseURL.absoluteString + path)!)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(AdminConfig.anonKey, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let json = ((try? JSONSerialization.jsonObject(with: data)) as? JSON) ?? [:]
        return (json, code)
    }
}

/// Runs one AuthenticationServices request and hands back the result.
@MainActor
final class PasskeyCoordinator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var cont: CheckedContinuation<ASAuthorization, Error>?
    private var controller: ASAuthorizationController?
    private var selfRef: PasskeyCoordinator?

    func perform(_ requests: [ASAuthorizationRequest]) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<ASAuthorization, Error>) in
            cont = c
            selfRef = self
            let ctl = ASAuthorizationController(authorizationRequests: requests)
            ctl.delegate = self
            ctl.presentationContextProvider = self
            controller = ctl
            ctl.performRequests()
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        Task { @MainActor in self.cont?.resume(returning: authorization); self.cont = nil; self.selfRef = nil }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        Task { @MainActor in self.cont?.resume(throwing: error); self.cont = nil; self.selfRef = nil }
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? scenes.first?.windows.first ?? ASPresentationAnchor()
        }
    }
}
