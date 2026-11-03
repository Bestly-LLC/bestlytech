// Bestly Admin: Tinker, the home automation engineer. "Make it" drafts a new automation (ha-automator) and shows a preview;
// "Fix a problem" asks Tinker to find out why something misbehaves (ha-fixer). Nothing is installed or applied without a tap here.
import SwiftUI

@MainActor
final class HomeTinkerModel: ObservableObject {
    @Published var maker: JSON?
    @Published var fix: JSON?
    @Published var busy = false
    @Published var error: String?
    @Published var fixError: String?

    private var makerWatch: Task<Void, Never>?
    private var fixWatch: Task<Void, Never>?
    private var dismissed: Set<String> = []

    private let makerCols = "id,status,title,summary,assumptions,risky,risk_reason,error,kind,wait_tries,request,enabled,updated_at"
    private let fixCols = "id,status,stage,question,timeline,story,culprit,confidence,fix,before_plain,after_plain,risky,risk_reason,error,needs_agent_update,wait_tries,restart_note,window_note,updated_at"

    private func since() -> String { AdminFmt.isoPlain.string(from: Date().addingTimeInterval(-86400)) }

    /// Picks up work Tinker is already doing (or finished in the last day) so the card is right after a restart.
    func refresh() async {
        if maker == nil || makerStatus == "" {
            let q = "ha_automations?select=\(makerCols)&updated_at=gte.\(since())&status=in.(drafting,preview,installing,installed,failed,handoff,undoing)&order=created_at.desc&limit=1"
            if let row = TKit.rows(try? await TKit.restGet(q)).first, let id = row.str("id"), !dismissed.contains(id) { maker = row; watchMaker() }
        }
        if fix == nil {
            let q = "ha_fixes?select=\(fixCols)&updated_at=gte.\(since())&status=in.(gathering,analyzing,proposed,diagnosed,applying,applied,undoing,failed,handoff)&order=created_at.desc&limit=1"
            if let row = TKit.rows(try? await TKit.restGet(q)).first, let id = row.str("id"), !dismissed.contains(id) { fix = row; watchFix() }
        }
    }

    var makerStatus: String { maker?.str("status") ?? "" }
    var fixStatus: String { fix?.str("status") ?? "" }

    // MARK: watching

    private func watchMaker() {
        makerWatch?.cancel()
        guard let id = maker?.str("id") else { return }
        makerWatch = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let busyStates: Set<String> = ["drafting", "installing", "undoing"]
                if !busyStates.contains(self.makerStatus) { return }
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                if Task.isCancelled { return }
                if let row = TKit.rows(try? await TKit.restGet("ha_automations?select=\(self.makerCols)&id=eq.\(id)")).first { self.maker = row }
            }
        }
    }

    private func watchFix() {
        fixWatch?.cancel()
        guard let id = fix?.str("id") else { return }
        fixWatch = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let busyStates: Set<String> = ["gathering", "analyzing", "applying", "undoing"]
                if !busyStates.contains(self.fixStatus) { return }
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                if Task.isCancelled { return }
                if let row = TKit.rows(try? await TKit.restGet("ha_fixes?select=\(self.fixCols)&id=eq.\(id)")).first { self.fix = row }
            }
        }
    }

    // MARK: calls

    /// Did the row move (new status or newer update) after the call? Used as the effect check for every Tinker button.
    private func rowMoved(_ table: String, _ cols: String, id: String, before: JSON?, wantStatus: Set<String>? = nil) async -> Bool {
        guard let row = TKit.rows(try? await TKit.restGet("\(table)?select=\(cols)&id=eq.\(id)")).first else { return false }
        let st = row.str("status") ?? ""
        if let wantStatus { return wantStatus.contains(st) }
        guard let before else { return true }
        return st != (before.str("status") ?? "") || row.str("updated_at") != before.str("updated_at")
    }

    /// Make tab ops. Returns true when it worked.
    @discardableResult
    func makerOp(_ op: String, _ extra: JSON = [:]) async -> Bool {
        busy = true; error = nil
        defer { busy = false }
        var body = extra; body["op"] = op
        let rowId = maker?.str("id")
        if op != "generate", let rowId { body["id"] = rowId }
        let before = maker
        var serverError: String?
        var answered: JSON?
        let idem = (op == "discard")
        let ok = await Action.run("home.tinker_\(op)", idempotent: idem, attempt: {
            let r = try await AdminAPI.invoke("ha-automator", body) as? JSON
            serverError = r?.bool("ok") == false ? (r?.str("error") ?? "Tinker couldn't do that.") : nil
            answered = r
            return r
        }, verify: { [self] in
            guard let id = answered?.obj("row")?.str("id") ?? rowId else { return false }
            switch op {
            case "generate": return await rowMoved("ha_automations", makerCols, id: id, before: nil)
            case "discard": return await rowMoved("ha_automations", makerCols, id: id, before: nil, wantStatus: ["discarded"])
            default: return await rowMoved("ha_automations", makerCols, id: id, before: before)
            }
        })
        if !ok { error = serverError ?? "That didn't go through. Scout has it."; return false }
        if op == "discard" { if let id = rowId { dismissed.insert(id) }; maker = nil; return true }
        if let row = answered?.obj("row") { maker = row }
        if let id = maker?.str("id"), let full = TKit.rows(try? await TKit.restGet("ha_automations?select=\(makerCols)&id=eq.\(id)")).first { maker = full }
        watchMaker()
        return true
    }

    func dismissMaker() { if let id = maker?.str("id") { dismissed.insert(id) }; maker = nil; error = nil }

    func fixOp(_ op: String, _ extra: JSON = [:]) async {
        busy = true; fixError = nil
        defer { busy = false }
        var body = extra; body["op"] = op
        let rowId = fix?.str("id")
        if op != "diagnose", let rowId { body["id"] = rowId }
        let before = fix
        var serverError: String?
        var answered: JSON?
        let ok = await Action.run("home.fix_\(op)", idempotent: op == "discard", attempt: {
            let r = try await AdminAPI.invoke("ha-fixer", body) as? JSON
            serverError = r?.bool("ok") == false ? (r?.str("error") ?? "Tinker couldn't do that.") : nil
            answered = r
            return r
        }, verify: { [self] in
            guard let id = answered?.obj("row")?.str("id") ?? rowId else { return false }
            switch op {
            case "diagnose": return await rowMoved("ha_fixes", fixCols, id: id, before: nil)
            case "discard": return await rowMoved("ha_fixes", fixCols, id: id, before: nil, wantStatus: ["discarded"])
            default: return await rowMoved("ha_fixes", fixCols, id: id, before: before)
            }
        })
        if !ok { fixError = serverError ?? "That didn't go through. Scout has it."; return }
        if op == "discard" { if let id = rowId { dismissed.insert(id) }; fix = nil; return }
        if let row = answered?.obj("row") { fix = row }
        if let id = fix?.str("id"), let full = TKit.rows(try? await TKit.restGet("ha_fixes?select=\(fixCols)&id=eq.\(id)")).first { fix = full }
        watchFix()
    }

    func dismissFix() { if let id = fix?.str("id") { dismissed.insert(id) }; fix = nil; fixError = nil }

    static func strings(_ any: Any?) -> [String] {
        if let a = any as? [Any] { return a.compactMap { $0 as? String }.filter { !$0.isEmpty } }
        if let s = any as? String, !s.isEmpty { return [s] }
        return []
    }
}

// MARK: - the card on the Home screen

struct HomeTinkerCard: View {
    @ObservedObject var t: HomeTinkerModel
    @Binding var showFix: Bool
    @State private var text = ""
    @State private var revising = false
    @State private var feedback = ""

    var body: some View {
        ATCard {
            VStack(alignment: .leading, spacing: 12) {
                TLabel("Tinker \u{00B7} Automation Maker")
                if t.maker == nil { composer } else { preview }
                if let e = t.error { TSub(e, color: AT.red) }
            }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Say what should happen").font(.system(size: 13)).foregroundStyle(Color(white: 0.79))
            TextField("When I get out of bed after 7 AM, turn on the kitchen lights", text: $text, axis: .vertical)
                .lineLimit(2...6)
                .font(.system(size: 16)).foregroundStyle(AT.text)
                .padding(12).frame(minHeight: 64, alignment: .topLeading)
                .background(AT.inner, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            HStack(spacing: 8) {
                Button {
                    let req = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    Task { if await t.makerOp("generate", ["request": req]) { text = "" } }
                } label: {
                    HStack(spacing: 6) { if t.busy { ProgressView().tint(AT.bg) }; Text("Make it") }
                }
                .buttonStyle(.tlime)
                .disabled(t.busy || text.trimmingCharacters(in: .whitespacesAndNewlines).count < 5)
                Button { showFix = true } label: { Text(fixBadge) }.buttonStyle(.tbtn)
            }
            TSub("Tinker writes it and shows a preview. Nothing changes in Home Assistant until you tap Install.")
        }
    }

    private var fixBadge: String { t.fixStatus == "proposed" ? "Fix ready to review" : "Fix a problem" }

    @ViewBuilder private var preview: some View {
        let status = t.makerStatus
        let title = t.maker?.str("title") ?? ""
        VStack(alignment: .leading, spacing: 10) {
            if let req = t.maker?.str("request"), !req.isEmpty {
                Text("\u{201C}\(req)\u{201D}").font(.system(size: 13)).foregroundStyle(AT.secondary).fixedSize(horizontal: false, vertical: true)
            }
            switch status {
            case "drafting":
                HStack(spacing: 8) {
                    ProgressView().tint(AT.secondary)
                    Text(((t.maker?.int("wait_tries") ?? 0) > 0) ? "Waiting for a free model. Tinker keeps going on his own." : "Tinker is writing it")
                        .font(.system(size: 15)).foregroundStyle(AT.text).fixedSize(horizontal: false, vertical: true)
                }
            case "installing", "undoing":
                HStack(spacing: 8) {
                    ProgressView().tint(AT.secondary)
                    Text(status == "installing" ? "Installing in Home Assistant" : "Putting the old version back").font(.system(size: 15)).foregroundStyle(AT.text)
                }
            case "installed":
                Text(title.isEmpty ? "Installed" : title).font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.text).fixedSize(horizontal: false, vertical: true)
                TSub("Installed. It is running in Home Assistant now.", color: AT.green)
                HStack(spacing: 8) {
                    Button { Task { await t.makerOp("undo") } } label: { Text("Undo") }.buttonStyle(.tbtn).disabled(t.busy)
                    Button { t.dismissMaker() } label: { Text("Done") }.buttonStyle(.tbtn)
                }
            case "preview":
                previewBody(title)
            case "failed":
                Text(title.isEmpty ? "That didn't work" : title).font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.text)
                TSub(t.maker?.str("error") ?? "Tinker hit a problem.", color: AT.red)
                reviseControls(showInstall: false)
            case "handoff":
                Text("Tinker passed this to Scout's Code Worker").font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.text)
                TSub("It needs more than an automation. You get a notification when it is ready for your tap.")
                Button { t.dismissMaker() } label: { Text("Got it") }.buttonStyle(.tbtn)
            default:
                TSub("Tinker's status: \(TKit.titleCase(status))")
                Button { t.dismissMaker() } label: { Text("Done") }.buttonStyle(.tbtn)
            }
        }
    }

    private func previewBody(_ title: String) -> some View {
        let bullets = HomeTinkerModel.strings(t.maker?["summary"])
        let assumptions = HomeTinkerModel.strings(t.maker?["assumptions"])
        return VStack(alignment: .leading, spacing: 10) {
            Text(title.isEmpty ? "Your new automation" : title).font(.system(size: 17, weight: .semibold)).foregroundStyle(AT.text).fixedSize(horizontal: false, vertical: true)
            ForEach(Array(bullets.enumerated()), id: \.offset) { _, b in bulletRow(b, AT.text) }
            if !assumptions.isEmpty {
                TLabel("Tinker assumed").padding(.top, 2)
                ForEach(Array(assumptions.enumerated()), id: \.offset) { _, a in bulletRow(a, Color(white: 0.79)) }
            }
            if t.maker?.bool("risky") == true {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Worth a second look").font(.system(size: 13, weight: .semibold)).foregroundStyle(AT.orange)
                    Text(t.maker?.str("risk_reason") ?? "Tinker marked this one as risky.").font(.system(size: 14)).foregroundStyle(AT.hex(0xFDBA74)).fixedSize(horizontal: false, vertical: true)
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(AT.hex(0x2A1A10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            reviseControls(showInstall: true)
        }
    }

    private func bulletRow(_ s: String, _ c: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\u{2022}").foregroundStyle(AT.secondary)
            Text(s).font(.system(size: 14)).foregroundStyle(c).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func reviseControls(showInstall: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if showInstall {
                Button { Task { await t.makerOp("install") } } label: {
                    HStack(spacing: 6) { if t.busy { ProgressView().tint(AT.bg) }; Text("Install") }
                }
                .buttonStyle(.tlime).disabled(t.busy)
            }
            if revising {
                TextField("What should change?", text: $feedback, axis: .vertical)
                    .lineLimit(2...5)
                    .font(.system(size: 16)).foregroundStyle(AT.text)
                    .padding(12).background(AT.inner, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                HStack(spacing: 8) {
                    Button { Task { if await t.makerOp("revise", ["feedback": feedback.trimmingCharacters(in: .whitespacesAndNewlines)]) { revising = false; feedback = "" } } } label: { Text("Send to Tinker") }
                        .buttonStyle(.tbtn).disabled(t.busy || feedback.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
                    Button { revising = false; feedback = "" } label: { Text("Never mind") }.buttonStyle(.tbtn)
                }
            } else {
                HStack(spacing: 8) {
                    Button { revising = true } label: { Text("Revise") }.buttonStyle(.tbtn).disabled(t.busy)
                    Button { Task { await t.makerOp("discard") } } label: { Text("Discard") }.buttonStyle(.tdanger).disabled(t.busy)
                }
            }
        }
    }
}

// MARK: - Fix a problem

struct HomeFixSheet: View {
    @ObservedObject var t: HomeTinkerModel
    @Environment(\.dismiss) private var dismiss
    @State private var question = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if t.fix == nil { askForm } else { fixBody }
                    if let e = t.fixError { TSub(e, color: AT.red) }
                }
                .padding(16)
            }
            .background(AT.bg.ignoresSafeArea())
            .navigationTitle("Fix a problem")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.frame(minHeight: 44) } }
        }
        .presentationDetents([.large])
    }

    private var askForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            TSub("Tell Tinker what went wrong. He looks at what Home Assistant did, explains it in plain words, and proposes a fix. Nothing changes until you tap Apply.", color: Color(white: 0.79))
            TextField("The porch light stays on all night", text: $question, axis: .vertical)
                .lineLimit(3...8)
                .font(.system(size: 16)).foregroundStyle(AT.text)
                .padding(12).frame(minHeight: 88, alignment: .topLeading)
                .background(AT.inner, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            Button { Task { await t.fixOp("diagnose", ["question": question.trimmingCharacters(in: .whitespacesAndNewlines)]); question = "" } } label: {
                HStack(spacing: 6) { if t.busy { ProgressView().tint(AT.bg) }; Text("Look into it") }
            }
            .buttonStyle(.tlime)
            .disabled(t.busy || question.trimmingCharacters(in: .whitespacesAndNewlines).count < 6)
        }
    }

    @ViewBuilder private var fixBody: some View {
        let status = t.fixStatus
        if let q = t.fix?.str("question") { Text("\u{201C}\(q)\u{201D}").font(.system(size: 15)).foregroundStyle(AT.secondary).fixedSize(horizontal: false, vertical: true) }
        if t.fix?.bool("needs_agent_update") == true {
            TSub("Hestia needs a software update before Tinker can look. Tinker queues it himself.", color: AT.orange)
        }
        switch status {
        case "gathering", "analyzing":
            ATCard {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        ProgressView().tint(AT.secondary)
                        Text(status == "gathering" ? "Tinker is gathering what happened" : "Tinker is working out why").font(.system(size: 15)).foregroundStyle(AT.text)
                    }
                    if (t.fix?.int("wait_tries") ?? 0) > 0 { TSub("Waiting for a free model. Tinker keeps going on his own.") }
                }
            }
            timeline
        case "proposed", "diagnosed":
            storyCard
            timeline
            if status == "proposed" { proposal }
            else { TSub("Tinker found the likely cause but has no safe change to make. Nothing was touched.") ; doneButtons }
        case "applying", "undoing":
            ATCard { HStack(spacing: 8) { ProgressView().tint(AT.secondary); Text(status == "applying" ? "Applying the fix" : "Putting the original back").font(.system(size: 15)).foregroundStyle(AT.text) } }
        case "applied":
            ATCard { VStack(alignment: .leading, spacing: 8) {
                Text("Fix applied").font(.system(size: 17, weight: .semibold)).foregroundStyle(AT.green)
                if let n = t.fix?.str("restart_note"), !n.isEmpty { TSub(n) }
            } }
            HStack(spacing: 8) {
                Button { Task { await t.fixOp("undo") } } label: { Text("Undo") }.buttonStyle(.tbtn).disabled(t.busy)
                Button { t.dismissFix() } label: { Text("Done") }.buttonStyle(.tbtn)
            }
        case "failed":
            ATCard { VStack(alignment: .leading, spacing: 6) {
                Text("Tinker couldn't finish").font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.red)
                TSub(t.fix?.str("error") ?? "Something went wrong on the way.")
            } }
            doneButtons
        case "handoff":
            TSub("Tinker passed this to Scout's Code Worker. You get a notification when it is ready for your tap.")
            doneButtons
        default:
            TSub("Status: \(TKit.titleCase(status))")
            doneButtons
        }
    }

    private var doneButtons: some View {
        HStack(spacing: 8) {
            Button { t.dismissFix() } label: { Text("Start over") }.buttonStyle(.tbtn)
        }
    }

    private var storyCard: some View {
        let story = HomeTinkerModel.strings(t.fix?["story"])
        let culprit = t.fix?.obj("culprit")
        return ATCard {
            VStack(alignment: .leading, spacing: 8) {
                TLabel("What happened")
                ForEach(Array(story.enumerated()), id: \.offset) { _, s in
                    Text(s).font(.system(size: 15)).foregroundStyle(Color(white: 0.9)).fixedSize(horizontal: false, vertical: true)
                }
                if let c = culprit, let name = c.str("name") {
                    Text("Likely cause: \(name)").font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.text).padding(.top, 4)
                    if let why = c.str("why") { TSub(why) }
                }
                if let conf = t.fix?.str("confidence") { TSub("Tinker is \(conf) confidence in this.") }
            }
        }
    }

    private var proposal: some View {
        let before = HomeTinkerModel.strings(t.fix?["before_plain"])
        let after = HomeTinkerModel.strings(t.fix?["after_plain"])
        return VStack(alignment: .leading, spacing: 12) {
            ATCard {
                VStack(alignment: .leading, spacing: 8) {
                    TLabel("The fix")
                    if !before.isEmpty { Text("Now").font(.system(size: 13, weight: .semibold)).foregroundStyle(AT.orange); ForEach(Array(before.enumerated()), id: \.offset) { _, s in line(s) } }
                    if !after.isEmpty { Text("After").font(.system(size: 13, weight: .semibold)).foregroundStyle(AT.lime).padding(.top, 4); ForEach(Array(after.enumerated()), id: \.offset) { _, s in line(s) } }
                    if t.fix?.bool("risky") == true {
                        Text(t.fix?.str("risk_reason") ?? "Tinker marked this one as risky.").font(.system(size: 14)).foregroundStyle(AT.hex(0xFDBA74)).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            Button { Task { await t.fixOp("apply") } } label: {
                HStack(spacing: 6) { if t.busy { ProgressView().tint(AT.bg) }; Text("Apply fix") }
            }
            .buttonStyle(.tlime).disabled(t.busy)
            Button { Task { await t.fixOp("discard") } } label: { Text("Discard") }.buttonStyle(.tdanger).disabled(t.busy)
        }
    }

    private func line(_ s: String) -> some View {
        Text(s).font(.system(size: 14)).foregroundStyle(Color(white: 0.9)).fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var timeline: some View {
        let items = t.fix?.arr("timeline") ?? []
        if !items.isEmpty {
            ATCard {
                VStack(alignment: .leading, spacing: 8) {
                    TLabel("Timeline")
                    ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            if let ts = it.str("t"), !ts.isEmpty {
                                Text(AdminFmt.date(ts).map { TKit.clock($0) } ?? ts).font(.system(size: 13)).foregroundStyle(AT.secondary).frame(minWidth: 62, alignment: .leading)
                            }
                            Text(it.str("text") ?? "").font(.system(size: 14)).foregroundStyle(Color(white: 0.9)).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }
}
