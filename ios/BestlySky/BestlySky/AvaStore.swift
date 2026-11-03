// Bestly Admin: the Ava inbox state. Optimistic toggles with a revert on error, read marking, deep-link target.
import Foundation
import SwiftUI

@MainActor
final class AvaStore: ObservableObject {
    static let shared = AvaStore()
    @Published private(set) var items: [AvaItem] = []
    @Published private(set) var loading = false
    @Published private(set) var nextBefore: String?
    @Published var error: String?
    @Published var openCallNo: Int?        // the message a deep link or a tapped alert asked for
    @Published var pendingOpen: Int?       // set by the notification delegate before the UI exists
    var unreadCount: Int { items.filter { !$0.read }.count }

    func refresh() async {
        loading = true
        defer { loading = false }
        do {
            let p = try await AvaAPI.list()
            items = p.items
            nextBefore = p.next_before
            error = nil
        } catch {
            self.error = "Couldn't load Ava's messages. Pull down to try again."
        }
    }
    func loadMore() async {
        guard let nb = nextBefore, !loading else { return }
        loading = true
        defer { loading = false }
        if let p = try? await AvaAPI.list(before: nb) {
            let known = Set(items.map { $0.id })
            items.append(contentsOf: p.items.filter { !known.contains($0.id) })
            nextBefore = p.next_before
        }
    }
    private func replace(_ it: AvaItem) {
        if let i = items.firstIndex(where: { $0.id == it.id }) { items[i] = it }
    }
    func toggleForwarded(_ id: String, to value: Bool) async {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        let old = items[i].forwarded
        items[i].forwarded = value
        do {
            replace(try await AvaAPI.setForwarded(items[i], value))
            error = nil
        } catch {
            if let j = items.firstIndex(where: { $0.id == id }) { items[j].forwarded = old }
            self.error = "Couldn't save that. Try again."
        }
    }
    func markRead(_ id: String) async {
        guard let i = items.firstIndex(where: { $0.id == id }), !items[i].read else { return }
        items[i].read = true
        do { try await AvaAPI.markRead(items[i]) } catch {
            if let j = items.firstIndex(where: { $0.id == id }) { items[j].read = false }
        }
    }
    func open(callNo: Int) async {
        if !items.contains(where: { $0.callNo == callNo }) { await refresh() }
        openCallNo = callNo
        if let it = items.first(where: { $0.callNo == callNo }) { await markRead(it.id) }
    }
}
