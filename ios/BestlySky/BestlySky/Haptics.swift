// Bestly Admin: haptics. One place so every screen feels the same.
import UIKit

@MainActor
enum Haptics {
    private static let light = UIImpactFeedbackGenerator(style: .light)
    private static let medium = UIImpactFeedbackGenerator(style: .medium)
    private static let selection = UISelectionFeedbackGenerator()
    private static let notification = UINotificationFeedbackGenerator()

    static func prepare() {
        light.prepare(); medium.prepare(); selection.prepare(); notification.prepare()
    }
    /// Key press-down.
    static func tap() { light.impactOccurred(); light.prepare() }
    /// Power and other heavy keys.
    static func thunk() { medium.impactOccurred(); medium.prepare() }
    /// Mode or segment change.
    static func select() { selection.selectionChanged(); selection.prepare() }
    static func ok() { notification.notificationOccurred(.success); notification.prepare() }
    static func fail() { notification.notificationOccurred(.error); notification.prepare() }
    /// Tapping a disabled key.
    static func nope() { notification.notificationOccurred(.warning); notification.prepare() }
}
