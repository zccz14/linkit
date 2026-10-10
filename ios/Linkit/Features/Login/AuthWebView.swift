import SwiftUI
import WebKit

/// Hosts the Auth Mini login page and watches for the redirect back to the instance
/// origin. The redirect carries the issued session tokens; the web view stops loading
/// as soon as they arrive, and the caller completes the sign-in.
struct AuthWebView: UIViewRepresentable {
    let url: URL
    let instanceHost: String
    var onTokens: @MainActor (URL) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(instanceHost: instanceHost, onTokens: onTokens)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        private let instanceHost: String
        private let onTokens: @MainActor (URL) -> Void
        private var handled = false

        init(instanceHost: String, onTokens: @escaping @MainActor (URL) -> Void) {
            self.instanceHost = instanceHost
            self.onTokens = onTokens
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
            check(webView)
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation?) {
            check(webView)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            check(webView)
        }

        private func check(_ webView: WKWebView) {
            guard !handled, let target = webView.url else { return }
            guard LoginCallback.isCallbackURL(target, instanceHost: instanceHost),
                  target.fragment?.contains("access_token") == true
            else { return }
            handled = true
            webView.stopLoading()
            onTokens(target)
        }
    }
}
