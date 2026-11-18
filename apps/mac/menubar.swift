// Sim Studio: macOS menu bar icon (NSStatusItem), AppKit only, no dependencies.
// make_app.sh compiles this into "Sim Studio.app". Double-click = start the studio server if it is not running,
// open it in the browser, and show the icon. One instance only: a second launch just opens the browser.
// The icon polls GET /api/status about every 5 s (127.0.0.1 only; nothing is sent anywhere else).
// "Keluar" only closes the icon: the server and any running render stay alive.
// "Mulai otomatis saat login" is OFF by default and only turns on when the user ticks it in the menu.
import AppKit
import ServiceManagement

let address = ProcessInfo.processInfo.environment["SIM_MENU_ADDRESS"] ?? "http://127.0.0.1:5180" // override: tests only (a stand-in server)
let bundleId = "local.sim-studio"
let loginAgentLabel = "local.sim-studio.menu"
let logFile = NSString(string: "~/Library/Logs/Sim Studio.log").expandingTildeInPath

// ---- project location + PATH, written by make_app.sh into Resources/location.txt (an app opened from Finder has no PATH) ----
struct Location { var root = ""; var path = "" }
func readLocation() -> Location {
    var l = Location()
    guard let u = Bundle.main.url(forResource: "location", withExtension: "txt"), let t = try? String(contentsOf: u, encoding: .utf8) else { return l }
    for line in t.split(separator: "\n", omittingEmptySubsequences: true) {
        if line.hasPrefix("ROOT=") { l.root = String(line.dropFirst(5)) }
        if line.hasPrefix("PATH=") { l.path = String(line.dropFirst(5)) }
    }
    return l
}
let location = readLocation()

func problem(_ text: String) {
    // also in the log, so a message is never lost if the dialog is missed
    if let h = FileHandle(forWritingAtPath: logFile) ?? { FileManager.default.createFile(atPath: logFile, contents: nil); return FileHandle(forWritingAtPath: logFile) }() {
        h.seekToEndOfFile(); h.write(("[\(Date())] Sim Studio: \(text)\n").data(using: .utf8) ?? Data()); try? h.close()
    }
    NSApp.activate(ignoringOtherApps: true)
    let a = NSAlert(); a.messageText = "Sim Studio"; a.informativeText = text; a.alertStyle = .warning; a.addButton(withTitle: "OK"); a.runModal()
}

// ---- network: everything to 127.0.0.1, silent on failure ----
let session: URLSession = {
    let c = URLSessionConfiguration.ephemeral; c.timeoutIntervalForRequest = 2; c.timeoutIntervalForResource = 3
    c.requestCachePolicy = .reloadIgnoringLocalCacheData; c.connectionProxyDictionary = [:]   // never through a proxy
    return URLSession(configuration: c)
}()
func fetch(_ path: String, _ done: @escaping (Int?, Data?) -> Void) {
    guard let url = URL(string: address + path) else { return done(nil, nil) }
    session.dataTask(with: url) { d, r, e in done(e == nil ? (r as? HTTPURLResponse)?.statusCode : nil, d) }.resume()
}
/// Is the Sim Studio server answering? (its status endpoint names itself, so another program on the port does not count)
func serverUp(_ done: @escaping (Bool) -> Void) {
    fetch("/api/status") { code, d in
        let j = d.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        done(code == 200 && (j?["app"] as? String) == "sim-studio")
    }
}
func openURL(_ path: String = "") { if let u = URL(string: address + path) { NSWorkspace.shared.open(u) } }

/// Start the server if it is not running (nohup, so it outlives the icon), then call done(up).
func startServer(_ done: @escaping (Bool) -> Void) {
    serverUp { up in
        if up { return DispatchQueue.main.async { done(true) } }
        DispatchQueue.global().async {
            guard FileManager.default.fileExists(atPath: location.root + "/apps/server/server.ts") else {
                return DispatchQueue.main.async {
                    problem("Folder proyek tidak ditemukan di \(location.root.isEmpty ? "(belum dicatat)" : location.root). Kalau foldernya dipindah, jalankan lagi apps/mac/make_app.sh.")
                    done(false)
                }
            }
            let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/bash")
            // exit 9 = no node, exit 8 = node older than 23.6 (the server runs TypeScript directly)
            p.arguments = ["-c", """
                cd "$ROOT" || exit 7
                command -v node >/dev/null || exit 9
                node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>23||(a===23&&b>=6)?0:1)' || exit 8
                [ -d node_modules ] || npm install --no-audit --no-fund >>"$LOG" 2>&1
                nohup node apps/server/server.ts >>"$LOG" 2>&1 &
                """]
            var env = ProcessInfo.processInfo.environment; env["ROOT"] = location.root; env["LOG"] = logFile
            if !location.path.isEmpty { env["PATH"] = location.path }
            p.environment = env
            try? p.run(); p.waitUntilExit()
            if p.terminationStatus == 9 { return DispatchQueue.main.async { problem("Node.js tidak ditemukan. Pasang Node.js 23.6 atau lebih baru, lalu jalankan apps/mac/make_app.sh dan buka lagi."); done(false) } }
            if p.terminationStatus == 8 { return DispatchQueue.main.async { problem("Versi Node.js terlalu lama: studio butuh 23.6 atau lebih baru."); done(false) } }
            if p.terminationStatus != 0 { return DispatchQueue.main.async { problem("Studio tidak bisa dijalankan (kode \(p.terminationStatus)). Lihat ~/Library/Logs/Sim Studio.log"); done(false) } }
            var ok = false
            for _ in 0..<100 { let s = DispatchSemaphore(value: 0); var h = false; serverUp { h = $0; s.signal() }; s.wait(); if h { ok = true; break }; Thread.sleep(forTimeInterval: 0.2) }
            DispatchQueue.main.async { if !ok { problem("Studio tidak mau menyala. Lihat catatannya di ~/Library/Logs/Sim Studio.log") }; done(ok) }
        }
    }
}

// ---- icon: drawn in code, one colour, template image (follows light/dark menu bar) ----
enum Mode { case off, idle, working, attention }
func drawIcon(_ m: Mode) -> NSImage {
    let side: CGFloat = 18
    let img = NSImage(size: NSSize(width: side, height: side), flipped: false) { _ in
        let a: CGFloat = m == .off ? 0.38 : 1
        NSColor.black.withAlphaComponent(a).setFill(); NSColor.black.withAlphaComponent(a).setStroke()
        // the mark: an octagon (the container) with a ball inside
        let c = NSPoint(x: 9, y: 9), r: CGFloat = 7.2, o = NSBezierPath()
        for k in 0..<8 { let ang = CGFloat.pi / 8 + CGFloat(k) * .pi / 4, p = NSPoint(x: c.x + r * cos(ang), y: c.y + r * sin(ang)); k == 0 ? o.move(to: p) : o.line(to: p) }
        o.close(); o.lineWidth = 1.7; o.lineJoinStyle = .round; o.stroke()
        NSBezierPath(ovalIn: NSRect(x: c.x - 2.4, y: c.y - 2.4, width: 4.8, height: 4.8)).fill()
        // state marker, top right: different SHAPES, not just colour
        if m == .working { NSBezierPath(ovalIn: NSRect(x: 15.4 - 2.4, y: 15.4 - 2.4, width: 4.8, height: 4.8)).fill() }
        if m == .attention {
            let d = NSBezierPath(), q = NSPoint(x: 15.2, y: 15.2), s: CGFloat = 3.2
            d.move(to: NSPoint(x: q.x, y: q.y + s)); d.line(to: NSPoint(x: q.x + s, y: q.y)); d.line(to: NSPoint(x: q.x, y: q.y - s)); d.line(to: NSPoint(x: q.x - s, y: q.y)); d.close(); d.fill()
        }
        return true
    }
    img.isTemplate = true
    return img
}

/// a check mark in the same style, shown briefly after "Salin tautan Studio"
func drawCheck() -> NSImage {
    let img = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
        NSColor.black.setStroke()
        let p = NSBezierPath(); p.move(to: NSPoint(x: 3.5, y: 9.5)); p.line(to: NSPoint(x: 7.5, y: 5.5)); p.line(to: NSPoint(x: 14.5, y: 13))
        p.lineWidth = 2.2; p.lineCapStyle = .round; p.lineJoinStyle = .round; p.stroke()
        return true
    }
    img.isTemplate = true
    return img
}

// ---- start at login: SMAppService; if that is not possible, a LaunchAgent; only when the user ticks it ----
let launchAgentFile = NSString(string: "~/Library/LaunchAgents/\(loginAgentLabel).plist").expandingTildeInPath
func loginOn() -> Bool { SMAppService.mainApp.status == .enabled || FileManager.default.fileExists(atPath: launchAgentFile) }
func setLogin(_ on: Bool) -> String? {
    if on {
        do { try SMAppService.mainApp.register(); return nil } catch {
            guard let exe = Bundle.main.executablePath else { return "Tidak bisa menemukan lokasi aplikasi." }
            let plist: [String: Any] = ["Label": loginAgentLabel, "ProgramArguments": [exe, "--login"], "RunAtLoad": true, "ProcessType": "Interactive"]
            do {
                try FileManager.default.createDirectory(atPath: (launchAgentFile as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
                try (plist as NSDictionary).write(to: URL(fileURLWithPath: launchAgentFile)); return nil
            } catch { return "Tidak bisa mengaktifkan mulai otomatis: \(error.localizedDescription)" }
        }
    }
    var err: String? = nil
    if SMAppService.mainApp.status == .enabled || SMAppService.mainApp.status == .requiresApproval { do { try SMAppService.mainApp.unregister() } catch { err = error.localizedDescription } }
    if FileManager.default.fileExists(atPath: launchAgentFile) { do { try FileManager.default.removeItem(atPath: launchAgentFile) } catch { err = error.localizedDescription } }
    return err
}

// ---- the app ----
final class App: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    let menu = NSMenu()
    var mode = Mode.off
    var line1 = "Studio belum menyala", line2 = ""
    var timer: Timer?

    func applicationDidFinishLaunching(_ n: Notification) {
        NSApp.setActivationPolicy(.accessory)
        // one instance: a second launch only opens the browser (and starts the server if needed)
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
        if !others.isEmpty { startServer { ok in if ok { openURL() }; NSApp.terminate(nil) }; return }
        item.button?.image = drawIcon(.off); item.button?.toolTip = "Sim Studio"
        menu.delegate = self; item.menu = menu
        writeMenu()
        // opened at login: only start the server, do not open the browser
        let ev = NSAppleEventManager.shared().currentAppleEvent
        let fromLogin = CommandLine.arguments.contains("--login") || ev?.paramDescriptor(forKeyword: AEKeyword(keyAEPropData))?.enumCodeValue == OSType(keyAELaunchedAsLogInItem)
        startServer { ok in if ok && !fromLogin { openURL() }; self.refresh() }
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refresh() }
        timer?.tolerance = 1
        // tests only (SIM_MENU_OPEN=<seconds>): open the menu by itself and close it again, so it can be photographed
        if let t = ProcessInfo.processInfo.environment["SIM_MENU_OPEN"].flatMap(Double.init) {
            DispatchQueue.main.asyncAfter(deadline: .now() + t) { self.item.button?.performClick(nil) }
            DispatchQueue.main.asyncAfter(deadline: .now() + t + 8) { self.menu.cancelTracking() }
        }
        // tests only (SIM_MENU_COPY=<seconds>): trigger "Salin tautan Studio" by itself (clicking needs assistive access)
        if let t = ProcessInfo.processInfo.environment["SIM_MENU_COPY"].flatMap(Double.init) {
            DispatchQueue.main.asyncAfter(deadline: .now() + t) { self.copyLink() }
        }
    }
    /// double-clicking the .app while it runs: open the browser
    func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows: Bool) -> Bool { startServer { if $0 { openURL() } }; return false }

    func refresh() { fetch("/api/status") { code, d in DispatchQueue.main.async { self.apply(code, d); self.show() } } }
    func apply(_ code: Int?, _ d: Data?) {
        guard code != nil else { mode = .off; line1 = "Studio belum menyala"; line2 = ""; return }
        guard code == 200, let d = d, let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any], (j["app"] as? String) == "sim-studio" else {
            mode = .attention; line1 = "Port 5180 dipakai program lain"; line2 = ""; return
        }
        read(j)
    }
    func read(_ j: [String: Any]) {
        let queued = j["queued"] as? Int ?? 0, errors = j["errors"] as? Int ?? 0
        let readOnly = j["readOnly"] as? Bool ?? false
        line2 = readOnly ? "Mode baca-saja: studio lain memegang folder data" : ""
        if let r = j["running"] as? [String: Any] {
            line1 = "Sedang render: \(r["sceneId"] as? String ?? "") \(r["percent"] as? Int ?? 0)%" + (queued > 0 ? " · +\(queued) antre" : "")
            mode = .working; return
        }
        if queued > 0 { line1 = "Antre: \(queued) render"; mode = .working; return }
        if let l = j["last"] as? [String: Any], let ago = l["secondsAgo"] as? Int, ago < 600 {
            let when = ago < 60 ? "baru saja" : "\(ago / 60) mnt lalu"
            let ok = l["ok"] as? Bool ?? true
            line1 = ok ? "Selesai: \(l["sceneId"] as? String ?? "") (\(when))" : "Render gagal: \(l["sceneId"] as? String ?? "") (\(when))"
            mode = ok ? .idle : .attention; return
        }
        line1 = "Siap"; mode = .idle; _ = errors
    }
    var copiedUntil = Date.distantPast
    func show() {
        let copied = Date() < copiedUntil
        item.button?.image = copied ? drawCheck() : drawIcon(mode)
        item.button?.toolTip = copied ? "Tautan Studio disalin" : "Sim Studio · \(line1)"
        writeMenu()
    }
    /// copies the Studio address as plain text; works with the server off. The menu closes on click, so the sign is the
    /// menu bar icon itself turning into a check mark for ~1.5 s (plus the tooltip), visible without any notification.
    @objc func copyLink() {
        let pb = NSPasteboard.general; pb.clearContents(); pb.setString(address, forType: .string)
        copiedUntil = Date().addingTimeInterval(1.5); show()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { self.show() }
    }

    func writeMenu() {
        menu.removeAllItems()
        func info(_ t: String) { let m = NSMenuItem(title: t, action: nil, keyEquivalent: ""); m.isEnabled = false; menu.addItem(m) }
        func act(_ t: String, _ s: Selector) { let m = NSMenuItem(title: t, action: s, keyEquivalent: ""); m.target = self; menu.addItem(m) }
        info(line1); if !line2.isEmpty { info(line2) }
        menu.addItem(.separator())
        act("Buka Studio", #selector(openStudio)); act("Salin tautan Studio", #selector(copyLink)); act("Buka Videos", #selector(openVideos))
        act("Buka folder output", #selector(openOutput)); act("Buka log", #selector(openLog))
        menu.addItem(.separator())
        let login = NSMenuItem(title: "Mulai otomatis saat login", action: #selector(toggleLogin), keyEquivalent: ""); login.target = self; login.state = loginOn() ? .on : .off; menu.addItem(login)
        menu.addItem(.separator())
        act("Keluar", #selector(quitIcon))
    }
    /// opening the menu shows fresh numbers: one quick local request (at most 0.7 s), then the lines are rewritten
    func menuNeedsUpdate(_ m: NSMenu) {
        let sem = DispatchSemaphore(value: 0); var got: (Int?, Data?) = (nil, nil)
        fetch("/api/status") { c, d in got = (c, d); sem.signal() }
        if sem.wait(timeout: .now() + 0.7) == .success { apply(got.0, got.1) }
        writeMenu()
    }
    @objc func openStudio() { startServer { if $0 { openURL() }; self.refresh() } }
    @objc func openVideos() { startServer { if $0 { openURL("/#videos") }; self.refresh() } }
    @objc func openOutput() {
        let dir = location.root + "/output"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        NSWorkspace.shared.open(URL(fileURLWithPath: dir))
    }
    @objc func openLog() {
        if !FileManager.default.fileExists(atPath: logFile) { FileManager.default.createFile(atPath: logFile, contents: Data()) }
        NSWorkspace.shared.open(URL(fileURLWithPath: logFile))
    }
    @objc func toggleLogin() { if let g = setLogin(!loginOn()) { problem(g) }; writeMenu() }
    @objc func quitIcon() { NSApp.terminate(nil) } // only the icon: the server and renders are not touched
}

let appDelegate = App()
NSApplication.shared.delegate = appDelegate
NSApplication.shared.run()
