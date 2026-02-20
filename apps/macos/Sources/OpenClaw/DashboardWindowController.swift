import AppKit
import Foundation
import OSLog
import WebKit

/// Full-window WKWebView dashboard that loads the bundled Next.js app.
/// Only shown when `BundledAppDetector.hasWebApp()` returns true.
@MainActor
final class DashboardWindowController: NSWindowController {
    static let shared = DashboardWindowController()

    private let logger = Logger(subsystem: "ai.openclaw", category: "dashboard")
    private var webView: WKWebView?
    private var spinner: NSProgressIndicator?
    private var statusObservationTask: Task<Void, Never>?

    // MARK: - Init

    private init() {
        let window = Self.makeWindow()
        super.init(window: window)
        self.setupContent(in: window)
        self.observeWebAppStatus()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }

    // MARK: - Public

    func bringToFront() {
        self.showWindow(nil)
        self.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - Setup

    private static func makeWindow() -> NSWindow {
        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false)
        win.title = "OpenClaw"
        win.titlebarAppearsTransparent = true
        win.isReleasedWhenClosed = false
        win.center()
        win.setFrameAutosaveName("DashboardWindow")
        win.minSize = NSSize(width: 800, height: 600)
        return win
    }

    private func setupContent(in window: NSWindow) {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        // Allow local resources
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        let wv = WKWebView(frame: window.contentView?.bounds ?? .zero, configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.navigationDelegate = self
        wv.allowsMagnification = true

        // Inject a flag so the web app knows it's running inside the native shell.
        let script = WKUserScript(
            source: "window.__openclawNative = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false)
        wv.configuration.userContentController.addUserScript(script)

        window.contentView?.addSubview(wv)
        self.webView = wv

        // Loading spinner shown until server is ready.
        let spin = NSProgressIndicator()
        spin.style = .spinning
        spin.controlSize = .large
        spin.isIndeterminate = true
        spin.startAnimation(nil)
        spin.translatesAutoresizingMaskIntoConstraints = false
        window.contentView?.addSubview(spin)
        if let contentView = window.contentView {
            NSLayoutConstraint.activate([
                spin.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
                spin.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            ])
        }
        self.spinner = spin
    }

    // MARK: - Status observation

    private func observeWebAppStatus() {
        self.statusObservationTask?.cancel()
        self.statusObservationTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if case .running = WebAppProcessManager.shared.status {
                    self.loadDashboard()
                    return
                } else if case .failed = WebAppProcessManager.shared.status {
                    self.showError()
                    return
                }
                try? await Task.sleep(nanoseconds: 300_000_000)
            }
        }
    }

    private func loadDashboard() {
        guard let wv = self.webView else { return }
        self.logger.info("dashboard: loading http://127.0.0.1:3100/")
        let url = URL(string: "http://127.0.0.1:3100/")!
        wv.load(URLRequest(url: url))
    }

    private func showError() {
        guard let spin = self.spinner else { return }
        spin.stopAnimation(nil)
        spin.removeFromSuperview()
        self.spinner = nil

        let label = NSTextField(labelWithString: "Failed to start the web app.\nCheck Console.app for details.")
        label.alignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        self.window?.contentView?.addSubview(label)
        if let contentView = self.window?.contentView {
            NSLayoutConstraint.activate([
                label.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
                label.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            ])
        }
    }
}

// MARK: - WKNavigationDelegate

extension DashboardWindowController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        self.spinner?.stopAnimation(nil)
        self.spinner?.removeFromSuperview()
        self.spinner = nil
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void)
    {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let host = url.host ?? ""
        // Allow navigation within the local app server.
        if host == "127.0.0.1" || host == "localhost" {
            decisionHandler(.allow)
            return
        }
        // Open external URLs in the default browser.
        if url.scheme == "http" || url.scheme == "https" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
