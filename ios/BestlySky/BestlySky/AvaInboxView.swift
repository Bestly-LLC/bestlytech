// Bestly Admin: the Ava inbox. Each row: caller, the full message (never cut off), callback number, time, call number,
// a one-tap Call back, and a "Came through my cell" toggle. Ava's accent is her orange orb: a feathered glow, never a hard edge.
import SwiftUI
import UIKit
import UserNotifications

enum AvaStyle {
    static let orange = Color(red: 1.0, green: 159.0 / 255, blue: 10.0 / 255)      // #FF9F0A
    static let card = Color(white: 0.11)
}

struct AvaBackdrop: View {
    var body: some View {
        ZStack(alignment: .top) {
            Color.black
            RadialGradient(colors: [AvaStyle.orange.opacity(0.30), AvaStyle.orange.opacity(0.10), .clear],
                           center: .top, startRadius: 0, endRadius: 420)
                .frame(height: 520)
        }
        .ignoresSafeArea()
    }
}

struct AvaAlertsCard: View {
    @State private var status: UNAuthorizationStatus = .authorized
    @Environment(\.scenePhase) private var phase
    var body: some View {
        Group {
            if status == .notDetermined || status == .denied {
                VStack(alignment: .leading, spacing: 8) {
                    Text(status == .denied ? "Ava's alerts are off" : "Get Ava's messages the moment they come in")
                        .font(.headline).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
                    Text(status == .denied ? "Turn on notifications for Bestly Admin in Settings." : "Bestly Admin sends an alert when someone leaves you a message.")
                        .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Button {
                        Task {
                            if status == .denied {
                                if let u = URL(string: UIApplication.openSettingsURLString) { await UIApplication.shared.open(u) }
                            } else {
                                _ = await AvaPush.shared.requestPermission()
                            }
                            status = await AvaPush.shared.status()
                        }
                    } label: {
                        Text(status == .denied ? "Open Settings" : "Turn on alerts")
                            .font(.body.weight(.semibold)).foregroundStyle(.black)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(Capsule().fill(AvaStyle.orange))
                    }
                }
                .padding(16)
                .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(AvaStyle.card))
            }
        }
        .task { status = await AvaPush.shared.status() }
        .onChange(of: phase) { _, _ in Task { status = await AvaPush.shared.status() } }
    }
}

struct AvaRow: View {
    let item: AvaItem
    let highlighted: Bool
    @ObservedObject private var store = AvaStore.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if !item.read {
                    Circle().fill(AvaStyle.orange).frame(width: 9, height: 9)
                        .shadow(color: AvaStyle.orange.opacity(0.6), radius: 5)
                        .accessibilityLabel("Unread")
                }
                Text(item.name).font(.headline).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Text("#\(item.callNo)").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary).fixedSize()
            }
            Text(item.message).font(.body).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 3) {
                detail("Caller", item.phoneDisplay)
                if let cb = item.callbackNumberDisplay, !cb.isEmpty { detail("Callback number", cb) }
                detail("Time", item.timeDisplay)
            }
            Link(destination: URL(string: "tel:\(item.callNumberToDial)") ?? URL(string: "tel:")!) {
                Label("Call back", systemImage: "phone.fill")
                    .font(.body.weight(.semibold)).foregroundStyle(.black)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Capsule().fill(AvaStyle.orange))
            }
            Toggle(isOn: Binding(get: { item.forwarded }, set: { v in Task { await store.toggleForwarded(item.id, to: v) } })) {
                Text("Came through my cell").font(.body).foregroundStyle(.white)
            }
            .tint(AvaStyle.orange)
            .frame(minHeight: 44)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(AvaStyle.card))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.white.opacity(0.06)))
        .shadow(color: highlighted ? AvaStyle.orange.opacity(0.45) : .clear, radius: 18)
        .contentShape(Rectangle())
        .onTapGesture { Task { await store.markRead(item.id) } }
        .accessibilityElement(children: .contain)
    }

    private func detail(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(label).font(.footnote).foregroundStyle(.secondary)
            Text(value).font(.footnote.monospacedDigit()).foregroundStyle(Color(white: 0.86)).lineLimit(1).minimumScaleFactor(0.8)
        }
    }
}

struct AvaInboxView: View {
    @ObservedObject private var store = AvaStore.shared

    var body: some View {
        NavigationStack {
            ZStack {
                AvaBackdrop()
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            AvaAlertsCard()
                            if let e = store.error {
                                Text(e).font(.footnote).foregroundStyle(AvaStyle.orange)
                                    .frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
                            }
                            if store.items.isEmpty && !store.loading {
                                VStack(spacing: 6) {
                                    Text("No messages yet").font(.headline).foregroundStyle(.white)
                                    Text("When someone leaves Ava a message, it shows up here.").font(.subheadline).foregroundStyle(.secondary)
                                        .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                                }
                                .padding(.top, 60)
                            }
                            ForEach(store.items) { item in
                                AvaRow(item: item, highlighted: store.openCallNo == item.callNo).id(item.callNo)
                            }
                            if store.nextBefore != nil {
                                ProgressView().padding().onAppear { Task { await store.loadMore() } }
                            }
                        }
                        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
                    }
                    .refreshable { await store.refresh() }
                    .onChange(of: store.openCallNo) { _, n in
                        if let n { withAnimation { proxy.scrollTo(n, anchor: .top) } }
                    }
                }
            }
            .navigationTitle("Ava")
            .navigationBarTitleDisplayMode(.large)
        }
        .task { await store.refresh() }
    }
}
