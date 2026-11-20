import Foundation

struct TrayError: LocalizedError, Equatable {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

struct ConnectionSettings {
    let host: String
    let port: UInt16?
    let config: URL?

    init(host: String, port: String = "", config: URL? = nil) throws {
        // Accept OpenSSH aliases and an optional username, never an option or shell expression.
        let parts = host.split(separator: "@", omittingEmptySubsequences: false)
        guard (1...2).contains(parts.count), host.utf8.count <= 253,
              parts.allSatisfy({ part in
                  guard let first = part.utf8.first, Self.isAlphanumeric(first) else { return false }
                  return part.utf8.allSatisfy { Self.isAlphanumeric($0) || [45, 46, 95].contains($0) }
              }) else { throw TrayError("Enter an SSH host alias or user@host.") }
        if port.isEmpty { self.port = nil }
        else if let value = UInt16(port), value > 0 { self.port = value }
        else { throw TrayError("Enter a port between 1 and 65535.") }
        self.host = host
        self.config = config
    }

    private static func isAlphanumeric(_ byte: UInt8) -> Bool {
        (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte)
    }

    var arguments: [String] {
        var args = ["-T", "-s", "-o", "StrictHostKeyChecking=yes", "-o", "UpdateHostKeys=no", "-o", "BatchMode=yes",
                    "-o", "ClearAllForwardings=yes", "-o", "ForwardAgent=no", "-o", "ForwardX11=no",
                    "-o", "PermitLocalCommand=no", "-o", "ControlMaster=no", "-o", "ControlPath=none",
                    "-o", "RemoteCommand=none", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15",
                    "-o", "ServerAliveCountMax=2"]
        if let config { args += ["-F", config.path] }
        if let port { args += ["-p", String(port)] }
        return args + ["--", host, "priva-computer"]
    }
}

enum LaunchMode {
    case menu
    case connect(ConnectionSettings)
    case smoke(ConnectionSettings, launcher: URL)

    init(arguments: ArraySlice<String>) throws {
        guard let mode = arguments.first, !mode.hasPrefix("-psn_") else { self = .menu; return }
        guard mode == "--connect" || mode == "--smoke" else { throw TrayError("Expected --connect or --smoke.") }
        var values: [String: String] = [:]
        var iterator = arguments.dropFirst().makeIterator()
        while let flag = iterator.next() {
            let supported = ["--host", "--port", "--ssh-config"].contains(flag)
                || (mode == "--smoke" && flag == "--launcher")
            guard supported, values[flag] == nil, let value = iterator.next() else {
                throw TrayError("Invalid or duplicate connection option.")
            }
            values[flag] = value
        }
        guard let host = values["--host"] else { throw TrayError("Specify --host with an SSH destination.") }
        let config = try values["--ssh-config"].map { value in
            guard value.hasPrefix("/") else { throw TrayError("SSH config must be an absolute path.") }
            return URL(fileURLWithPath: value)
        }
        let settings = try ConnectionSettings(host: host, port: values["--port"] ?? "", config: config)
        if mode == "--connect" { self = .connect(settings); return }
        guard let launcher = values["--launcher"], launcher.hasPrefix("/") else {
            throw TrayError("--smoke requires an absolute --launcher path.")
        }
        self = .smoke(settings, launcher: URL(fileURLWithPath: launcher))
    }
}

/// One line from the Runner. A line starting with "=" is a message for the desktop worker;
/// every other line is a JSON control message.
enum IncomingMessage: Equatable {
    case ready(deviceID: String)
    case request(id: String, method: String)
    case worker(Data)
    case close

    init(line: Data) throws {
        if line.first == 61 { self = .worker(Data(line.dropFirst())); return }
        guard let object = try JSONSerialization.jsonObject(with: line) as? [String: Any],
              let type = object["type"] as? String else { throw TrayError("Invalid protocol message.") }
        switch type {
        case "ready":
            guard let id = object["deviceId"] as? String, Self.validID(id) else {
                throw TrayError("Invalid device registration.")
            }
            self = .ready(deviceID: id)
        case "request":
            guard let id = object["id"] as? String, Self.validID(id),
                  let method = object["method"] as? String, method.utf8.count <= 64,
                  object.keys.allSatisfy({ ["type", "id", "method"].contains($0) }) else {
                throw TrayError("Invalid device request.")
            }
            self = .request(id: id, method: method)
        case "close":
            guard object.count == 1 else { throw TrayError("Invalid close message.") }
            self = .close
        default: throw TrayError("Unknown protocol message.")
        }
    }

    private static func validID(_ id: String) -> Bool {
        !id.isEmpty && id.utf8.count <= 128 && id.utf8.allSatisfy { (33...126).contains($0) }
    }
}

/// Splits a byte stream into lines. Worker messages carry screenshots, so a line can be large.
struct LineBuffer {
    private var data = Data()
    static let limit = 32 * 1024 * 1024

    /// The complete lines in `chunk`, in order. An unfinished tail stays for the next chunk.
    mutating func append(_ chunk: Data) throws -> [Data] {
        var lines: [Data] = []
        var start = chunk.startIndex
        while let newline = chunk[start...].firstIndex(of: 10) {
            data.append(chunk[start..<newline])
            guard data.count <= Self.limit else { throw TrayError("Incoming message is too large.") }
            lines.append(data)
            data = Data()
            start = chunk.index(after: newline)
        }
        data.append(chunk[start...])
        guard data.count <= Self.limit else { throw TrayError("Incoming message is too large.") }
        return lines
    }
}

struct Greeting: Encodable {
    let type = "hello", version = 2, platform = "darwin"
    let name: String
}

struct DeviceStatus: Encodable {
    let platform = "darwin"
    let unlocked: Bool
    let runtime: RuntimeVersions?
}

struct RuntimeVersions: Encodable, Equatable {
    let target: String
    let node: String
    let cuaRepl: String
    let cua: String
    let sky: String

    static let installedRoot = URL(fileURLWithPath: "/Applications/ChatGPT.app/Contents/Resources/cua_node")

    static func read(at root: URL = installedRoot) throws -> Self {
        struct Archive: Decodable {
            let target: String
            let nodeVersion: String
        }
        struct Package: Decodable { let version: String }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let manifest = try decoder.decode(Archive.self, from: Data(contentsOf: root.appendingPathComponent("manifest.json")))
        let packages = root.appendingPathComponent("lib/node_modules/@oai")
        func version(of package: String) throws -> String {
            let url = packages.appendingPathComponent(package).appendingPathComponent("package.json")
            return try decoder.decode(Package.self, from: Data(contentsOf: url)).version
        }
        return try Self(target: manifest.target, node: manifest.nodeVersion, cuaRepl: version(of: "cua-repl"),
                        cua: version(of: "cua"), sky: version(of: "sky"))
    }
}

struct Success<Value: Encodable>: Encodable {
    let type = "result", ok = true
    let id: String
    let value: Value
}

struct Failure: Encodable {
    let type = "result", ok = false
    let id: String
    let error: String
}

/// The reply to a request that returns nothing.
struct Done: Encodable {}

/// Tells the Runner that the desktop worker ended and why.
struct WorkerExit: Encodable {
    let type = "worker-exit"
    let reason: String
}

/// How this Mac starts its desktop worker: the runtime's Node runs the launcher with the runtime directory.
struct WorkerLaunch {
    let executable: URL
    let arguments: [String]

    static func installed(launcher: URL, runtime: URL = RuntimeVersions.installedRoot) -> Self {
        Self(executable: runtime.appendingPathComponent("bin/node"), arguments: [launcher.path, runtime.path])
    }
}

/// Only fixed descriptions cross the SSH channel. Details stay in the tray or its local stderr.
struct WorkerFailure: LocalizedError {
    let remoteReason: String
    let localDetail: String
    var errorDescription: String? { localDetail }

    init(exitCode: Int32, stderr: Data) {
        let clean = String(decoding: stderr, as: UTF8.self).unicodeScalars.map {
            CharacterSet.controlCharacters.contains($0) || CharacterSet.illegalCharacters.contains($0) ? " " : String($0)
        }.joined()
        let detail = clean.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        let message = detail.lowercased()
        if ["permission", "authoriz", "approval", "access denied", "trusted host", "host identity"].contains(where: message.contains) {
            remoteReason = "Computer Use authorization is unavailable on the Mac."
        } else if ["enoent", "no such file", "cannot find module", "cannot find package", "usage: cua-repl"].contains(where: message.contains) {
            remoteReason = "The Mac Computer Use runtime is missing or incompatible."
        } else {
            remoteReason = "The Mac desktop worker stopped. Details are available locally in Priva Computer."
        }
        localDetail = "Desktop worker exited with status \(exitCode). " + (detail.isEmpty ? remoteReason : String(detail.prefix(1024)))
    }
}
