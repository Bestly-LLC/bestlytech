// Bestly Admin: in-app web pages. The user agent carries "BestlyAdminApp" so www.bestly.tech/admin loads here
// instead of forwarding to Bestly Cloud, and the app's session is written into the page's localStorage at document
// start (same key and shape supabase-js v2 uses). If the page rejects it, the page shows its own sign-in.
import SwiftUI
import UIKit
import WebKit

enum AdminWeb {
    static func sessionScript(_ sessionJSON: String) -> WKUserScript {
        let js = """
        (function(){try{
          var k='\(AdminConfig.storageKey)';var s=\(sessionJSON);
          var cur=null;try{cur=JSON.parse(localStorage.getItem(k)||'null');}catch(e){}
          var newer=!cur||!cur.expires_at||cur.expires_at<s.expires_at||(cur.user&&s.user&&cur.user.id!==s.user.id);
          if(newer){localStorage.setItem(k,JSON.stringify(s));}
        }catch(e){}})();
        """
        return WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    @MainActor static func clearSession() async {
        let store = WKWebsiteDataStore.default()
        await store.removeData(ofTypes: [WKWebsiteDataTypeLocalStorage, WKWebsiteDataTypeSessionStorage, WKWebsiteDataTypeCookies], modifiedSince: .distantPast)
    }

    static func adminURL(_ path: String) -> URL { URL(string: AdminConfig.adminBase + path)! }
}

@MainActor
final class WebController: ObservableObject {
    @Published var canGoBack = false
    @Published var loading = true
    @Published var failed = false
    weak var web: WKWebView?
    func back() { web?.goBack() }
    func reload() { failed = false; web?.reload() }
}

struct AdminWebView: UIViewRepresentable {
    let url: URL
    var injectSession = true
    @ObservedObject var controller: WebController

    func makeCoordinator() -> Coordinator { Coordinator(controller: controller) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        if injectSession, url.host?.hasSuffix("bestly.tech") == true, let s = AdminAuth.shared.session {
            cfg.userContentController.addUserScript(AdminWeb.sessionScript(s.jsonString))
        }
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 \(AdminConfig.userAgentToken)/1"
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 11 / 255, green: 11 / 255, blue: 15 / 255, alpha: 1)
        web.scrollView.backgroundColor = web.backgroundColor
        web.allowsBackForwardNavigationGestures = true
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        let rc = UIRefreshControl()
        rc.tintColor = .lightGray
        rc.addTarget(context.coordinator, action: #selector(Coordinator.pulled(_:)), for: .valueChanged)
        web.scrollView.refreshControl = rc
        context.coordinator.web = web
        controller.web = web
        web.load(URLRequest(url: url))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let controller: WebController
        weak var web: WKWebView?
        init(controller: WebController) { self.controller = controller }

        @objc func pulled(_ rc: UIRefreshControl) {
            web?.reload()
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            Task { @MainActor in controller.loading = true; controller.failed = false }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.scrollView.refreshControl?.endRefreshing()
            Task { @MainActor in controller.loading = false; controller.canGoBack = webView.canGoBack }
            // Take the page's session back when it refreshed it, so the app and the page never fight over one refresh token.
            if webView.url?.host?.hasSuffix("bestly.tech") == true {
                webView.evaluateJavaScript("localStorage.getItem('\(AdminConfig.storageKey)')") { v, _ in
                    if let s = v as? String { Task { @MainActor in AdminAuth.shared.adoptWebSession(s) } }
                }
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(webView) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(webView) }
        private func failed(_ webView: WKWebView) {
            webView.scrollView.refreshControl?.endRefreshing()
            Task { @MainActor in controller.loading = false; controller.failed = true; controller.canGoBack = webView.canGoBack }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let u = action.request.url, let host = u.host?.lowercased(), action.targetFrame?.isMainFrame != false else { decisionHandler(.allow); return }
            let ours = host.hasSuffix("bestly.tech") || host.hasSuffix("supabase.co") || host.hasSuffix("apple.com")
            if !ours && (u.scheme == "https" || u.scheme == "http" || u.scheme == "tel" || u.scheme == "mailto") && action.navigationType == .linkActivated {
                UIApplication.shared.open(u)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }

        // target=_blank links open in the same view
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
            return nil
        }
    }
}

/// A web page with a native back button when the page can go back, and a calm failure line.
struct AdminWebScreen: View {
    let title: String
    let url: URL
    var injectSession = true
    var showsTitle = false
    var isTabRoot = false          // a tab's own page: no navigation bar, a floating back button instead
    @StateObject private var controller = WebController()

    var body: some View {
        ZStack(alignment: .top) {
            AT.bg.ignoresSafeArea()
            AdminWebView(url: url, injectSession: injectSession, controller: controller)
                .ignoresSafeArea(edges: .bottom)
            if controller.failed {
                VStack(spacing: 10) {
                    Text("Couldn't load \(title). Pull down to retry.")
                        .font(.system(size: 15)).foregroundStyle(AT.text).multilineTextAlignment(.center)
                    Button("Try again") { controller.reload() }
                        .font(.system(size: 17, weight: .semibold))
                        .frame(minWidth: 120, minHeight: 44)
                        .background(AT.lime, in: Capsule()).foregroundStyle(.black)
                }
                .padding(20)
                .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
                .padding(.top, 80)
            }
        }
        .overlay(alignment: .topLeading) {
            if isTabRoot && controller.canGoBack {
                Button { controller.back() } label: {
                    Image(systemName: "chevron.backward").font(.system(size: 17, weight: .semibold)).foregroundStyle(AT.text)
                        .frame(width: 44, height: 44).background(.ultraThinMaterial, in: Circle())
                }
                .padding(.leading, 12).padding(.top, 4)
                .accessibilityLabel("Back")
            }
        }
        .navigationTitle(showsTitle ? title : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(AT.bg, for: .navigationBar)
        .toolbar(isTabRoot ? .hidden : .automatic, for: .navigationBar)
        .toolbar {
            if controller.canGoBack && !isTabRoot {
                ToolbarItem(placement: .topBarLeading) {
                    Button { controller.back() } label: {
                        Label("Back", systemImage: "chevron.backward").frame(minWidth: 44, minHeight: 44)
                    }
                }
            }
        }
    }
}
