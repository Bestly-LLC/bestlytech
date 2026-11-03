// Bestly Admin: Agents state: the agent list (admin_agents) and one agent's call log at a time.
// Maya, Leo and other template agents use admin_agent_calls. Reese is the older RoofGuard agent and uses the rg_* calls.
import SwiftUI

struct AgentInfo: Identifiable, Equatable {
    var id: String { slug }
    var slug: String
    var name: String
    var what: String
    var unread: Int
    var hi: Color
    var lo: Color
    var isReese: Bool { slug == "reese" }
    var isAva: Bool { slug == "ava" }

    static func == (a: AgentInfo, b: AgentInfo) -> Bool { a.slug == b.slug && a.unread == b.unread }

    static func make(from j: JSON) -> AgentInfo? {
        guard let slug = j.str("slug") else { return nil }
        let name = j.str("name") ?? TKit.titleCase(slug)
        let style: (Color, Color, String)
        switch slug {
        case "ava": style = (AT.hex(0xFFC56B), AT.hex(0xFF9F0A), "Your assistant \u{00B7} messages")
        case "maya": style = (AT.hex(0xE4DFFF), AT.hex(0x8B7CF6), "Bestly customer service and sales")
        case "reese": style = (AT.hex(0xDDF0FF), AT.hex(0x4A9BE0), "RoofGuard partner caller")
        case "leo": style = (AT.hex(0xE6FFB8), AT.hex(0x7FB33A), "Turo trip page voice help")
        default:
            let h = Double(j.int("orb_hue") ?? 200) / 360
            style = (Color(hue: h, saturation: 0.25, brightness: 1), Color(hue: h, saturation: 0.6, brightness: 0.9), j.str("purpose") ?? "Voice agent")
        }
        let (hi, lo, what) = style
        return AgentInfo(slug: slug, name: name, what: what, unread: j.int("unread") ?? 0, hi: hi, lo: lo)
    }
}

struct AgentCall: Identifiable {
    struct Turn: Identifiable { var id: Int; var t: Double; var agent: Bool; var text: String }
    var id: String
    var callNo: Int?
    var direction: String
    var who: String
    var at: Date?
    var duration: Int?
    var summary: String
    var score: Int?
    var tickets: Int
    var unread: Bool
    var archived: Bool
    var hasAudio: Bool
    var isReese: Bool
    // Reese rows carry their message, callback number and transcript right in the list
    var message: String?
    var callback: String?
    var urgent: Bool
    var turns: [Turn]

    var directionWord: String {
        switch direction { case "inbound", "callback": return "Inbound"; case "outbound": return "Outbound"; case "web": return "Web call"; default: return TKit.titleCase(direction) }
    }
    var meta: String {
        var p = [directionWord]
        if let d = duration, d > 0 { p.append(TKit.length(d)) }
        if let s = score { p.append("score \(s) of 10") }
        if tickets > 0 { p.append(tickets == 1 ? "1 ticket" : "\(tickets) tickets") }
        return p.joined(separator: " \u{00B7} ")
    }

    static func make(template j: JSON) -> AgentCall? {
        guard let id = j.str("id") else { return nil }
        let who = [j.str("caller_name"), j.str("phone"), j.str("title")].compactMap { $0 }.first { !$0.isEmpty } ?? "Unknown caller"
        return AgentCall(id: id, callNo: j.int("call_no"), direction: j.str("direction") ?? "inbound", who: who,
                         at: AdminFmt.date(j.str("started_at")), duration: j.int("duration_secs"),
                         summary: j.str("summary") ?? "", score: j.int("score"),
                         tickets: (j["tickets"] as? [Any])?.count ?? 0,
                         unread: j.str("read_at") == nil, archived: j.str("archived_at") != nil,
                         hasAudio: j.bool("has_audio") ?? false, isReese: false,
                         message: nil, callback: nil, urgent: false, turns: [])
    }

    static func make(reese j: JSON) -> AgentCall? {
        guard let id = j.str("id") else { return nil }
        let who = [j.str("caller_name"), j.str("company"), j.str("phone")].compactMap { $0 }.first { !$0.isEmpty } ?? "Unknown caller"
        var turns: [Turn] = []
        for (i, t) in ((j["transcript"] as? [Any]) ?? []).enumerated() {
            guard let o = t as? JSON, let text = o.str("text"), !text.isEmpty else { continue }
            turns.append(Turn(id: i, t: o.dbl("t") ?? 0, agent: o.str("role") == "agent", text: text))
        }
        let msg = j.str("message")
        let cb = (j.bool("callback_wanted") ?? false) ? j.str("callback_number") : nil
        return AgentCall(id: id, callNo: j.int("call_no"), direction: j.str("direction") ?? "inbound", who: who,
                         at: AdminFmt.date(j.str("at")), duration: j.int("duration_sec"),
                         summary: j.str("summary") ?? msg ?? "", score: nil, tickets: 0,
                         unread: j.str("read_at") == nil, archived: false, hasAudio: true, isReese: true,
                         message: msg, callback: cb, urgent: j.bool("urgent") ?? false, turns: turns)
    }
}

@MainActor
final class AgentsModel: ObservableObject {
    @Published var agents: [AgentInfo] = []
    @Published var agentsFailed = false
    @Published var selected = "maya"
    @Published var filter = 0                 // 0 unread, 1 all, 2 archived
    @Published var calls: [AgentCall] = []
    @Published var callsLoaded = false
    @Published var callsFailed = false

    static let filterKeys = ["unread", "all", "archived"]

    var selectedAgent: AgentInfo? { agents.first { $0.slug == selected } }

    func loadAgents() async {
        async let a: Any? = try? await AdminAPI.rpc("admin_agents")
        async let r: Any? = try? await AdminAPI.rpc("rg_inbound_calls", ["p_limit": 50])
        let (av, rv) = await (a, r)
        let rows = TKit.rows(av)
        if rows.isEmpty { if agents.isEmpty { agentsFailed = true; ScreenWatch.failed("agents") { [weak self] in await self?.loadAgents() } }; return }
        agentsFailed = false
        ScreenWatch.ok("agents")
        var list = rows.compactMap(AgentInfo.make(from:))
        if let i = list.firstIndex(where: { $0.isReese }) {
            list[i].unread = TKit.rows(rv).filter { $0.str("read_at") == nil }.count
        }
        let order = ["ava": 0, "maya": 1, "reese": 2, "leo": 3]
        list = list.enumerated().sorted { (order[$0.element.slug] ?? 10 + $0.offset) < (order[$1.element.slug] ?? 10 + $1.offset) }.map { $0.element }
        agents = list
        if !agents.contains(where: { $0.slug == selected }) { selected = agents.first { !$0.isAva }?.slug ?? "maya" }
    }

    func loadCalls() async {
        let slug = selected
        let view = Self.filterKeys[filter]
        do {
            var out: [AgentCall] = []
            if slug == "reese" {
                if view != "archived" {
                    let any = try await AdminAPI.rpc("rg_inbound_calls", ["p_limit": 50])
                    out = TKit.rows(any).compactMap(AgentCall.make(reese:))
                    if view == "unread" { out = out.filter { $0.unread } }
                }
            } else {
                let any = try await AdminAPI.rpc("admin_agent_calls", ["p_slug": slug, "p_view": view, "p_lim": 50])
                out = TKit.rows(any).compactMap(AgentCall.make(template:))
            }
            guard slug == selected, view == Self.filterKeys[filter] else { return }
            calls = out; callsLoaded = true; callsFailed = false
        } catch {
            if slug == selected { callsFailed = true; ScreenWatch.failed("agents") { [weak self] in await self?.loadCalls() } }
        }
    }

    func select(_ slug: String) async {
        guard slug != selected else { return }
        selected = slug; calls = []; callsLoaded = false
        await loadCalls()
    }

    func refresh() async { await loadAgents(); await loadCalls() }
}
