// Bestly Admin: rare pages open in an in-app Safari sheet (dark). No web views of our own.
import SafariServices
import UIKit

@MainActor
enum SafariLink {
    static func open(_ url: URL) {
        guard url.scheme == "https" || url.scheme == "http" else { UIApplication.shared.open(url); return }
        let vc = SFSafariViewController(url: url)
        vc.preferredBarTintColor = UIColor(red: 0.043, green: 0.043, blue: 0.059, alpha: 1)
        vc.preferredControlTintColor = UIColor(red: 0.784, green: 0.945, blue: 0.380, alpha: 1)
        vc.overrideUserInterfaceStyle = .dark
        guard let top = topController() else { UIApplication.shared.open(url); return }
        top.present(vc, animated: true)
    }

    private static func topController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController ?? scene?.windows.first?.rootViewController
        while let p = top?.presentedViewController { top = p }
        return top
    }
}
