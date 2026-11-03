// Bestly Admin: Wall sheets. Station finder (Radio Browser), signatures, packages, demo text.
import SwiftUI

struct WallSheetHost: View {
    @ObservedObject var model: WallModel
    let sheet: WallSheet
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                switch sheet {
                case .radio: WallRadioSheet(model: model, close: { dismiss() })
                case .signs: WallSignsSheet()
                case .packages: WallPackagesSheet()
                case .demo: WallDemoSheet(model: model, close: { dismiss() })
                }
            }
            .background(AT.bg.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
        }
        .screenView("wall_sheet_\(sheet.rawValue)")
    }

    private var title: String {
        switch sheet {
        case .radio: return "Find a station"
        case .signs: return "Signatures"
        case .packages: return "Packages"
        case .demo: return "Demo text"
        }
    }
}

// MARK: radio

struct WallStation: Identifiable {
    var id: String
    var name: String
    var url: String
    var favicon: String
    var detail: String
}

enum RadioBrowser {
    static let mirrors = ["de1", "de2", "fi1"]

    static func fetch(_ path: String) async throws -> [JSON] {
        var last: Error = URLError(.cannotConnectToHost)
        for m in mirrors {
            guard let url = URL(string: "https://\(m).api.radio-browser.info\(path)") else { continue }
            var req = URLRequest(url: url)
            req.timeoutInterval = 12
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            do {
                let (data, resp) = try await URLSession.shared.data(for: req)
                if let h = resp as? HTTPURLResponse, h.statusCode == 200,
                   let arr = try JSONSerialization.jsonObject(with: data) as? [Any] {
                    return arr.compactMap { $0 as? JSON }
                }
                last = URLError(.badServerResponse)
            } catch {
                if (error as? URLError)?.code == .cancelled || error is CancellationError { throw error }
                last = error
            }
        }
        throw last
    }

    static func clean(_ list: [JSON]) -> [WallStation] {
        var seen = Set<String>()
        var out: [WallStation] = []
        for r in list {
            let url = (r.str("url_resolved") ?? r.str("url") ?? "").trimmingCharacters(in: .whitespaces)
            let name = (r.str("name") ?? "").split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            let codec = (r.str("codec") ?? "").trimmingCharacters(in: .whitespaces).uppercased()
            guard !url.isEmpty, !name.isEmpty else { continue }
            guard ["MP3", "OGG", "FLAC", "AAC", "AAC+", "OPUS"].contains(codec) else { continue }
            let key = name.lowercased() + "|" + url
            if seen.contains(key) || seen.contains(url) { continue }
            seen.insert(key)
            seen.insert(url)
            let parts = name.components(separatedBy: " - ")
            let title = parts.first ?? name
            let rest = parts.dropFirst().joined(separator: " \u{00B7} ")
            let place = [r.str("state") ?? "", (r.str("countrycode") == "US" ? "" : (r.str("country") ?? ""))].filter { !$0.isEmpty }.joined(separator: ", ")
            let bitrate = r.int("bitrate") ?? 0
            let detail = [rest.isEmpty ? place : rest, bitrate > 0 ? "\(bitrate)\u{00A0}kbps" : codec].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
            out.append(WallStation(id: r.str("stationuuid") ?? url, name: title, url: url, favicon: (r.str("favicon") ?? "").trimmingCharacters(in: .whitespaces), detail: detail))
        }
        return out
    }
}

struct WallRadioSheet: View {
    @ObservedObject var model: WallModel
    let close: () -> Void
    @State private var query = ""
    @State private var stations: [WallStation] = []
    @State private var loading = true
    @State private var error: String?

    private var playingURL: String? {
        guard let r = model.obj("radio"), r.bool("on") == true else { return nil }
        return r.str("url")
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(AT.secondary)
                TextField("Search stations by name", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .foregroundStyle(AT.text)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(AT.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(16)

            if let e = error {
                Text(e).font(.system(size: 15)).foregroundStyle(AT.orange).padding(.horizontal, 16).fixedSize(horizontal: false, vertical: true)
            }
            ScrollView {
                LazyVStack(spacing: 0) {
                    if loading && stations.isEmpty {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 120)
                    } else if stations.isEmpty && error == nil {
                        Text(query.isEmpty ? "No stations near home right now." : "No stations match that name.")
                            .font(.system(size: 15)).foregroundStyle(AT.secondary)
                            .frame(maxWidth: .infinity, minHeight: 120)
                    }
                    ForEach(stations) { st in row(st) }
                }
                .padding(.horizontal, 16)
            }
        }
        .task(id: query) {
            if !query.isEmpty { try? await Task.sleep(nanoseconds: 450_000_000) }
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    private func row(_ st: WallStation) -> some View {
        let playing = playingURL == st.url
        return Button {
            Haptics.select()
            model.playStation(name: st.name, url: st.url, favicon: st.favicon)
            close()
        } label: {
            HStack(spacing: 12) {
                logo(st.favicon)
                VStack(alignment: .leading, spacing: 2) {
                    Text(st.name)
                        .font(.system(size: 16, weight: playing ? .semibold : .regular))
                        .foregroundStyle(playing ? AT.lime : AT.text)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if !st.detail.isEmpty {
                        Text(st.detail).font(.system(size: 13)).foregroundStyle(AT.secondary)
                            .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                Text(playing ? "Playing" : "Play")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(playing ? AT.lime : AT.secondary)
                    .fixedSize()
            }
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(playing ? "\(st.name), playing now" : "Play \(st.name)")
        .overlay(alignment: .bottom) { Rectangle().fill(Color.white.opacity(0.07)).frame(height: 1) }
    }

    @ViewBuilder
    private func logo(_ s: String) -> some View {
        let box = RoundedRectangle(cornerRadius: 8, style: .continuous)
        ZStack {
            box.fill(AT.inner)
            if s.hasPrefix("https://"), let u = URL(string: s) {
                AsyncImage(url: u) { phase in
                    if let img = phase.image { img.resizable().scaledToFill() } else { Image(systemName: "dot.radiowaves.left.and.right").foregroundStyle(AT.secondary) }
                }
            } else {
                Image(systemName: "dot.radiowaves.left.and.right").foregroundStyle(AT.secondary)
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(box)
        .accessibilityHidden(true)
    }

    private func load() async {
        loading = true
        let term = query.trimmingCharacters(in: .whitespaces)
        let path: String
        if term.isEmpty {
            path = "/json/stations/search?geo_lat=34.086&geo_long=-118.37&geo_distance=40000&order=votes&reverse=true&limit=24&hidebroken=true"
        } else {
            let enc = term.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? term
            path = "/json/stations/search?name=\(enc)&limit=20&hidebroken=true&order=votes&reverse=true"
        }
        do {
            let raw = try await RadioBrowser.fetch(path)
            guard !Task.isCancelled else { return }
            let cleaned = RadioBrowser.clean(raw)
            stations = term.isEmpty ? Array(cleaned.prefix(12)) : cleaned
            error = nil
        } catch {
            if (error as? URLError)?.code == .cancelled || error is CancellationError { return }
            self.error = "Couldn't reach the radio directory. Check the connection and try again."
        }
        loading = false
    }
}

// MARK: signatures

struct WallSig: Identifiable {
    var id: Int
    var name: String
    var color: String
    var hidden: Bool
    var test: Bool
    var at: String
    var emoji: String
}

struct WallSignsSheet: View {
    @State private var sigs: [WallSig] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var confirmDelete: Int?

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if let e = error {
                    Text(e).font(.system(size: 15)).foregroundStyle(AT.orange).padding(16).fixedSize(horizontal: false, vertical: true)
                }
                if !loaded {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 120)
                } else if sigs.isEmpty {
                    Text("No signatures yet.").font(.system(size: 15)).foregroundStyle(AT.secondary).frame(maxWidth: .infinity, minHeight: 120)
                }
                ForEach(sigs) { s in row(s) }
            }
            .padding(.horizontal, 16)
        }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 10_000_000_000)
            }
        }
    }

    private func row(_ s: WallSig) -> some View {
        HStack(spacing: 10) {
            Text(s.emoji.isEmpty ? "\u{270D}\u{FE0F}" : s.emoji).font(.system(size: 22)).frame(width: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(s.name.isEmpty ? "Guest" : s.name)
                    .font(.system(size: 16))
                    .foregroundStyle(s.hidden ? AT.secondary : AT.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text(sub(s)).font(.system(size: 13)).foregroundStyle(AT.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button {
                Haptics.select()
                Task { await act(s.hidden ? "show" : "hide", s.id) }
            } label: {
                Image(systemName: s.hidden ? "eye" : "eye.slash").font(.system(size: 17)).frame(width: 44, height: 44)
            }
            .buttonStyle(RemoteKey())
            .accessibilityLabel(s.hidden ? "Show \(s.name) on the wall" : "Hide \(s.name) from the wall")
            Button {
                if confirmDelete == s.id {
                    Task { await act("delete", s.id) }
                    confirmDelete = nil
                } else {
                    Haptics.nope()
                    confirmDelete = s.id
                    let mine = s.id
                    Task {
                        try? await Task.sleep(nanoseconds: 4_000_000_000)
                        if confirmDelete == mine { confirmDelete = nil }
                    }
                }
            } label: {
                if confirmDelete == s.id {
                    Text("Delete").font(.system(size: 13, weight: .bold)).fixedSize().padding(.horizontal, 10).frame(minWidth: 44, minHeight: 44)
                } else {
                    Image(systemName: "trash").font(.system(size: 17)).frame(width: 44, height: 44)
                }
            }
            .buttonStyle(RemoteKey(face: confirmDelete == s.id ? .red : .normal))
            .accessibilityLabel(confirmDelete == s.id ? "Tap again to delete for good" : "Delete \(s.name)")
        }
        .padding(.vertical, 8)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.white.opacity(0.07)).frame(height: 1) }
    }

    private func sub(_ s: WallSig) -> String {
        var bits: [String] = []
        if let d = WallClock.pgDate(s.at) { bits.append(AdminFmt.whenShort(d)) }
        if s.hidden { bits.append("Hidden") }
        if s.test { bits.append("Test") }
        return bits.joined(separator: " \u{00B7} ")
    }

    private func load() async {
        do {
            let r = try await AdminAPI.rpc("wall_admin_signs")
            let arr = (r as? [Any])?.compactMap { $0 as? JSON } ?? []
            sigs = arr.map {
                WallSig(id: $0.int("id") ?? 0, name: $0.str("name") ?? "", color: $0.str("color") ?? "",
                        hidden: $0.bool("hidden") ?? false, test: $0.bool("test") ?? false, at: $0.str("at") ?? "", emoji: $0.str("emoji") ?? "")
            }
            loaded = true
            error = nil
        } catch {
            self.error = "Couldn't load signatures. Retrying."
        }
    }

    private func act(_ action: String, _ id: Int) async {
        let ok = await Action.run("wall.sign_\(action)", attempt: {
            try await AdminAPI.rpc("wall_admin_sign_action", ["p_action": action, "p_id": id])
        }, verify: {
            guard let r = try? await AdminAPI.rpc("wall_admin_signs"), let arr = r as? [Any] else { return false }
            let row = arr.compactMap { $0 as? JSON }.first { $0.int("id") == id }
            switch action {
            case "delete": return row == nil
            case "hide": return row?.bool("hidden") == true
            case "show": return row?.bool("hidden") == false
            default: return true
            }
        })
        if ok {
            if action == "delete" { sigs.removeAll { $0.id == id } }
            error = nil
            await load()
        } else {
            self.error = "The wall didn't take that. Nothing changed."
        }
    }
}

// MARK: packages

struct WallPackage: Identifiable {
    var id: Int
    var title: String
    var detail: String
    var done: Bool
}

struct WallPackagesSheet: View {
    @State private var list: [WallPackage] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var showDone = false

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if let e = error {
                    Text(e).font(.system(size: 15)).foregroundStyle(AT.orange).padding(16).fixedSize(horizontal: false, vertical: true)
                }
                if !loaded {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 120)
                } else if list.filter({ !$0.done }).isEmpty {
                    Text("Nothing on the way.").font(.system(size: 15)).foregroundStyle(AT.secondary).frame(maxWidth: .infinity, minHeight: 120)
                }
                ForEach(list.filter { !$0.done }) { p in row(p) }
                let done = list.filter { $0.done }
                if !done.isEmpty {
                    Button { showDone.toggle() } label: {
                        HStack {
                            Text("Got it (\(done.count))").font(.system(size: 15)).foregroundStyle(AT.sky)
                            Spacer()
                            Image(systemName: showDone ? "chevron.up" : "chevron.down").foregroundStyle(AT.secondary)
                        }
                        .frame(minHeight: 48)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if showDone { ForEach(done) { p in row(p) } }
                }
                Text("Tap Got it when it arrives and it leaves the wall. The list comes from delivery emails and USPS Informed Delivery.")
                    .font(.system(size: 13)).foregroundStyle(AT.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 16)
            }
            .padding(.horizontal, 16)
        }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 60_000_000_000)
            }
        }
    }

    private func row(_ p: WallPackage) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "shippingbox").foregroundStyle(AT.secondary).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.title).font(.system(size: 16)).foregroundStyle(p.done ? AT.secondary : AT.text).fixedSize(horizontal: false, vertical: true)
                if !p.detail.isEmpty {
                    Text(p.detail).font(.system(size: 13)).foregroundStyle(AT.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            Button {
                Task { await mark(p, done: !p.done) }
            } label: {
                Text(p.done ? "Undo" : "Got it").font(.system(size: 15, weight: .semibold)).fixedSize().padding(.horizontal, 12).frame(minWidth: 64, minHeight: 44)
            }
            .buttonStyle(RemoteKey())
            .accessibilityLabel(p.done ? "Bring \(p.title) back to the wall" : "Got it: \(p.title). Hides it from the wall.")
        }
        .padding(.vertical, 6)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.white.opacity(0.07)).frame(height: 1) }
    }

    private func etaText(_ eta: String) -> String {
        if eta.isEmpty { return "" }
        var date = AdminFmt.date(eta)
        if date == nil {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = AdminFmt.la
            f.dateFormat = "yyyy-MM-dd"
            date = f.date(from: String(eta.prefix(10)))
        }
        guard let d = date else { return eta }
        return AdminFmt.whenShort(d).replacingOccurrences(of: " 12:00\u{00A0}AM", with: "").replacingOccurrences(of: " 12:00 AM", with: "")
    }

    private func load() async {
        do {
            let r = try await AdminAPI.rpc("wall_admin_packages")
            let arr = (r as? [Any])?.compactMap { $0 as? JSON } ?? []
            list = arr.map { p in
                let carrier = p.str("carrier") ?? ""
                let what = p.str("what") ?? ""
                let title = !what.isEmpty ? what : (!carrier.isEmpty ? carrier : "Package")
                var bits: [String] = []
                if !carrier.isEmpty && !what.isEmpty && !what.lowercased().contains(carrier.lowercased()) { bits.append(carrier) }
                if let s = p.str("status"), !s.isEmpty { bits.append(s) }
                let eta = etaText(p.str("eta") ?? "")
                if !eta.isEmpty { bits.append(eta) }
                return WallPackage(id: p.int("id") ?? 0, title: title, detail: bits.joined(separator: " \u{00B7} "), done: p.bool("done") ?? false)
            }
            loaded = true
            error = nil
        } catch {
            self.error = "Couldn't load packages. Retrying."
        }
    }

    private func mark(_ p: WallPackage, done: Bool) async {
        if let i = list.firstIndex(where: { $0.id == p.id }) { list[i].done = done }
        let ok = await Action.run(done ? "wall.package_done" : "wall.package_undo", attempt: {
            try await AdminAPI.rpc("wall_package_done", ["p_id": p.id, "p_done": done])
        }, verify: {
            guard let r = try? await AdminAPI.rpc("wall_admin_packages"), let arr = r as? [Any] else { return false }
            let row = arr.compactMap { $0 as? JSON }.first { $0.int("id") == p.id }
            return row?.bool("done") == done
        })
        if ok {
            error = nil
            await load()
        } else {
            if let i = list.firstIndex(where: { $0.id == p.id }) { list[i].done = !done }
            self.error = "The wall didn't take that. Nothing changed."
        }
    }
}

// MARK: demo text

struct WallDemoSheet: View {
    @ObservedObject var model: WallModel
    let close: () -> Void
    @State private var left = ""
    @State private var middle = ""
    @State private var right = ""
    @State private var saving = false
    @State private var saveError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Shown on the wall in Demo mode (key 4). Up to 60 characters each.")
                    .font(.system(size: 13)).foregroundStyle(AT.secondary).fixedSize(horizontal: false, vertical: true)
                field("Left", lines: 2, text: $left)
                field("Middle", lines: 1, text: $middle)
                field("Right", lines: 2, text: $right)
                if let e = saveError {
                    Text(e).font(.system(size: 13)).foregroundStyle(AT.orange).fixedSize(horizontal: false, vertical: true)
                }
                Button {
                    guard !saving else { return }
                    saving = true
                    saveError = nil
                    Task {
                        let ok = await model.savePatch(["demoLeft": clean(left, 2), "demoNames": clean(middle, 1), "demoRight": clean(right, 2)],
                                                       say: "DEMO TEXT|Saved. Press 4 to see it.", id: "wall.demo_text")
                        saving = false
                        if ok { close() } else { saveError = "The wall didn't take that text. Try again." }
                    }
                } label: {
                    Text(saving ? "Saving" : "Save").font(.system(size: 16, weight: .bold)).frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(RemoteKey(face: .selected))
                .accessibilityLabel("Save demo text")
            }
            .padding(16)
        }
        .onAppear {
            left = model.text("demoLeft") ?? "Oct 18\n2026"
            middle = model.text("demoNames") ?? "Maya & Jordan"
            right = model.text("demoRight") ?? "Welcome\nfriends"
        }
    }

    private func clean(_ s: String, _ maxLines: Int) -> String {
        let lines = s.components(separatedBy: "\n").prefix(maxLines).joined(separator: "\n")
        return String(lines.prefix(60))
    }

    private func field(_ label: String, lines: Int, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            WEng(text: "\(label) \u{00B7} \(lines) \(lines == 1 ? "line" : "lines")").multilineTextAlignment(.leading)
            TextField(label, text: text, axis: .vertical)
                .lineLimit(lines...lines)
                .foregroundStyle(AT.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(minHeight: 48, alignment: .topLeading)
                .background(AT.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .onChange(of: text.wrappedValue) { _, v in
                    let c = clean(v, lines)
                    if c != v { text.wrappedValue = c }
                }
        }
    }
}
