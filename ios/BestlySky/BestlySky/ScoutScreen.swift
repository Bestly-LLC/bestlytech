// Bestly Admin: Scout chat (matches the approved Scout screen). Plain text replies, option chips, progress row, Stop.
import SwiftUI
import UIKit

private enum ScoutItem: Identifiable {
    case stamp(String, String)
    case msg(ScoutMsg)
    case stopped(ScoutMsg)
    var id: String {
        switch self {
        case .stamp(let k, _): return "s-" + k
        case .msg(let m): return m.id
        case .stopped(let m): return m.id
        }
    }
}

enum ScoutColors {
    static let purple = AT.hex(0xBF5AF2)
    static let needs = AT.hex(0xFF9F0A)
    static let userBubble = AT.hex(0x2A2A34)
}

struct ScoutScreen: View {
    @StateObject private var model = ScoutModel()
    @Environment(\.scenePhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showThreads = false
    @State private var showSettings = false
    @FocusState private var focused: Bool

    var body: some View {
        ZStack(alignment: .top) {
            AT.bg.ignoresSafeArea()
            transcript
            header
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .sheet(isPresented: $showThreads) {
            ScoutThreadsSheet(model: model, isPresented: $showThreads)
                .presentationDetents([.medium, .large]).preferredColorScheme(.dark)
        }
        .sheet(isPresented: $showSettings) {
            ScoutSettingsSheet(model: model, isPresented: $showSettings)
                .presentationDetents([.medium, .large]).preferredColorScheme(.dark)
        }
        .onAppear { model.visible = true }
        .onDisappear { model.visible = false }
        .onChange(of: phase) { _, p in model.visible = (p == .active) }
        .onChange(of: model.input) { _, v in
            if v.count > ScoutModel.maxChars { model.input = String(v.prefix(ScoutModel.maxChars)) }
        }
        .task {
            await model.boot()
            var n = 0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                n += 1
                await model.pollTick(n)
            }
        }
        .screenView("scout")
    }

    // MARK: header

    private var header: some View {
        HStack(spacing: 10) {
            ScoutMark(size: 36)
            Button { showThreads = true } label: {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Scout").font(.system(size: 17, weight: .bold)).foregroundStyle(AT.text)
                    HStack(spacing: 6) {
                        Text(model.currentTitle).font(.system(size: 13)).foregroundStyle(AT.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)).foregroundStyle(AT.secondary)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Scout, \(model.currentTitle). Opens your chats.")
            Button { showThreads = true } label: {
                Image(systemName: "list.bullet").font(.system(size: 18, weight: .semibold)).foregroundStyle(AT.text)
                    .frame(width: 44, height: 44)
                    .overlay(alignment: .topTrailing) {
                        if model.anyNeedsYou || model.anyUnread {
                            Circle().fill(model.anyNeedsYou ? ScoutColors.needs : ScoutColors.purple)
                                .frame(width: 10, height: 10).padding(8)
                        }
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.anyNeedsYou ? "Chats, some need you" : (model.anyUnread ? "Chats, unread replies" : "Chats"))
            Button { showSettings = true } label: {
                Image(systemName: "ellipsis").font(.system(size: 18, weight: .bold)).foregroundStyle(AT.text)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Scout settings: paid AI and auto-run")
        }
        .padding(.leading, 16).padding(.trailing, 8).padding(.vertical, 6)
        .background(
            LinearGradient(colors: [AT.bg.opacity(0.96), AT.bg.opacity(0.9), AT.bg.opacity(0)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea(edges: .top)
        )
    }

    // MARK: transcript

    private var items: [ScoutItem] {
        var out: [ScoutItem] = []
        var prev: Date?
        for m in model.messages {
            if m.isStopped {
                out.append(.stopped(m)); prev = m.created; continue
            }
            if m.role == "assistant", m.isProgress, m.segments.isEmpty { prev = m.created; continue }
            if prev == nil || m.created.timeIntervalSince(prev!) > 600 {
                out.append(.stamp(m.id, AdminFmt.whenShort(m.created)))
            }
            out.append(.msg(m))
            prev = m.created
        }
        return out
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    if model.messages.isEmpty && model.pendingUser == nil {
                        welcome
                    }
                    ForEach(items) { item in
                        row(item)
                    }
                    if let p = model.pendingUser, !model.messages.contains(where: { $0.isUser && $0.body == p && $0.created > Date().addingTimeInterval(-300) }) {
                        userBubble(p)
                    }
                    if model.running { ScoutProgressRow(text: model.progressText) }
                    if let n = model.notice { noticeCard(n) }
                    if !model.lastOptions.isEmpty { optionChips(model.lastOptions) }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 16)
                .padding(.top, 64)
                .padding(.bottom, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: model.messages.count) { _, _ in scroll(proxy) }
            .onChange(of: model.running) { _, _ in scroll(proxy) }
            .onChange(of: model.pendingUser) { _, _ in scroll(proxy) }
            .onChange(of: model.notice) { _, _ in scroll(proxy) }
            .onChange(of: focused) { _, f in if f { scroll(proxy) } }
            .onAppear { scroll(proxy, animated: false) }
        }
    }

    private func scroll(_ proxy: ScrollViewProxy, animated: Bool = true) {
        DispatchQueue.main.async {
            if animated && !reduceMotion {
                withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("bottom", anchor: .bottom) }
            } else {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }

    @ViewBuilder private func row(_ item: ScoutItem) -> some View {
        switch item {
        case .stamp(_, let t):
            Text(glue(t)).font(.system(size: 13)).foregroundStyle(AT.secondary)
                .frame(maxWidth: .infinity, alignment: .center)
        case .stopped(let m):
            HStack(spacing: 10) {
                Rectangle().fill(Color.white.opacity(0.1)).frame(height: 1)
                Text(glue("You stopped Scout at " + AdminFmt.time.string(from: m.created)))
                    .font(.system(size: 13)).foregroundStyle(AT.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Rectangle().fill(Color.white.opacity(0.1)).frame(height: 1)
            }
            .accessibilityElement(children: .combine)
        case .msg(let m):
            if m.isUser { userBubble(m.plainText) } else { assistant(m) }
        }
    }

    private func userBubble(_ text: String) -> some View {
        HStack(spacing: 0) {
            Spacer(minLength: 48)
            Text(text)
                .font(.system(size: 16)).foregroundStyle(AT.text)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(ScoutColors.userBubble,
                            in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 5, topTrailingRadius: 18, style: .continuous))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("You: \(text)")
    }

    private func assistant(_ m: ScoutMsg) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(m.segments.enumerated()), id: \.offset) { _, seg in
                switch seg {
                case .text(let t):
                    Text(t).font(.system(size: 16)).foregroundStyle(AT.text.opacity(0.92))
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                case .code(let c):
                    ScoutCodeBox(code: c)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Scout: \(m.plainText)")
    }

    private func optionChips(_ opts: [String]) -> some View {
        NYFlow(spacing: 8) {
            ForEach(opts, id: \.self) { o in
                Button { model.send(o) } label: {
                    Text(o).font(.system(size: 14, weight: .semibold)).foregroundStyle(AT.lavender)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 14).frame(minHeight: 44)
                        .background(AT.lavender.opacity(0.14), in: Capsule())
                }
                .buttonStyle(NYPressStyle())
                .accessibilityLabel("Send: \(o)")
            }
        }
    }

    private func noticeCard(_ text: String) -> some View {
        Text(text).font(.system(size: 15)).foregroundStyle(AT.text)
            .fixedSize(horizontal: false, vertical: true)
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(AT.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .accessibilityLabel("Scout notice: \(text)")
    }

    private var welcome: some View {
        VStack(alignment: .leading, spacing: 14) {
            ScoutMark(size: 56)
            Text("Ask Scout anything").font(.system(size: 22, weight: .bold)).foregroundStyle(AT.text)
            Text("Scout reads your data, finds what is wrong, and fixes it. Try one of these.")
                .font(.system(size: 15)).foregroundStyle(AT.secondary).fixedSize(horizontal: false, vertical: true)
            optionChips(["What needs me most right now?", "Check the Mac mini is healthy", "What changed overnight?"])
        }
        .padding(.top, 24)
    }

    // MARK: composer

    private var composer: some View {
        VStack(spacing: 4) {
            if model.input.count > 5500 {
                Text(glue("\(model.input.count) of 6,000 characters")).font(.system(size: 13)).foregroundStyle(AT.secondary)
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Message Scout", text: $model.input, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($focused)
                    .font(.system(size: 16)).foregroundStyle(AT.text)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .frame(minHeight: 46)
                    .background(AT.inner, in: RoundedRectangle(cornerRadius: 23, style: .continuous))
                    .submitLabel(.send)
                    .accessibilityLabel("Message Scout")
                if model.running {
                    Button { model.stop() } label: {
                        RoundedRectangle(cornerRadius: 3).fill(AT.bg).frame(width: 14, height: 14)
                            .frame(width: 46, height: 46).background(AT.text, in: Circle())
                    }
                    .buttonStyle(NYPressStyle())
                    .accessibilityLabel("Stop Scout")
                } else {
                    let empty = model.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    Button { model.send(model.input) } label: {
                        Image(systemName: "arrow.up").font(.system(size: 18, weight: .bold)).foregroundStyle(AT.bg)
                            .frame(width: 46, height: 46).background(AT.lavender.opacity(empty ? 0.35 : 1), in: Circle())
                    }
                    .buttonStyle(NYPressStyle())
                    .disabled(empty)
                    .accessibilityLabel("Send")
                }
            }
        }
        .padding(.horizontal, 12).padding(.top, 14).padding(.bottom, 8)
        .background(
            LinearGradient(colors: [AT.bg.opacity(0), AT.bg.opacity(0.92)], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.3))
        )
    }
}

// MARK: - pieces

struct ScoutProgressRow: View {
    let text: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 10) {
            TimelineView(.animation(minimumInterval: 0.3, paused: reduceMotion)) { ctx in
                let phase = Int(ctx.date.timeIntervalSinceReferenceDate / 0.3) % 3
                HStack(spacing: 5) {
                    ForEach(0..<3, id: \.self) { i in
                        Circle().fill(AT.lavender).frame(width: 7, height: 7)
                            .opacity(reduceMotion ? 0.7 : (i == phase ? 1 : 0.3))
                            .animation(.easeInOut(duration: 0.25), value: phase)
                    }
                }
            }
            .accessibilityHidden(true)
            Text(text).font(.system(size: 15)).foregroundStyle(Color(white: 0.89))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AT.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text)
    }
}

struct ScoutCodeBox: View {
    let code: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Spacer()
                Button {
                    UIPasteboard.general.string = code
                    Haptics.ok()
                    copied = true
                    Task { try? await Task.sleep(nanoseconds: 1_600_000_000); copied = false }
                } label: {
                    Text(copied ? "Copied" : "Copy").font(.system(size: 14, weight: .semibold)).foregroundStyle(AT.lavender)
                        .padding(.horizontal, 12).frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("Copy code")
            }
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code).font(.system(size: 13, design: .monospaced)).foregroundStyle(AT.text)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14).padding(.bottom, 14)
            }
        }
        .background(AT.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
