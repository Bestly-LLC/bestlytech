// Bestly Admin: callbox sheets: "Expect someone" (tell Ava who is coming) and the door history.
import SwiftUI

struct HomeExpectSheet: View {
    @ObservedObject var m: HomeModel
    @Environment(\.dismiss) private var dismiss
    @State private var label = ""
    @State private var kindIdx = 0
    @State private var keywords = ""
    @State private var lengthIdx = 1
    @State private var busy = false
    @State private var error: String?

    private struct Quick { var label: String; var kind: String; var keywords: [String] }
    private let quick = [
        Quick(label: "DoorDash", kind: "delivery", keywords: ["doordash", "door dash"]),
        Quick(label: "Uber Eats", kind: "delivery", keywords: ["uber eats", "ubereats"]),
        Quick(label: "Amazon", kind: "delivery", keywords: ["amazon"]),
        Quick(label: "Instacart", kind: "delivery", keywords: ["instacart"]),
        Quick(label: "A friend", kind: "guest", keywords: []),
    ]
    private let kinds = ["delivery", "guest", "other"]
    private let lengths: [(String, Int?)] = [("30 min", 30), ("1 hr", 60), ("2 hr", 120), ("4 hr", 240), ("Today", nil)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    TSub("Ava opens the door for someone you expect and asks you about everyone else. Pick how long to expect them.", color: Color(white: 0.79))
                    ATCard(fill: AT.inner) {
                        VStack(alignment: .leading, spacing: 8) {
                            TLabel("How long")
                            TSegments(options: lengths.map { $0.0 }, selection: $lengthIdx)
                        }
                    }
                    TLabel("Quick add")
                    TFlow(spacing: 8) {
                        ForEach(quick, id: \.label) { q in
                            Button { Task { await add(q.label, q.kind, q.keywords) } } label: {
                                Text(q.label).font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.text)
                                    .padding(.horizontal, 16).frame(minHeight: 44)
                                    .background(AT.inner, in: Capsule())
                            }.disabled(busy)
                        }
                    }
                    ATCard(fill: AT.inner) {
                        VStack(alignment: .leading, spacing: 8) {
                            TLabel("Someone else")
                            TextField("Name or what they are bringing", text: $label)
                                .font(.system(size: 16)).foregroundStyle(AT.text)
                                .padding(.horizontal, 12).frame(minHeight: 48)
                                .background(AT.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            TSegments(options: ["Delivery", "Guest", "Other"], selection: $kindIdx)
                            TextField("Words they might say, like sam, pizza", text: $keywords)
                                .textInputAutocapitalization(.never)
                                .font(.system(size: 16)).foregroundStyle(AT.text)
                                .padding(.horizontal, 12).frame(minHeight: 48)
                                .background(AT.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            Button { Task { await addCustom() } } label: { Text("Expect them") }
                                .buttonStyle(.tlime)
                                .disabled(busy || label.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                    if let error { TSub(error, color: AT.red) }
                }
                .padding(16)
            }
            .background(AT.bg.ignoresSafeArea())
            .navigationTitle("Expect someone")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.frame(minHeight: 44) } }
        }
        .presentationDetents([.large])
    }

    private func addCustom() async {
        let kw = keywords.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
        await add(label.trimmingCharacters(in: .whitespaces), kinds[kindIdx], kw)
    }

    private func add(_ name: String, _ kind: String, _ kw: [String]) async {
        busy = true; error = nil
        let e = await m.addExpected(label: name, kind: kind, keywords: kw, minutes: lengths[lengthIdx].1)
        busy = false
        if let e { error = e } else { dismiss() }
    }
}

struct HomeDoorHistorySheet: View {
    @ObservedObject var m: HomeModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    if m.events.isEmpty {
                        TSub("No door events yet. When someone buzzes the callbox, it shows up here.").padding(16)
                    }
                    ForEach(Array(m.events.enumerated()), id: \.offset) { i, e in
                        if i > 0 { Rectangle().fill(Color.white.opacity(0.05)).frame(height: 1) }
                        row(e)
                    }
                }
                .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
                .padding(16)
            }
            .background(AT.bg.ignoresSafeArea())
            .navigationTitle("Door history")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.frame(minHeight: 44) } }
        }
        .presentationDetents([.large])
    }

    private func row(_ e: JSON) -> some View {
        let words = HomeModel.doorWords(e)
        let at = AdminFmt.date(e.str("created_at")).map { TKit.when($0) } ?? ""
        let said = (e.str("visitor_said") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let tone: Color = words.hasPrefix("Opened") || words == "You opened it" ? AT.green : (words == "You said no" ? AT.secondary : AT.orange)
        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(words).font(.system(size: 15, weight: .semibold)).foregroundStyle(tone)
                Spacer(minLength: 8)
                Text(at).font(.system(size: 13)).foregroundStyle(AT.secondary)
            }
            if !said.isEmpty { Text("\u{201C}\(said)\u{201D}").font(.system(size: 14)).foregroundStyle(Color(white: 0.83)).fixedSize(horizontal: false, vertical: true) }
            if e.bool("known_callbox") == false { TSub("Not a callbox you have saved") }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
