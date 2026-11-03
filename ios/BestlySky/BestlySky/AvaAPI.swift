// Talks to the ava-inbox edge function. Same auth as wall-live-activity: the publishable apikey plus the app key (x-sky-key).
import Foundation

enum AvaAPI {
    static let base = URL(string: "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/ava-inbox")!
    struct Page: Decodable {
        var items: [AvaItem]
        var next_before: String?
    }
    private struct Wrapped: Decodable { var item: AvaItem }

    private static func call(_ sub: String, method: String, query: [URLQueryItem] = [], body: [String: Any]? = nil) async throws -> Data {
        var comps = URLComponents(url: sub.isEmpty ? base : base.appendingPathComponent(sub), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(SkyAPI.publishable, forHTTPHeaderField: "apikey")
        req.setValue(SkyKey.value, forHTTPHeaderField: "x-sky-key")
        if let b = body { req.httpBody = try JSONSerialization.data(withJSONObject: b) }
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let h = resp as? HTTPURLResponse, !(200..<300).contains(h.statusCode) { throw URLError(.badServerResponse) }
        return data
    }
    static func list(before: String? = nil, limit: Int = 50) async throws -> Page {
        var q = [URLQueryItem(name: "limit", value: String(limit))]
        if let b = before { q.append(URLQueryItem(name: "before", value: b)) }
        return try JSONDecoder().decode(Page.self, from: try await call("", method: "GET", query: q))
    }
    static func setForwarded(_ item: AvaItem, _ value: Bool) async throws -> AvaItem {
        let data = try await call("forwarded", method: "POST", body: ["id": item.wireId, "forwarded": value])
        if let it = try? JSONDecoder().decode(AvaItem.self, from: data) { return it }
        if let w = try? JSONDecoder().decode(Wrapped.self, from: data) { return w.item }
        var copy = item; copy.forwarded = value
        return copy
    }
    static func markRead(_ item: AvaItem) async throws {
        _ = try await call("read", method: "POST", body: ["id": item.wireId])
    }
}
