// Bestly Admin: Needs you (matches the approved NeedsYou screen). Swipe right = Done, swipe left = Later.
import SwiftUI

/// Wraps children onto new lines instead of cutting them off.
struct NYFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? 10_000
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, w: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(ProposedViewSize(width: maxW, height: nil))
            if x > 0 && x + sz.width > maxW { y += rowH + spacing; x = 0; rowH = 0 }
            x += sz.width + spacing
            rowH = max(rowH, sz.height)
            w = max(w, x - spacing)
        }
        return CGSize(width: w, height: y + rowH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX && x + sz.width > bounds.maxX { y += rowH + spacing; x = bounds.minX; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: sz.width, height: sz.height))
            x += sz.width + spacing
            rowH = max(rowH, sz.height)
        }
    }
}

struct NYPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduce
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduce ? 0.97 : 1)
            .opacity(configuration.isPressed && reduce ? 0.7 : 1)
            .animation(reduce ? nil : .easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

private enum NeedsFilter: Hashable { case all, critical, urgent, waiting }

struct NeedsYouScreen: View {
    @ObservedObject private var model = NeedsYouModel.shared
    @Environment(\.scenePhase) private var phase
    @State private var filter: NeedsFilter = .all

    private var visibleRows: [NeedsRow] {
        switch filter {
        case .all: return model.rows
        case .critical: return model.rows.filter { $0.tag == .critical }
        case .urgent: return model.rows.filter { $0.tag == .urgent }
        case .waiting: return model.rows.filter { $0.tag == .waiting }
        }
    }
    private func count(_ t: NeedsTag) -> Int { model.rows.filter { $0.tag == t }.count }
    private var waitingTotal: Int { model.rows.filter { $0.tag != .fyi }.count }

    var body: some View {
        ZStack {
            AT.bg.ignoresSafeArea()
            List {
                header.listRowStyle(top: 8, bottom: 6)
                chips.listRowStyle(top: 6, bottom: 6)
                if !model.rows.isEmpty {
                    hint.listRowStyle(top: 2, bottom: 6)
                }
                ForEach(visibleRows) { row in
                    NeedsCard(row: row)
                        .listRowStyle(top: 7, bottom: 7)
                        .swipeActions(edge: .leading, allowsFullSwipe: true) {
                            Button { Task { await model.perform(row, .done) } } label: { Label("Done", systemImage: "checkmark") }
                                .tint(AT.green)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            if !row.isHermesApproval {
                                Button { Task { await model.perform(row, .later) } } label: { Label("Later", systemImage: "clock") }
                                    .tint(AT.orange)
                            }
                        }
                }
                if visibleRows.isEmpty { emptyState.listRowStyle(top: 40, bottom: 20) }
                Color.clear.frame(height: 40).listRowStyle(top: 0, bottom: 0)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .refreshable { await model.load() }
        }
        .overlay(alignment: .bottom) { toastView }
        .animation(.easeOut(duration: 0.2), value: model.toast)
        .task {
            await model.load()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                if phase == .active { await model.load() }
            }
        }
        .onChange(of: phase) { _, p in if p == .active { Task { await model.load() } } }
        .screenView("needs_you")
    }

    // MARK: pieces

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(headerLabel)
                .font(.system(size: 13, weight: .semibold)).tracking(0.3).textCase(.uppercase)
                .foregroundStyle(AT.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text("Needs you").font(.system(size: 34, weight: .bold)).foregroundStyle(AT.text)
                .accessibilityAddTraits(.isHeader)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var headerLabel: String {
        if waitingTotal == 0 { return model.loadedOnce ? "All clear" : "Checking" }
        var s = "\(waitingTotal) waiting"
        if let oldest = model.rows.filter({ $0.tag != .fyi }).compactMap({ $0.since }).min() {
            s += " \u{00B7} oldest " + NeedsYouModel.monthDayString(oldest)
        }
        return s
    }

    private var chips: some View {
        NYFlow(spacing: 8) {
            chip("All", model.rows.count, .all)
            chip("Critical", count(.critical), .critical)
            chip("Urgent", count(.urgent), .urgent)
            chip("Waiting", count(.waiting), .waiting)
        }
    }

    private func chip(_ name: String, _ n: Int, _ f: NeedsFilter) -> some View {
        let on = filter == f
        return Button {
            Haptics.select()
            filter = f
        } label: {
            Text("\(name) \(n)")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(on ? AT.bg : Color(white: 0.83))
                .padding(.horizontal, 14).frame(minHeight: 44)
                .background(on ? AT.text : AT.card, in: Capsule())
        }
        .buttonStyle(NYPressStyle())
        .accessibilityLabel("\(name), \(n)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var hint: some View {
        HStack(spacing: 6) {
            Image(systemName: "arrow.right").font(.system(size: 11, weight: .semibold))
            Text("Swipe right for Done, left for Later.").font(.system(size: 13))
        }
        .foregroundStyle(AT.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityHidden(true)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "checkmark.circle").font(.system(size: 40, weight: .light)).foregroundStyle(AT.lime)
                .accessibilityHidden(true)
            if !model.rows.isEmpty {
                Text("Nothing in this group").font(.system(size: 20, weight: .semibold)).foregroundStyle(AT.text)
            } else if model.loadFailed && !model.loadedOnce {
                Text("Couldn\u{2019}t load yet").font(.system(size: 20, weight: .semibold)).foregroundStyle(AT.text)
                Text("Pull down to try again.").font(.system(size: 15)).foregroundStyle(AT.secondary)
            } else if model.loadedOnce {
                Text("Nothing needs you").font(.system(size: 20, weight: .semibold)).foregroundStyle(AT.text)
                if let t = model.lastChecked {
                    Text(glue("Checked " + AdminFmt.time.string(from: t))).font(.system(size: 15)).foregroundStyle(AT.secondary)
                }
            } else {
                ProgressView().tint(AT.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var toastView: some View {
        if let t = model.toast {
            HStack(spacing: 4) {
                Text(t.text).font(.system(size: 15)).foregroundStyle(AT.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 16)
                if !t.undoKeys.isEmpty {
                    Text("\u{00B7}").foregroundStyle(AT.secondary)
                    Button { Task { await model.undo(t) } } label: {
                        Text("Undo").font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.lime)
                            .padding(.horizontal, 12).frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Undo")
                } else {
                    Spacer().frame(width: 16)
                }
            }
            .frame(minHeight: 44)
            .background(AT.inner, in: Capsule())
            .shadow(color: .black.opacity(0.35), radius: 14, y: 4)
            .padding(.bottom, 12)
            .transition(.opacity)
            .accessibilityElement(children: .contain)
        }
    }
}

private extension View {
    func listRowStyle(top: CGFloat, bottom: CGFloat) -> some View {
        self.listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: top, leading: 16, bottom: bottom, trailing: 16))
    }
}

// MARK: - one row

private struct NeedsCard: View {
    let row: NeedsRow
    @ObservedObject private var model = NeedsYouModel.shared

    var body: some View {
        let open = NeedsRouting.target(for: row)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 8) {
                Text(row.tag.label)
                    .font(.system(size: 11, weight: .bold)).tracking(0.6).textCase(.uppercase)
                    .foregroundStyle(row.tag.tagFg)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(row.tag.tagBg, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                Spacer(minLength: 8)
                Text(NeedsYouModel.sinceText(row.since)).font(.system(size: 13)).foregroundStyle(AT.secondary)
            }
            Text(row.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(AT.text)
                .fixedSize(horizontal: false, vertical: true)
            if let d = row.detail {
                Text(d).font(.system(size: 13)).foregroundStyle(Color(white: 0.79))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(NeedsWho.line(row.source)).font(.system(size: 13)).foregroundStyle(AT.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                if row.isHermesApproval {
                    key("Approve", lime: true) { await model.perform(row, .approve) }
                    key("Not now") { await model.perform(row, .done) }
                } else {
                    key(row.isFold ? "Done, all \(row.foldedKeys.count)" : "Done") { await model.perform(row, .done) }
                    key("Later") { await model.perform(row, .later) }
                }
                key(open.label) { await MainActor.run { AdminState.shared.go(open.route) } }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(row.tag.label). \(row.title). \(row.detail ?? ""). \(NeedsWho.line(row.source))")
        .accessibilityAction(named: "Done") { Task { await model.perform(row, .done) } }
        .accessibilityAction(named: "Later") { if !row.isHermesApproval { Task { await model.perform(row, .later) } } }
    }

    private func key(_ label: String, lime: Bool = false, _ action: @escaping () async -> Void) -> some View {
        Button {
            Haptics.tap()
            Task { await action() }
        } label: {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(lime ? AT.bg : AT.text)
                .padding(.horizontal, 6)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(lime ? AT.lime : Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(NYPressStyle())
        .accessibilityLabel(label)
    }
}
