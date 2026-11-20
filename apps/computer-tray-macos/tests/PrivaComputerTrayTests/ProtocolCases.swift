import Foundation
#if canImport(PrivaComputerTray)
@testable import PrivaComputerTray
#endif

enum ProtocolCases {
    static func runtimeStatus() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try files.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? files.removeItem(at: root) }
        try Data(#"{"target":"darwin-arm64","node_version":"1.2.3-fixture"}"#.utf8)
            .write(to: root.appendingPathComponent("manifest.json"))
        try requireError { _ = try RuntimeVersions.read(at: root) }
        for (package, version) in [("cua-repl", "1"), ("cua", "2"), ("sky", "3")] {
            let directory = root.appendingPathComponent("lib/node_modules/@oai").appendingPathComponent(package)
            try files.createDirectory(at: directory, withIntermediateDirectories: true)
            try JSONEncoder().encode(["version": version]).write(to: directory.appendingPathComponent("package.json"))
        }
        let versions = try RuntimeVersions.read(at: root)
        try require(versions == RuntimeVersions(target: "darwin-arm64", node: "1.2.3-fixture",
                                                cuaRepl: "1", cua: "2", sky: "3"), "runtime package metadata")
    }

    static func require(_ condition: Bool, _ message: String) throws {
        if !condition { throw TrayError("Test assertion failed: \(message)") }
    }

    static func requireError(_ action: () throws -> Void) throws {
        do { try action() }
        catch { return }
        throw TrayError("Expected an error.")
    }

    static func optionsAndFrames() throws {
        let settings = try ConnectionSettings(host: "device@dev-host", port: "2222")
        try require(settings.arguments.suffix(3) == ["--", "device@dev-host", "priva-computer"], "fixed subsystem")
        for option in ["StrictHostKeyChecking=yes", "BatchMode=yes", "ClearAllForwardings=yes", "-s", "-T"] {
            try require(settings.arguments.contains(option), option)
        }
        for host in ["-oProxyCommand=x", "x y", "", "a@b@c", "root@-bad"] {
            try requireError { _ = try ConnectionSettings(host: host) }
        }
        try requireError { _ = try ConnectionSettings(host: "device", port: "0") }
        let request = Data(#"{"type":"request","id":"1","method":"open"}"#.utf8)
        try require(try IncomingMessage(line: request) == .request(id: "1", method: "open"), "decode")
        try requireError {
            _ = try IncomingMessage(line: Data(#"{"type":"request","id":"1","method":"open","code":"no"}"#.utf8))
        }
        try require(try IncomingMessage(line: Data(#"{"type":"close"}"#.utf8)) == .close, "close")
        try requireError { _ = try IncomingMessage(line: Data(#"{"type":"close","id":"1"}"#.utf8)) }
        // A worker message is passed on as it is, without being parsed here.
        try require(try IncomingMessage(line: Data(#"={"jsonrpc":"2.0","id":1}"#.utf8))
            == .worker(Data(#"{"jsonrpc":"2.0","id":1}"#.utf8)), "worker line")
        var buffer = LineBuffer()
        try require(try buffer.append(Data("ab".utf8)).isEmpty, "partial line")
        try require(try buffer.append(Data("c\nde\nf".utf8)) == [Data("abc".utf8), Data("de".utf8)], "lines across chunks")
        try require(try buffer.append(Data("\n".utf8)) == [Data("f".utf8)], "completed tail")
        let screenshot = Data(repeating: 120, count: 4 * 1024 * 1024)
        try require(try buffer.append(screenshot + Data([10])) == [screenshot], "screenshot-sized line")
        try requireError { _ = try buffer.append(Data(repeating: 1, count: LineBuffer.limit + 1)) }
    }

    static func explicitMenuConnection() throws {
        let flags = ["--connect", "--host", "device@fixture", "--port", "2222", "--ssh-config", "/tmp/fixture"]
        guard case let .connect(settings) = try LaunchMode(arguments: flags[...]) else {
            throw TrayError("Expected a GUI connection.")
        }
        try require(settings.host == "device@fixture" && settings.port == 2222 && settings.config?.path == "/tmp/fixture",
                    "GUI connection uses the supplied SSH settings")
        try requireError { _ = try LaunchMode(arguments: (flags + ["--launcher", "/tmp/launcher"])[...]) }
        try requireError { _ = try LaunchMode(arguments: ["--connect", "--host", "one", "--host", "two"][...]) }
        guard case let .smoke(_, launcher) = try LaunchMode(arguments: ["--smoke", "--host", "device@fixture", "--launcher", "/tmp/cua-repl.mjs"][...]),
              launcher.path == "/tmp/cua-repl.mjs" else { throw TrayError("Expected a headless connection.") }
        try requireError { _ = try LaunchMode(arguments: ["--smoke", "--host", "device@fixture", "--launcher", "relative.mjs"][...]) }
        guard case .menu = try LaunchMode(arguments: [String]()[...]) else { throw TrayError("Expected normal menu.") }
    }

    static func accessAndOutput() throws {
        let eligible = ["kCGSSessionOnConsoleKey": true, "kCGSessionLoginDoneKey": true]
        try require(ConsoleAccess.available(eligible), "eligible console")
        try require(!ConsoleAccess.available(nil), "unavailable session")
        try require(!ConsoleAccess.available(["kCGSessionLoginDoneKey": true]), "inactive console")
        try require(!ConsoleAccess.available(eligible.merging(["CGSSessionScreenIsLocked": true]) { _, new in new }), "locked")
        let malformed: [String: Any] = ["kCGSSessionOnConsoleKey": true, "kCGSessionLoginDoneKey": true,
                                        "CGSSessionScreenIsLocked": "unknown"]
        try require(!ConsoleAccess.available(malformed), "unknown lock value")
        let launch = WorkerLaunch.installed(launcher: URL(fileURLWithPath: "/app/cua-repl.mjs"), runtime: URL(fileURLWithPath: "/runtime"))
        try require(launch.executable.path == "/runtime/bin/node" && launch.arguments == ["/app/cua-repl.mjs", "/runtime"],
                    "the runtime's own Node runs the launcher with the runtime directory")
        let failure = WorkerFailure(exitCode: 1, stderr: Data("Error: Cannot find package '@oai/cua-repl' in /private/detail".utf8))
        try require(failure.remoteReason == "The Mac Computer Use runtime is missing or incompatible.", "runtime classification")
        try require(failure.localDetail.contains("/private/detail"), "detail stays local")
    }

    // Real pipe traffic with an isolated peer and a local stand-in worker, no GUI or SSH credentials.
    @MainActor static func connection(locked: Bool, lockDuringWork: Bool = false, failingWorker: Bool = false) async throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try fm.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? fm.removeItem(at: root) }
        func script(_ name: String, _ body: String) throws -> URL {
            let file = root.appendingPathComponent(name)
            try Data(("#!/bin/sh\nset -eu\n" + body).utf8).write(to: file)
            try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
            return file
        }
        let working = !locked && !lockDuringWork && !failingWorker
        // The Runner side: register, ask for status, open the worker, then exchange one worker message.
        var exchange = #"""
        cd "$(dirname "$0")"
        IFS= read -r hello
        printf '%s\n' "$hello" > hello
        printf '%s\n' '{"type":"ready","deviceId":"fixture"}' '{"type":"request","id":"s","method":"status"}'
        IFS= read -r status
        printf '%s\n' "$status" > status
        printf '%s\n' '{"type":"request","id":"o","method":"open"}'
        IFS= read -r opened
        printf '%s\n' "$opened" > opened

        """#
        if locked { exchange += "cp opened result\n" }
        else {
            exchange += "printf '%s\\n' '={\"probe\":1}'\nIFS= read -r next\nprintf '%s\\n' \"$next\" > result\n"
        }
        if working { exchange += "printf '%s\\n' '{\"type\":\"close\"}'\n/bin/sleep 0.2\n: > closed\n/bin/sleep 5\n" }
        let peer = try script("peer", exchange)
        var helper = "cd \"$(dirname \"$0\")\"\n: > launched\n"
        if failingWorker {
            helper += "echo 'Host authorization unavailable; local-only-marker' >&2\nexit 12\n"
        } else {
            // A descendant that outlives a stopped worker would leave `survived` behind.
            helper += "(/bin/sleep 1; : > survived) &\n"
            if working { helper += "IFS= read -r line\nprintf 'echo:%s\\n' \"$line\"\n" }
            helper += "wait\n"
        }
        let worker = try script("worker", helper)
        let connection = TrayConnection(unlocked: { !locked }, sshExecutable: peer)
        var localDetail: String?
        connection.localDiagnostic = { localDetail = $0 }
        defer { connection.stop() }
        try connection.connect(settings: ConnectionSettings(host: "device@fixture"),
                               launch: WorkerLaunch(executable: worker, arguments: []))
        let clock = ContinuousClock(), deadline = ContinuousClock.now.advanced(by: .seconds(6))
        let finished = root.appendingPathComponent(working ? "closed" : "result"), launchedURL = root.appendingPathComponent("launched")
        while !fm.fileExists(atPath: finished.path), clock.now < deadline {
            if lockDuringWork && fm.fileExists(atPath: launchedURL.path) { connection.setLocalSuspension(true) }
            try await Task.sleep(for: .milliseconds(10))
        }
        func text(_ name: String) throws -> String {
            String(decoding: try Data(contentsOf: root.appendingPathComponent(name)), as: UTF8.self)
                .trimmingCharacters(in: .newlines)
        }
        func frame(_ name: String) throws -> [String: Any] {
            guard let object = try JSONSerialization.jsonObject(with: Data(try text(name).utf8)) as? [String: Any] else {
                throw TrayError("Invalid fixture frame.")
            }
            return object
        }
        try require(try frame("hello")["type"] as? String == "hello" && frame("hello")["version"] as? Int == 2, "greeting")
        try require((try frame("status")["value"] as? [String: Any])?["unlocked"] as? Bool == !locked, "availability")
        try require(try frame("opened")["ok"] as? Bool == !locked, "worker start result")
        try require(fm.fileExists(atPath: launchedURL.path) == !locked, "actual worker invocation")
        if locked {
            try require(try frame("opened")["error"] as? String == "Unlock the active Mac console before using its desktop.", "locked reason")
        } else if working {
            // The Runner's message reached the worker, and the worker's reply came back, both unchanged.
            try require(try text("result") == #"=echo:{"probe":1}"#, "worker message round trip")
        } else {
            try require(try frame("result")["type"] as? String == "worker-exit", "worker end is reported")
            let reason = try frame("result")["reason"] as? String
            if lockDuringWork {
                try require(reason == "The Mac console locked or became unavailable.", "lock reason")
            } else {
                try require(reason == "Computer Use authorization is unavailable on the Mac.", "bounded wire classification")
                try require(localDetail?.contains("local-only-marker") == true, "local worker diagnostic")
            }
        }
        if !locked && !failingWorker {
            // Closing or locking stops the worker together with what it started.
            try await Task.sleep(for: .milliseconds(1300))
            try require(!fm.fileExists(atPath: root.appendingPathComponent("survived").path), "worker descendant stopped")
        }
    }
}
