// Bestly Admin: Scout's chat list and settings sheets.
import SwiftUI

struct ScoutThreadsSheet: View {
    @ObservedObject var model: ScoutModel
    @Binding var isPresented: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                AT.bg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 10) {
                        Button {
                            Haptics.tap()
                            model.newChat()
                            isPresented = false
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "plus").font(.system(size: 16, weight: .bold))
                                Text("New chat").font(.system(size: 16, weight: .semibold))
                                Spacer(minLength: 0)
                            }
                            .foregroundStyle(AT.bg)
                            .padding(.horizontal, 16).frame(maxWidth: .infinity, minHeight: 48)
                            .background(AT.lavender, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                        .buttonStyle(NYPressStyle())
                        .accessibilityLabel("New chat")

                        if model.threads.isEmpty {
                            Text("No chats yet. Start one and it shows up here.")
                                .font(.system(size: 15)).foregroundStyle(AT.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 16)
                        }
                        ForEach(model.threads) { t in threadRow(t) }
                    }
                    .padding(16)
                }
                .refreshable { await model.loadThreads() }
            }
            .navigationTitle("Chats")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { isPresented = false }.frame(minWidth: 44, minHeight: 44)
                }
            }
        }
        .task { await model.loadThreads() }
    }

    private func dot(_ t: ScoutThread) -> Color? {
        if t.id == model.threadId { return nil }
        if t.needsYou { return ScoutColors.needs }
        if t.unread > 0 { return ScoutColors.purple }
        return nil
    }

    private func threadRow(_ t: ScoutThread) -> some View {
        let isOpen = t.id == model.threadId
        let d = dot(t)
        let preview = ScoutText.short(t.lastBody, 90)
        return Button {
            Haptics.select()
            Task { await model.openThread(t.id) }
            isPresented = false
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Circle().fill(d ?? Color.clear).frame(width: 10, height: 10).padding(.top, 6)
                VStack(alignment: .leading, spacing: 3) {
                    Text(t.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(AT.text)
                        .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    if !preview.isEmpty {
                        Text(preview).font(.system(size: 13)).foregroundStyle(Color(white: 0.79))
                            .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    }
                    Text(ScoutText.ago(t.updated) + " \u{00B7} " + "\(t.count)\u{00A0}" + (t.count == 1 ? "message" : "messages"))
                        .font(.system(size: 13)).foregroundStyle(AT.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(14).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(isOpen ? AT.inner : AT.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(NYPressStyle())
        .accessibilityLabel("\(t.title). \(t.needsYou ? "Needs you. " : (t.unread > 0 ? "Unread reply. " : ""))\(ScoutText.ago(t.updated))")
    }
}

struct ScoutSettingsSheet: View {
    @ObservedObject var model: ScoutModel
    @Binding var isPresented: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                AT.bg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 12) {
                        card {
                            toggleRow(title: paidTitle, detail: paidDetail, tint: ScoutColors.needs,
                                      isOn: Binding(get: { model.prefs.paidOK }, set: { v in Task { await model.setPaid(v) } }),
                                      label: "Paid AI", disabled: forcedOff)
                        }
                        card {
                            toggleRow(title: model.prefs.autoRun ? "Auto-run is on" : "Auto-run is off",
                                      detail: model.prefs.autoRun ? "Scout just does it. No buttons to tap." : "Scout asks you before it changes anything.",
                                      tint: AT.green,
                                      isOn: Binding(get: { model.prefs.autoRun }, set: { v in Task { await model.setAutoRun(v) } }),
                                      label: "Auto-run")
                        }
                        if let b = model.budgetLine {
                            card {
                                Text(b).font(.system(size: 16, weight: .semibold)).foregroundStyle(AT.text)
                                if let c = capLine {
                                    Text(c).font(.system(size: 13)).foregroundStyle(AT.secondary).fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                        if !model.prefsKnown {
                            Text("Couldn\u{2019}t load Scout\u{2019}s settings yet. Pull down to retry.")
                                .font(.system(size: 13)).foregroundStyle(AT.secondary)
                        }
                    }
                    .padding(16)
                }
                .refreshable { await model.loadPrefs(); await model.loadBudget() }
            }
            .navigationTitle("Scout settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { isPresented = false }.frame(minWidth: 44, minHeight: 44)
                }
            }
        }
        .task { await model.loadPrefs(); await model.loadBudget() }
    }

    private var capLine: String? {
        guard let c = model.prefs.chatCap, let b = model.prefs.backgroundCap else { return nil }
        return String(format: "Daily caps: chat $%.2f, background $%.2f.", c, b)
    }

    private var untilText: String? {
        model.prefs.paidUntil.map { glue(AdminFmt.time.string(from: $0)) }
    }
    private var capText: String {
        (model.prefs.chatCap ?? model.prefs.backgroundCap).map { String(format: "$%.0f", $0) } ?? "daily"
    }

    private var paidTitle: String {
        if model.prefs.paidOK { return untilText.map { "Paid AI until " + $0 } ?? "Paid AI is on" }
        switch model.prefs.offReason {
        case "cap": return "Paid AI is off, cap hit"
        case "hour_up": return "Paid AI is off, your hour ended"
        case "watchdog": return "Paid AI was forced off"
        default: return "Paid AI is off"
        }
    }
    private var forcedOff: Bool { !model.prefs.paidOK && model.prefs.offReason == "watchdog" }
    private var paidDetail: String {
        if model.prefs.paidOK {
            if let u = untilText { return "Scout is using Claude (paid). Turns itself off at \(u) or at the \(capText) daily cap." }
            return "Scout is using Claude (paid)."
        }
        switch model.prefs.offReason {
        case "cap": return "Free AI only until midnight. Today hit the \(capText) cap."
        case "hour_up": return "Free AI only. Flip this on, or tap \u{201C}Yes, use paid AI\u{201D} in a chat for another hour."
        case "watchdog": return "From \(model.prefs.offBy ?? "Scout"): a budget check switched paid AI off. It stays off until that check clears. Free AI only."
        default: return "Free AI only. If a job needs Claude, Scout asks first. A yes turns this on for one hour."
        }
    }

    private func card<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) { content() }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
    }

    private func toggleRow(title: String, detail: String, tint: Color, isOn: Binding<Bool>, label: String, disabled: Bool = false) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(AT.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail).font(.system(size: 13)).foregroundStyle(AT.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(tint)
        .disabled(disabled)
        .frame(minHeight: 44)
        .accessibilityLabel(label)
        .accessibilityValue(isOn.wrappedValue ? "On" : "Off")
    }
}
