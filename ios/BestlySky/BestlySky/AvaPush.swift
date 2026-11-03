// Bestly Admin: alert pushes (Ava's messages). The device token goes to the server through TokenSync with kind "alert".
import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class AvaPush {
    static let shared = AvaPush()
    func status() async -> UNAuthorizationStatus { await UNUserNotificationCenter.current().notificationSettings().authorizationStatus }
    func registerIfAllowed() async {
        let s = await status()
        if s == .authorized || s == .provisional || s == .ephemeral { UIApplication.shared.registerForRemoteNotifications() }
    }
    func requestPermission() async -> Bool {
        let ok = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        if ok { UIApplication.shared.registerForRemoteNotifications() }
        return ok
    }
}

final class AdminAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Task { @MainActor in await AvaPush.shared.registerIfAllowed() }
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in await TokenSync.shared.registerAlert(deviceToken) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("SkyTokens: alert registration failed %@", String(describing: error))
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        var call: Int?
        if let n = info["call_no"] as? Int { call = n }
        else if let s = info["call_no"] as? String { call = Int(s) }
        else if let u = info["url"] as? String, let url = URL(string: u) { call = AvaDeepLink.callNo(url) }
        if let call { await MainActor.run { AvaStore.shared.pendingOpen = call } }
    }
}
