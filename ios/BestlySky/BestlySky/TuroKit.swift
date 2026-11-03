// Bestly Admin: small shared pieces for the Turo, Home and Agents screens (REST reads, time words, buttons, cards).
import SwiftUI

enum TKit {
    // MARK: network

    private static func authed(_ build: (String) async throws -> Any) async throws -> Any {
        do {
            return try await build(try await AdminAuth.shared.validAccessToken())
        } catch let e as AdminAPIError where e.status == 401 {
            return try await build(try await AdminAuth.shared.refresh())
        }
    }

    /// GET /rest/v1/<path> with the admin session (table reads that rely on admin RLS).
    static func restGet(_ path: String) async throws -> Any {
        try await authed { token in
            let enc = path.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? path
            guard let url = URL(string: AdminConfig.supabaseURL.absoluteString + "/rest/v1/" + enc) else { throw AdminAPIError(status: 400, message: "Bad request") }
            var req = URLRequest(url: url)
            req.timeoutInterval = 25
            req.setValue(AdminConfig.anonKey, forHTTPHeaderField: "apikey")
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (data, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
            guard (200..<300).contains(code) else {
                throw AdminAPIError(status: code, message: (parsed as? JSON)?.str("message") ?? "HTTP \(code)")
            }
            return parsed ?? NSNull()
        }
    }

    /// POST to an edge function that answers with bytes (call recordings). Throws AdminAPIError(404) when there is no recording yet.
    static func postBytes(_ fn: String, _ body: JSON) async throws -> Data {
        let any = try await authed { token in
            var req = URLRequest(url: URL(string: AdminConfig.supabaseURL.absoluteString + "/functions/v1/" + fn)!)
            req.httpMethod = "POST"
            req.timeoutInterval = 60
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue(AdminConfig.anonKey, forHTTPHeaderField: "apikey")
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(code) else { throw AdminAPIError(status: code, message: "HTTP \(code)") }
            return data
        }
        return (any as? Data) ?? Data()
    }

    /// Rows from an RPC that may answer an array or an object wrapping one.
    static func rows(_ any: Any?) -> [JSON] {
        if let a = any as? [Any] { return a.compactMap { $0 as? JSON } }
        if let o = any as? JSON {
            for k in ["rows", "calls", "items", "data"] { if let a = o[k] as? [Any] { return a.compactMap { $0 as? JSON } } }
        }
        return []
    }

    // MARK: time words (LA time, 12-hour)

    static func ago(_ d: Date, now: Date = Date()) -> String {
        let s = max(0, Int(now.timeIntervalSince(d)))
        if s < 60 { return "\(max(1, s))\u{00A0}sec" }
        if s < 3600 { return "\(s / 60)\u{00A0}min" }
        if s < 48 * 3600 { return "\(s / 3600)\u{00A0}hr" }
        return "\(s / 86400)\u{00A0}days"
    }

    private static func fmt(_ pattern: String) -> DateFormatter {
        let d = DateFormatter(); d.locale = Locale(identifier: "en_US_POSIX"); d.timeZone = AdminFmt.la; d.dateFormat = pattern; return d
    }
    static let dayLong = fmt("EEE, MMM d")
    static let dayShort = fmt("EEE")
    private static var cal: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = AdminFmt.la; return c }

    static func clock(_ d: Date) -> String { glue(AdminFmt.time.string(from: d)) }

    /// A time in the past or future: "3:05 PM", "Yesterday 3:05 PM", "Mon 3:05 PM", "Tomorrow 3:05 PM".
    static func when(_ d: Date, now: Date = Date()) -> String {
        let c = cal
        let t = AdminFmt.time.string(from: d)
        if c.isDate(d, inSameDayAs: now) { return glue("Today \(t)") }
        if let y = c.date(byAdding: .day, value: -1, to: now), c.isDate(d, inSameDayAs: y) { return glue("Yesterday \(t)") }
        if let n = c.date(byAdding: .day, value: 1, to: now), c.isDate(d, inSameDayAs: n) { return glue("Tomorrow \(t)") }
        return glue(AdminFmt.dayTime.string(from: d))
    }

    /// Call lengths: "2 min 14 sec", "45 sec".
    static func length(_ secs: Int) -> String {
        if secs < 60 { return "\(secs)\u{00A0}sec" }
        let m = secs / 60, s = secs % 60
        return s == 0 ? "\(m)\u{00A0}min" : "\(m)\u{00A0}min \(s)\u{00A0}sec"
    }
    static func mmss(_ t: Double) -> String {
        let s = max(0, Int(t.rounded(.down)))
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    static func titleCase(_ s: String) -> String {
        let w = s.replacingOccurrences(of: "_", with: " ")
        return w.prefix(1).uppercased() + w.dropFirst()
    }
}

// MARK: - shared views

struct TLabel: View {
    var text: String
    init(_ t: String) { text = t }
    var body: some View {
        Text(text.uppercased()).font(.system(size: 13, weight: .semibold)).tracking(0.3).foregroundStyle(AT.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct TSub: View {
    var text: String
    var color: Color = AT.secondary
    init(_ t: String, color: Color = AT.secondary) { text = t; self.color = color }
    var body: some View {
        Text(text).font(.system(size: 13)).foregroundStyle(color).fixedSize(horizontal: false, vertical: true)
    }
}

struct TPill: View {
    var text: String
    var tint: Color = Color(white: 0.89)
    init(_ t: String, tint: Color = Color(white: 0.89)) { text = t; self.tint = tint }
    var body: some View {
        Text(text).font(.system(size: 13)).foregroundStyle(tint)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(AT.inner, in: Capsule())
            .fixedSize(horizontal: true, vertical: true)
    }
}

struct TBtnStyle: ButtonStyle {
    var fill: Color = Color.white.opacity(0.08)
    var fg: Color = AT.text
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(fg)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.horizontal, 10)
            .background(fill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .opacity(enabled ? (configuration.isPressed && reduceMotion ? 0.7 : 1) : 0.45)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
    }
}
extension ButtonStyle where Self == TBtnStyle {
    static var tbtn: TBtnStyle { TBtnStyle() }
    static var tlime: TBtnStyle { TBtnStyle(fill: AT.lime, fg: AT.bg) }
    static var tdanger: TBtnStyle { TBtnStyle(fg: AT.red) }
}

/// A switch that always has a 44 pt target.
struct TSwitch: View {
    @Binding var isOn: Bool
    var label: String
    var onChange: ((Bool) -> Void)? = nil
    var body: some View {
        Toggle(label, isOn: Binding(get: { isOn }, set: { v in isOn = v; Haptics.select(); onChange?(v) }))
            .labelsHidden()
            .tint(AT.green)
            .frame(minWidth: 51, minHeight: 44)
            .accessibilityLabel(label)
    }
}

/// Segmented control in the approved look (dark track, raised selected segment).
struct TSegments: View {
    var options: [String]
    @Binding var selection: Int
    var onPick: ((Int) -> Void)? = nil
    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(options.enumerated()), id: \.offset) { i, name in
                Button {
                    Haptics.select(); selection = i; onPick?(i)
                } label: {
                    Text(name).font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(i == selection ? AT.text : Color(white: 0.83))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(i == selection ? Color(white: 0.23) : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(i == selection ? .isSelected : [])
            }
        }
        .padding(2)
        .background(AT.inner, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct TLoadingLine: View {
    var text: String
    var body: some View {
        HStack(spacing: 8) { ProgressView().tint(AT.secondary); TSub(text) }
    }
}

extension View {
    /// Dark screen with the large title the approved designs use.
    func tScreen(_ title: String) -> some View {
        self
            .background(AT.bg.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AT.bg, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

/// Small toast line shown at the bottom of a screen for a few seconds.
struct TToast: ViewModifier {
    @Binding var text: String?
    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let t = text {
                Text(t).font(.system(size: 15)).foregroundStyle(AT.text)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16).padding(.vertical, 12).frame(minHeight: 44)
                    .background(AT.inner, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .shadow(color: .black.opacity(0.35), radius: 14)
                    .padding(.horizontal, 16).padding(.bottom, 12)
                    .task(id: t) { try? await Task.sleep(nanoseconds: 3_500_000_000); text = nil }
                    .transition(.opacity)
            }
        }
    }
}
extension View { func tToast(_ text: Binding<String?>) -> some View { modifier(TToast(text: text)) } }
