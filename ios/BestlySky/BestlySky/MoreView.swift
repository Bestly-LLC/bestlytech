// Bestly Admin: More (matches the approved More screen). Four native tiles, the sky compass, six pages that open in Safari, sign out.
import SwiftUI

struct MoreView: View {
    @ObservedObject private var auth = AdminAuth.shared
    @ObservedObject private var state = AdminState.shared
    @ObservedObject private var avaStore = AvaStore.shared
    @State private var confirmSignOut = false

    private struct SafariRow: Identifiable { var id: String { title }; var title: String; var url: URL }
    private let safariRows: [SafariRow] = [
        SafariRow(title: "AI Team and Security", url: URL(string: "https://www.bestly.tech/admin/team")!),
        SafariRow(title: "Studio approvals", url: URL(string: "https://studio.bestly.tech")!),
        SafariRow(title: "Claims Closer details", url: URL(string: "https://www.bestly.tech/admin/claims")!),
        SafariRow(title: "Street sweeping", url: URL(string: "https://www.bestly.tech/admin/street-sweeping")!),
        SafariRow(title: "Pipeline", url: URL(string: "https://www.bestly.tech/admin/pipeline")!),
        SafariRow(title: "Google Voice texts", url: URL(string: "https://www.bestly.tech/admin/skytouch")!),
    ]

    var body: some View {
        NavigationStack(path: $state.morePath) {
            ZStack {
                AT.bg.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("More").font(.system(size: 34, weight: .bold)).foregroundStyle(AT.text).padding(.top, 8)
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                            NavigationLink(value: MoreDestination.turo) {
                                tile("Turo", "Blue Steel, trips, claims", AT.sky, "car.fill")
                            }.buttonStyle(.plain)
                            NavigationLink(value: MoreDestination.home) {
                                tile("Home", "Callbox, door, automations", AT.peach, "house.fill")
                            }.buttonStyle(.plain)
                            NavigationLink(value: MoreDestination.agents) {
                                tile("Agents", "Maya, Reese and Leo calls", AT.lavender, "phone.fill")
                            }.buttonStyle(.plain)
                            Button { state.showAva = true } label: {
                                tile("Ava", avaStore.unreadCount > 0 ? "\(avaStore.unreadCount) new messages" : "Your messages", AT.lime, "bubble.left.fill")
                            }.buttonStyle(.plain)
                        }
                        VStack(spacing: 0) {
                            Button { state.showCompass = true } label: { row("Sky compass", opensOut: false) }.buttonStyle(.plain)
                        }
                        .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
                        Text("OPENS IN SAFARI").font(.system(size: 13, weight: .semibold)).tracking(0.3).foregroundStyle(AT.secondary).padding(.top, 6)
                        VStack(spacing: 0) {
                            ForEach(Array(safariRows.enumerated()), id: \.element.id) { i, r in
                                Button { SafariLink.open(r.url) } label: { row(r.title, opensOut: true) }.buttonStyle(.plain)
                                if i < safariRows.count - 1 { divider }
                            }
                        }
                        .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
                        Button { confirmSignOut = true } label: {
                            Text("Sign out").font(.system(size: 17)).foregroundStyle(AT.orange)
                                .frame(maxWidth: .infinity, minHeight: 50)
                                .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
                        }
                        .padding(.top, 6)
                        Text("Build \(SkyAPI.appVersion)").font(.system(size: 12)).foregroundStyle(AT.secondary).frame(maxWidth: .infinity).padding(.top, 4)
                    }
                    .padding(.horizontal, 16).padding(.bottom, 24)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .screenView("more")
            .navigationDestination(for: MoreDestination.self) { d in
                switch d {
                case .turo: TuroScreen()
                case .home: HomeScreen()
                case .agents: AgentsScreen()
                }
            }
            .confirmationDialog("Sign out of Bestly Admin?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { auth.signOut() }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private var divider: some View { Rectangle().fill(Color.white.opacity(0.05)).frame(height: 1) }

    private func row(_ title: String, opensOut: Bool) -> some View {
        HStack {
            Text(title).font(.system(size: 16)).foregroundStyle(AT.text).fixedSize(horizontal: false, vertical: true)
            Spacer()
            Image(systemName: opensOut ? "arrow.up.right" : "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(AT.hex(0x71717A))
        }
        .padding(.horizontal, 16).frame(minHeight: 48)
        .contentShape(Rectangle())
    }

    private func tile(_ name: String, _ line: String, _ tint: Color, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon).font(.system(size: 17, weight: .semibold)).foregroundStyle(AT.hex(0x111114))
                .frame(width: 36, height: 36).background(tint, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            Text(name).font(.system(size: 15, weight: .semibold)).foregroundStyle(AT.text)
            Text(line).font(.system(size: 13)).foregroundStyle(AT.secondary).fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.leading)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 112, alignment: .topLeading)
        .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
    }
}
