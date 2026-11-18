// Vektor — native macOS app (WKWebView) around vektor.html
import Cocoa
import WebKit
import UniformTypeIdentifiers

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: WKWebView!

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMenu()
        let cfg = WKWebViewConfiguration()
        cfg.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        cfg.userContentController.add(self, name: "vektor")   // one-click update from the banner
        web = WKWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = self
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1480, height: 940),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Vektor"
        window.minSize = NSSize(width: 1100, height: 700)
        window.backgroundColor = NSColor(red: 0.075, green: 0.078, blue: 0.086, alpha: 1)
        window.contentView = web
        window.setFrameAutosaveName("VektorMain")
        if !window.setFrameUsingName("VektorMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
        if let url = Bundle.main.url(forResource: "vektor", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

    // <input type="file">
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = false
        p.canChooseDirectories = false
        p.allowedContentTypes = [.png, .jpeg, .webP, .gif, .bmp, .svg, .image]
        p.beginSheetModal(for: window) { r in completionHandler(r == .OK ? p.urls : nil) }
    }
    // downloads (blob: + download attribute)
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload { decisionHandler(.download); return }
        if let u = action.request.url, ["http", "https"].contains(u.scheme ?? ""), action.navigationType == .linkActivated || action.targetFrame == nil {
            NSWorkspace.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let p = NSSavePanel()
        p.nameFieldStringValue = suggestedFilename
        p.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        p.canCreateDirectories = true
        p.beginSheetModal(for: window) { r in
            guard r == .OK, let url = p.url else { completionHandler(nil); return }
            try? FileManager.default.removeItem(at: url)
            completionHandler(url)
        }
    }
    func downloadDidFinish(_ download: WKDownload) {}
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let a = NSAlert(); a.messageText = "Could not save"; a.informativeText = error.localizedDescription; a.runModal()
    }
    // possible alert() / confirm()
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.runModal(); completionHandler()
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let app = NSMenu()
        app.addItem(withTitle: "About Vektor", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Hide Vektor", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(.separator())
        app.addItem(withTitle: "Quit Vektor", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = app
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: #selector(vkUndo), keyEquivalent: "z")
        let redoItem = edit.addItem(withTitle: "Redo", action: #selector(vkRedo), keyEquivalent: "z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        view.addItem(withTitle: "Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        viewItem.submenu = view
        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win
        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }
    @objc func reload() { web.reload() }

    // ───── update: downloads the release zip, replaces Vektor.app, relaunches ─────
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let d = message.body as? [String: Any], d["type"] as? String == "update",
              let s = d["url"] as? String, let url = URL(string: s), url.host == "github.com" else { return }
        selfUpdate(from: url)
    }
    func updState(_ state: String, _ text: String) {
        DispatchQueue.main.async {
            let esc = text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
            self.web.evaluateJavaScript("window.__vkUpd && window.__vkUpd('\(state)', '\(esc)')")
        }
    }
    func selfUpdate(from url: URL) {
        updState("progress", "Downloading…")
        URLSession.shared.downloadTask(with: url) { tmp, resp, err in
            guard let tmp = tmp, err == nil, (resp as? HTTPURLResponse)?.statusCode == 200 else {
                self.updState("error", "Download failed"); return
            }
            do {
                let fm = FileManager.default
                let work = fm.temporaryDirectory.appendingPathComponent("vektor-update-\(UUID().uuidString)")
                try fm.createDirectory(at: work, withIntermediateDirectories: true)
                let zip = work.appendingPathComponent("Vektor-macOS.zip")
                try fm.moveItem(at: tmp, to: zip)
                self.updState("progress", "Installing…")
                let unzip = Process(); unzip.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
                unzip.arguments = ["-x", "-k", zip.path, work.path]; try unzip.run(); unzip.waitUntilExit()
                let newApp = work.appendingPathComponent("Vektor.app")
                guard unzip.terminationStatus == 0, fm.fileExists(atPath: newApp.appendingPathComponent("Contents/MacOS/Vektor").path) else {
                    self.updState("error", "Invalid archive"); return
                }
                let dest = Bundle.main.bundlePath
                guard fm.isWritableFile(atPath: (dest as NSString).deletingLastPathComponent) else {
                    self.updState("error", "App folder is not writable"); return
                }
                // a small script waits for the app to close, replaces the bundle and relaunches
                let q: (String) -> String = { "'" + $0.replacingOccurrences(of: "'", with: "'\\''") + "'" }
                let script = "while kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do sleep 0.2; done; " +
                    "rm -rf \(q(dest)) && mv \(q(newApp.path)) \(q(dest)) && xattr -dr com.apple.quarantine \(q(dest)); open \(q(dest)); rm -rf \(q(work.path))"
                let sh = Process(); sh.executableURL = URL(fileURLWithPath: "/bin/sh"); sh.arguments = ["-c", script]
                try sh.run()
                self.updState("progress", "Restarting…")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { NSApp.terminate(nil) }
            } catch {
                self.updState("error", "Update failed")
            }
        }.resume()
    }
    // ⌘Z / ⇧⌘Z: undo / redo the app edits (the active text field keeps its own undo)
    @objc func vkUndo() { web.evaluateJavaScript("(document.activeElement && document.activeElement.matches('input,textarea')) ? (document.execCommand('undo'), 0) : (window.__vektor && window.__vektor.undo(), 1)") }
    @objc func vkRedo() { web.evaluateJavaScript("(document.activeElement && document.activeElement.matches('input,textarea')) ? (document.execCommand('redo'), 0) : (window.__vektor && window.__vektor.redo(), 1)") }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
