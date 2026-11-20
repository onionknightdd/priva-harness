import AppKit
import Darwin
import Foundation

@MainActor
final class SessionObservers: NSObject {
    private let connection: TrayConnection

    init(connection: TrayConnection) {
        self.connection = connection
        super.init()
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(unavailable),
            name: Notification.Name("com.apple.screenIsLocked"), object: nil)
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(recheck),
            name: Notification.Name("com.apple.screenIsUnlocked"), object: nil)
        for name in [NSWorkspace.sessionDidBecomeActiveNotification, NSWorkspace.didWakeNotification,
                     NSWorkspace.screensDidWakeNotification] {
            NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(recheck), name: name, object: nil)
        }
        for name in [NSWorkspace.sessionDidResignActiveNotification, NSWorkspace.willSleepNotification,
                     NSWorkspace.screensDidSleepNotification] {
            NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(unavailable), name: name, object: nil)
        }
    }

    @objc private func unavailable() { connection.setLocalSuspension(true) }
    @objc private func recheck() { connection.setLocalSuspension(false) }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let connection = TrayConnection()
    private let initialConnection: ConnectionSettings?
    private var launchFailure: String?
    private var observers: SessionObservers?
    private var statusItem: NSStatusItem?
    private var lastHost = UserDefaults.standard.string(forKey: "sshAlias") ?? "device@priva-runner"
    private var lastDiagnostic: String?
    private var lastConfig = UserDefaults.standard.string(forKey: "sshConfigPath") ?? ""
    private var lastPort = UserDefaults.standard.string(forKey: "sshPort") ?? ""

    init(initialConnection: ConnectionSettings?) {
        self.initialConnection = initialConnection
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        observers = SessionObservers(connection: connection)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        connection.stateChanged = { [weak self] _ in self?.updateMenu() }
        connection.localDiagnostic = { [weak self] detail in
            self?.lastDiagnostic = detail
            self?.updateMenu()
        }
        updateMenu()
        if let initialConnection {
            do { try startConnection(initialConnection) }
            catch { launchFailure = error.localizedDescription; updateMenu() }
        }
    }

    func applicationWillTerminate(_ notification: Notification) { connection.stop() }

    private func updateMenu() {
        guard let item = statusItem else { return }
        let menu = NSMenu()
        let status: String
        switch connection.state {
        case let .idle(message): status = launchFailure ?? message; item.button?.title = "Priva"
        case let .connecting(host): status = "Connecting to \(host)"; item.button?.title = "Priva · Connecting"
        case let .active(host, _, unlocked):
            status = unlocked ? "Connected to \(host)" : "Connected to \(host) · Desktop unavailable"
            item.button?.title = unlocked ? "Priva · Active" : "Priva · Paused"
        }
        menu.addItem(withTitle: status, action: nil, keyEquivalent: "")
        menu.addItem(withTitle: "Shared: applications on this Mac", action: nil, keyEquivalent: "")
        if lastDiagnostic != nil {
            menu.addItem(withTitle: "Last desktop worker error…", action: #selector(showDiagnostic), keyEquivalent: "").target = self
        }
        menu.addItem(.separator())
        let toggle = menu.addItem(withTitle: connection.state.connected ? "Disconnect" : "Connect…",
                                  action: #selector(toggleConnection), keyEquivalent: "")
        toggle.target = self
        let quit = menu.addItem(withTitle: "Quit Priva Computer", action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        item.menu = menu
        item.button?.toolTip = status
    }

    @objc private func showDiagnostic() {
        guard let lastDiagnostic else { return }
        let alert = NSAlert()
        alert.messageText = "Desktop worker"
        alert.informativeText = lastDiagnostic
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    @objc private func quitApp() { connection.stop(); NSApp.terminate(nil) }
    @objc private func toggleConnection() {
        if connection.state.connected { connection.stop(); return }
        let alert = NSAlert()
        alert.messageText = "Connect this Mac"
        alert.informativeText = "Until you disconnect, sessions in the workspace can read and operate applications on this Mac without asking you first. Desktop access stops when this Mac locks."
        let host = NSTextField(string: lastHost), port = NSTextField(string: lastPort)
        let config = NSTextField(string: lastConfig)
        config.placeholderString = "~/.ssh/config"
        host.placeholderString = "SSH host or user@alias"
        port.placeholderString = "Port from SSH config"
        let fields = NSStackView(views: [NSTextField(labelWithString: "SSH destination"), host,
                                         NSTextField(labelWithString: "Optional SSH port"), port,
                                         NSTextField(labelWithString: "Optional SSH config file"), config])
        fields.orientation = .vertical
        fields.alignment = .leading
        fields.frame = NSRect(x: 0, y: 0, width: 340, height: 155)
        for field in [host, port, config] { field.widthAnchor.constraint(equalToConstant: 340).isActive = true }
        alert.accessoryView = fields
        alert.addButton(withTitle: "Connect")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        alert.window.initialFirstResponder = host
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do {
            let path = (config.stringValue as NSString).expandingTildeInPath
            guard path.isEmpty || (path.hasPrefix("/") && FileManager.default.isReadableFile(atPath: path)) else {
                throw TrayError("Enter an existing, readable SSH config file, or leave it empty.")
            }
            let settings = try ConnectionSettings(host: host.stringValue, port: port.stringValue,
                                                  config: path.isEmpty ? nil : URL(fileURLWithPath: path))
            try startConnection(settings)
            lastHost = host.stringValue
            lastPort = port.stringValue
            lastConfig = config.stringValue
            UserDefaults.standard.set(lastConfig, forKey: "sshConfigPath")
            UserDefaults.standard.set(lastHost, forKey: "sshAlias")
            UserDefaults.standard.set(lastPort, forKey: "sshPort")
        } catch {
            NSAlert(error: error).runModal()
        }
    }
    private func startConnection(_ settings: ConnectionSettings) throws {
        guard let launcher = Bundle.main.url(forResource: "cua-repl", withExtension: "mjs") else {
            throw TrayError("Build this app with its desktop worker launcher.")
        }
        lastDiagnostic = nil
        launchFailure = nil
        try connection.connect(settings: settings, launch: .installed(launcher: launcher))
    }

}

@main
enum PrivaComputerTray {
    @MainActor static func main() {
        _ = signal(SIGPIPE, SIG_IGN)
        do {
            switch try LaunchMode(arguments: CommandLine.arguments.dropFirst()) {
            case .menu: runMenu(initialConnection: nil)
            case let .connect(settings): runMenu(initialConnection: settings)
            case let .smoke(settings, launcher): try runSmoke(settings: settings, launcher: launcher)
            }
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }

    @MainActor private static func runMenu(initialConnection: ConnectionSettings?) {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let delegate = AppDelegate(initialConnection: initialConnection)
        app.delegate = delegate
        let signals = onTermination { app.terminate(nil) }
        withExtendedLifetime((delegate, signals)) { app.run() }
    }

    @MainActor private static func runSmoke(settings: ConnectionSettings, launcher: URL) throws {
        let connection = TrayConnection()
        let observers = SessionObservers(connection: connection)
        connection.localDiagnostic = { detail in FileHandle.standardError.write(Data("\(detail)\n".utf8)) }
        connection.stateChanged = { state in
            switch state {
            case let .idle(reason): FileHandle.standardError.write(Data("\(reason)\n".utf8)); exit(1)
            case .active: FileHandle.standardError.write(Data("Device registered\n".utf8))
            case .connecting: break
            }
        }
        try connection.connect(settings: settings, launch: .installed(launcher: launcher), name: "Priva Mac smoke")
        let signals = onTermination { connection.stateChanged = nil; connection.stop(); exit(0) }
        withExtendedLifetime((connection, observers, signals)) { RunLoop.main.run() }
    }

    @MainActor private static func onTermination(_ handler: @escaping @MainActor () -> Void) -> [DispatchSourceSignal] {
        [SIGINT, SIGTERM].map { number in
            _ = signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { MainActor.assumeIsolated { handler() } }
            source.resume()
            return source
        }
    }
}
