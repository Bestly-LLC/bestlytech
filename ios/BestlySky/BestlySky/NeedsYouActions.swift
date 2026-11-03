// Bestly Admin: lock-screen actions for Needs you pushes. Registers the categories and handles the taps. Never sends a push.
import Foundation
import UserNotifications

enum NeedsYouActions {
    static let categoryId = "NEEDS_YOU"
    static let approveCategoryId = "NEEDS_YOU_APPROVE"

    /// Merges with categories other features registered (setNotificationCategories replaces the whole set).
    static func registerCategories() {
        let center = UNUserNotificationCenter.current()
        let open = UNNotificationAction(identifier: "OPEN", title: "Open in the app", options: [.foreground])
        let done = UNNotificationAction(identifier: "DONE", title: "Done", options: [])
        let later = UNNotificationAction(identifier: "LATER", title: "Later, in 3 hr", options: [])
        let approve = UNNotificationAction(identifier: "APPROVE", title: "Approve", options: [.authenticationRequired])
        let notNow = UNNotificationAction(identifier: "DONE", title: "Not now", options: [])
        let plain = UNNotificationCategory(identifier: categoryId, actions: [done, later, open],
                                           intentIdentifiers: [], options: [])
        let approval = UNNotificationCategory(identifier: approveCategoryId, actions: [approve, notNow, open],
                                              intentIdentifiers: [], options: [])
        center.getNotificationCategories { existing in
            var all = existing.filter { $0.identifier != categoryId && $0.identifier != approveCategoryId }
            all.insert(plain)
            all.insert(approval)
            center.setNotificationCategories(all)
        }
    }

    static func handle(actionIdentifier: String, userInfo: [AnyHashable: Any]) async {
        if actionIdentifier == "OPEN" {
            await MainActor.run { AdminState.shared.tab = 1 }
            await NeedsYouModel.shared.load()
            return
        }
        var key = userInfo["key"] as? String
        if key == nil, let bell = userInfo["bell_id"] as? String { key = "bell:" + bell }
        guard let key, !key.isEmpty else { return }
        let action: String
        switch actionIdentifier {
        case "DONE": action = "dismiss"
        case "LATER": action = "snooze"
        case "APPROVE":
            guard key.hasPrefix("hermes:act:") else { return }
            action = "approve"
        default: return
        }
        _ = try? await AdminAPI.rpc("admin_today_act", ["p_key": key, "p_action": action])
        await NeedsYouModel.shared.load()
    }
}
