// Bestly Admin: one call (matches the approved Call detail screen): recording, coach review, what was collected, transcript, actions.
import SwiftUI

@MainActor
final class CallDetailModel: ObservableObject {
    @Published var detail: JSON?
    @Published var turns: [AgentCall.Turn] = []
    @Published var unread = false
    @Published var archived = false
    @Published var loading = true
    @Published var failed = false
    @Published var error: String?

    func load(_ call: AgentCall) async {
        unread = call.unread; archived = call.archived
        if call.isReese {
            turns = call.turns; loading = false
        } else {
            do {
                let any = try await AdminAPI.rpc("admin_agent_call", ["p_id": call.id])
                if let o = any as? JSON {
                    detail = o
                    var t: [AgentCall.Turn] = []
                    for (i, x) in o.arr("transcript").enumerated() {
                        guard let text = x.str("text"), !text.isEmpty else { continue }
                        t.append(AgentCall.Turn(id: i, t: x.dbl("t") ?? 0, agent: x.str("role") == "agent", text: text))
                    }
                    turns = t
                    if let ra = o.str("read_at") { unread = ra.isEmpty } else { unread = true }
                    archived = o.str("archived_at") != nil
                }
                loading = false
            } catch {
                loading = false; failed = true
            }
        }
        if unread { await markRead(call) }
    }

    private func markRead(_ call: AgentCall) async {
        do {
            if call.isReese { _ = try await AdminAPI.rpc("rg_mark_read", ["p_id": call.id]) }
            else { _ = try await AdminAPI.rpc("admin_agent_call_set", ["p_id": call.id, "p_action": "read"]) }
            unread = false
        } catch { /* stays unread; the list shows it */ }
    }

    func markUnread(_ call: AgentCall) async -> Bool {
        do { _ = try await AdminAPI.rpc("admin_agent_call_set", ["p_id": call.id, "p_action": "unread"]); unread = true; Haptics.ok(); return true }
        catch { self.error = "Couldn't mark it unread. \(error.localizedDescription)"; Haptics.fail(); return false }
    }

    func archive(_ call: AgentCall) async -> Bool {
        do {
            if call.isReese { _ = try await AdminAPI.rpc("rg_archive_call", ["p_id": call.id, "p_archive": true]) }
            else { _ = try await AdminAPI.rpc("admin_agent_call_set", ["p_id": call.id, "p_action": archived ? "unarchive" : "archive"]) }
            Haptics.ok(); return true
        } catch { self.error = "Couldn't archive it. \(error.localizedDescription)"; Haptics.fail(); return false }
    }

    func delete(_ call: AgentCall) async -> Bool {
        do {
            if call.isReese { _ = try await AdminAPI.rpc("rg_delete_call", ["p_id": call.id]) }
            else { _ = try await AdminAPI.rpc("admin_agent_call_set", ["p_id": call.id, "p_action": "delete"]) }
            Haptics.ok(); return true
        } catch { self.error = "Couldn't delete it. \(error.localizedDescription)"; Haptics.fail(); return false }
    }

    // MARK: derived

    var review: JSON? { detail?.obj("review") }
    var tickets: [String] { (detail?["tickets"] as? [Any])?.compactMap { $0 as? String } ?? [] }
    var collected: [(String, String)] {
        guard let d = detail?.obj("data") else { return [] }
        return d.keys.sorted().compactMap { k in
            if k == "coach_skip" { return nil }
            let v = d[k]
            var text: String?
            if let n = v as? NSNumber {
                text = CFGetTypeID(n) == CFBooleanGetTypeID() ? (n.boolValue ? "Yes" : "No") : n.stringValue
            } else if let s = v as? String { text = s }
            guard let t = text, !t.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            return (TKit.titleCase(k), t)
        }
    }
}

struct CallDetailView: View {
    let agent: AgentInfo
    let call: AgentCall
    var onChange: () -> Void

    @StateObject private var d = CallDetailModel()
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDelete = false

    private let callerColor = AT.peach

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                if call.hasAudio { CallAudioCard(fn: call.isReese ? "roofguard-caller" : "agent-hub", callId: call.id, knownLength: call.duration, tint: agent.hi) }
                if call.isReese { messageCard }
                reviewCard
                collectedCard
                ticketsCard
                transcriptCard
                if let e = d.error { TSub(e, color: AT.red) }
                actions
            }
            .padding(.horizontal, 16).padding(.bottom, 32)
        }
        .background(AT.bg.ignoresSafeArea())
        .navigationTitle(agent.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(AT.bg, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task { await d.load(call) }
        .onDisappear { onChange() }
        .confirmationDialog("Delete this call?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete call", role: .destructive) { Task { if await d.delete(call) { dismiss() } } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("The call log entry is removed for good.") }
        .screenView("call")
    }

    // MARK: pieces

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(call.who).font(.system(size: 28, weight: .bold)).foregroundStyle(AT.text).fixedSize(horizontal: false, vertical: true)
            TSub(headerLine)
        }
        .padding(.top, 4)
    }

    private var headerLine: String {
        var parts = [call.directionWord]
        if let a = call.at { parts.append(TKit.when(a)) }
        if let l = call.duration, l > 0 { parts.append(TKit.length(l)) }
        return parts.joined(separator: " \u{00B7} ")
    }

    @ViewBuilder private var messageCard: some View {
        if (call.message ?? "").isEmpty == false || call.callback != nil {
            ATCard {
                VStack(alignment: .leading, spacing: 8) {
                    HStack { TLabel("Message"); Spacer(minLength: 8); if call.urgent { Text("Urgent").font(.system(size: 13, weight: .semibold)).foregroundStyle(AT.orange) } }
                    if let m = call.message, !m.isEmpty { Text(m).font(.system(size: 15)).foregroundStyle(Color(white: 0.9)).lineSpacing(2).fixedSize(horizontal: false, vertical: true) }
                    if let cb = call.callback, !cb.isEmpty { TSub("Wants a call back at \(cb)") }
                }
            }
        }
    }

    @ViewBuilder private var reviewCard: some View {
        if let r = d.review, let score = r.int("score") {
            ATCard {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .firstTextBaseline) {
                        TLabel("Review")
                        Spacer(minLength: 8)
                        Text("\(score) of 10").font(.system(size: 20, weight: .semibold)).foregroundStyle(AT.text).fixedSize()
                    }
                    if let w = r.str("went_well"), !w.isEmpty { reviewBlock("Went well", w, AT.lime) }
                    if let f = r.str("fix"), !f.isEmpty { reviewBlock("Fix next time", f, AT.hex(0xFDBA74)) }
                }
            }
        }
    }

    private func reviewBlock(_ title: String, _ text: String, _ c: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(c)
            Text(text).font(.system(size: 15)).foregroundStyle(Color(white: 0.89)).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var collectedCard: some View {
        let items = d.collected
        if !items.isEmpty {
            ATCard {
                VStack(alignment: .leading, spacing: 10) {
                    TLabel("What the call collected")
                    ForEach(Array(items.enumerated()), id: \.offset) { _, kv in
                        VStack(alignment: .leading, spacing: 1) {
                            TSub(kv.0)
                            Text(kv.1).font(.system(size: 15)).foregroundStyle(Color(white: 0.9)).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private var ticketsCard: some View {
        if !d.tickets.isEmpty {
            ATCard {
                VStack(alignment: .leading, spacing: 6) {
                    TLabel(d.tickets.count == 1 ? "Ticket" : "Tickets")
                    Text(d.tickets.joined(separator: ", ")).font(.system(size: 15)).foregroundStyle(Color(white: 0.9)).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var transcriptCard: some View {
        ATCard {
            VStack(alignment: .leading, spacing: 14) {
                TLabel("Transcript")
                if d.loading { TLoadingLine(text: "Loading the transcript") }
                else if d.failed { TSub("Couldn't load the transcript. Go back and try again.", color: AT.orange) }
                else if d.turns.isEmpty { TSub("No transcript for this call.") }
                ForEach(d.turns) { t in
                    HStack(alignment: .top, spacing: 10) {
                        Text(TKit.mmss(t.t)).font(.system(size: 13).monospacedDigit()).foregroundStyle(AT.secondary).frame(width: 40, alignment: .leading)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(t.agent ? agent.name : "Caller").font(.system(size: 13, weight: .semibold)).foregroundStyle(t.agent ? agent.hi : callerColor)
                            Text(t.text).font(.system(size: 15)).lineSpacing(3).foregroundStyle(Color(white: 0.93)).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    private var actions: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                if !call.isReese {
                    Button { Task { if await d.markUnread(call) { dismiss() } } } label: { Text("Mark unread") }.buttonStyle(.tbtn)
                }
                Button { Task { if await d.archive(call) { dismiss() } } } label: { Text(d.archived ? "Unarchive" : "Archive") }.buttonStyle(.tbtn)
            }
            CallHoldToDelete(title: "Hold to delete call", onConfirm: { Task { if await d.delete(call) { dismiss() } } }, onAccessible: { confirmDelete = true })
                .padding(.top, 18)
        }
        .padding(.top, 4)
    }
}

/// Delete needs a one-second hold. VoiceOver and Switch Control get a normal action that asks first.
struct CallHoldToDelete: View {
    var title: String
    var onConfirm: () -> Void
    var onAccessible: () -> Void
    @State private var progress: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.08))
            GeometryReader { geo in
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(LinearGradient(colors: [AT.red.opacity(0.35), AT.red.opacity(0.10)], startPoint: .leading, endPoint: .trailing))
                    .frame(width: geo.size.width * progress)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            Text(progress > 0 ? "Keep holding" : title).font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.red)
                .frame(maxWidth: .infinity)
        }
        .frame(minHeight: 48)
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: 1.0, maximumDistance: 40, perform: {
            Haptics.thunk(); progress = 0; onConfirm()
        }, onPressingChanged: { pressing in
            if pressing { withAnimation(reduceMotion ? nil : .linear(duration: 1.0)) { progress = 1 } }
            else { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { progress = 0 } }
        })
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Delete call")
        .accessibilityHint("Hold for one second, or use the action, to delete this call.")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onAccessible() }
    }
}
