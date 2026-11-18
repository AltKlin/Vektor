// Self-test: Vektor --selftest image.png output.png → loads the image, waits for the result, captures the window, quits.
import Cocoa
import WebKit

extension AppDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let a = CommandLine.arguments
        guard let i = a.firstIndex(of: "--selftest"), a.count > i + 2 else { return }
        let src = a[i + 1], out = a[i + 2]
        guard let data = FileManager.default.contents(atPath: src) else { finish(out, "image not found"); return }
        let js = "window.__vektor.loadBlob(new Blob([Uint8Array.from(atob('\(data.base64EncodedString())'),c=>c.charCodeAt(0))],{type:'image/png'}),'selftest.png');'ok'"
        webView.evaluateJavaScript(js) { _, err in
            if let err = err { self.finish(out, "inject: \(err)"); return }
            self.poll(out, tries: 0)
        }
    }
    func poll(_ out: String, tries: Int) {
        web.evaluateJavaScript("(window.__vektor.st.result ? 'Done ' : '') + document.querySelector('#status').textContent + ' || ' + document.querySelector('#facts').innerText.replace(/\\n/g,' ') + ' || ' + document.querySelector('#sTrace').textContent") { r, _ in
            let s = (r as? String) ?? "?"
            if s.hasPrefix("Done") || tries > 120 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                    self.web.takeSnapshot(with: nil) { img, _ in
                        if let img = img, let t = img.tiffRepresentation, let b = NSBitmapImageRep(data: t), let png = b.representation(using: .png, properties: [:]) {
                            try? png.write(to: URL(fileURLWithPath: out))
                        }
                        self.finish(out, s)
                    }
                }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.poll(out, tries: tries + 1) }
            }
        }
    }
    func finish(_ out: String, _ msg: String) {
        try? msg.write(toFile: out + ".txt", atomically: true, encoding: .utf8)
        NSApp.terminate(nil)
    }
}
