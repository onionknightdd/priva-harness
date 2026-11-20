import CoreGraphics
import Darwin
import Foundation

enum ConsoleAccess {
    static func available(_ values: [String: Any]?) -> Bool {
        guard let values, values["kCGSSessionOnConsoleKey"] as? Bool == true,
              values["kCGSessionLoginDoneKey"] as? Bool == true else { return false }
        // WindowServer omits the lock marker on an unlocked console session.
        guard let marker = values["CGSSessionScreenIsLocked"] else { return true }
        return marker as? Bool == false
    }

    static func current() -> Bool { available(CGSessionCopyCurrentDictionary() as? [String: Any]) }
}

// Dispatches finite reads on the main queue so a stalled SSH peer cannot block Stop or lock handling.
@MainActor
final class PipeReader {
    private let handle: FileHandle
    private let source: DispatchSourceRead

    init(_ handle: FileHandle, receive: @escaping @MainActor (Data?) -> Void) {
        self.handle = handle
        source = DispatchSource.makeReadSource(fileDescriptor: handle.fileDescriptor, queue: .main)
        source.setEventHandler { [weak self] in
            MainActor.assumeIsolated {
                guard let self, !self.source.isCancelled else { return }
                var buffer = [UInt8](repeating: 0, count: 64 * 1024)
                let size = Darwin.read(handle.fileDescriptor, &buffer, buffer.count)
                if size > 0 { receive(Data(buffer.prefix(size))) }
                else if size == 0 || errno != EINTR { self.close(); receive(nil) }
            }
        }
        source.setCancelHandler { try? handle.close() }
        source.resume()
    }

    func close() { source.cancel() }
}

@MainActor
func terminate(_ child: Process) {
    guard child.isRunning else { return }
    child.terminate()
    // A helper that ignores termination must not survive a local stop.
    Task {
        try? await Task.sleep(for: .milliseconds(350))
        if child.isRunning { _ = Darwin.kill(child.processIdentifier, SIGKILL) }
    }
}

/// Writes whole messages in order on its own queue. Worker output can be megabytes, and a slow
/// reader must not block the main actor, which still has to notice a lock or a local stop.
final class PipeWriter: @unchecked Sendable {
    private let handle: FileHandle
    private let queue = DispatchQueue(label: "dev.priva.computer-tray.pipe-writer")
    private var closed = false // Confined to `queue`.

    init(_ handle: FileHandle) { self.handle = handle }

    func write(_ data: Data, failed: @escaping @Sendable () -> Void) {
        queue.async { [self] in
            guard !closed else { return }
            let descriptor = handle.fileDescriptor
            var offset = 0
            while offset < data.count {
                let written = data.withUnsafeBytes { bytes in
                    Darwin.write(descriptor, bytes.baseAddress.map { $0 + offset }, data.count - offset)
                }
                if written > 0 { offset += written; continue }
                if written < 0 && errno == EINTR { continue }
                closed = true
                failed()
                return
            }
        }
    }

    /// Closes after the messages already queued. A reader that is gone fails those writes at once.
    func close() {
        queue.async { [self] in
            guard !closed else { return }
            closed = true
            try? handle.close()
        }
    }
}

/// The desktop worker of this Mac: the same process a local session starts, speaking MCP on its pipes.
@MainActor
final class WorkerProcess {
    private let child = Process()
    private var ownedProcessGroup: pid_t?
    private var reader: PipeReader?
    private var diagnosticsReader: PipeReader?
    private var diagnostics = Data()
    private var writer: PipeWriter?
    private var lines = LineBuffer()
    private var stopped = false
    private var ended: ((WorkerFailure) -> Void)?

    /// `line` receives each message the worker writes. `ended` runs once if the worker stops on its own.
    func start(_ launch: WorkerLaunch, line: @escaping (Data) -> Void, ended: @escaping (WorkerFailure) -> Void) throws {
        guard FileManager.default.isExecutableFile(atPath: launch.executable.path) else {
            throw TrayError("The Mac Computer Use runtime is missing or incompatible.")
        }
        let input = Pipe(), output = Pipe(), errors = Pipe()
        child.executableURL = launch.executable
        child.arguments = launch.arguments
        child.standardInput = input
        child.standardOutput = output
        child.standardError = errors
        child.terminationHandler = { [weak self] child in
            let status = child.terminationStatus
            Task { @MainActor in self?.finished(status: status) }
        }
        try child.run()
        let pid = child.processIdentifier
        if pid > 1, getpgid(pid) == pid, pid != getpgrp() {
            ownedProcessGroup = pid
        } else if child.isRunning {
            terminate(child)
            throw TrayError("Cannot isolate the desktop worker process group.")
        }
        self.ended = ended
        writer = PipeWriter(input.fileHandleForWriting)
        reader = PipeReader(output.fileHandleForReading) { [weak self] chunk in
            guard let self, let chunk, !stopped else { return }
            do { for message in try lines.append(chunk) { line(message) } }
            catch { fail(WorkerFailure(exitCode: -1, stderr: Data(error.localizedDescription.utf8))) }
        }
        diagnosticsReader = PipeReader(errors.fileHandleForReading) { [weak self] chunk in
            guard let self, let chunk else { return }
            diagnostics = Data((diagnostics + chunk).suffix(2048))
        }
    }

    func write(_ line: Data) {
        var message = line
        message.append(10)
        // A worker that stopped reading is reported through its termination, not through this write.
        writer?.write(message) {}
    }

    private func finished(status: Int32) {
        guard !stopped else { return }
        fail(WorkerFailure(exitCode: status, stderr: diagnostics))
    }

    private func fail(_ failure: WorkerFailure) {
        let callback = ended
        stop()
        callback?(failure)
    }

    /// Stops the worker and everything it started. No `ended` callback follows.
    func stop() {
        guard !stopped else { return }
        stopped = true
        ended = nil
        diagnosticsReader?.close()
        reader?.close()
        writer?.close()
        if let group = ownedProcessGroup {
            // Descendants may still own this group after its leader exits. Refuse to
            // signal a new process that has since reused the original leader PID.
            if child.isRunning || (getpgid(group) == -1 && errno == ESRCH) {
                _ = killpg(group, SIGKILL)
            }
            ownedProcessGroup = nil
        } else { terminate(child) }
    }
}

@MainActor
final class TrayConnection {
    enum State: Equatable {
        case idle(String), connecting(String), active(host: String, deviceID: String, unlocked: Bool)

        var connected: Bool {
            if case .idle = self { false } else { true }
        }
    }

    private(set) var state = State.idle("Disconnected") { didSet { stateChanged?(state) } }
    var stateChanged: ((State) -> Void)?
    var localDiagnostic: ((String) -> Void)?
    private let unlocked: () -> Bool
    private let sshExecutable: URL
    private var localSuspension = false
    private var child: Process?
    private var output: PipeWriter?
    private var reader: PipeReader?
    private var monitor: Task<Void, Never>?
    private var worker: WorkerProcess?
    private var launch: WorkerLaunch?
    private var buffer = LineBuffer()
    private var usedIDs = Set<String>()

    init(unlocked: @escaping () -> Bool = ConsoleAccess.current,
         sshExecutable: URL = URL(fileURLWithPath: "/usr/bin/ssh")) {
        self.unlocked = unlocked
        self.sshExecutable = sshExecutable
    }

    private var canOperate: Bool { !localSuspension && unlocked() }

    func setLocalSuspension(_ value: Bool) {
        localSuspension = value
        updateAvailability()
    }

    private func updateAvailability() {
        guard case let .active(host, id, previous) = state else { return }
        let available = canOperate
        if previous != available { state = .active(host: host, deviceID: id, unlocked: available) }
        // A locked or switched-out console must not keep running input from a session.
        if !available, worker != nil {
            stopWorker()
            send(WorkerExit(reason: "The Mac console locked or became unavailable."))
        }
    }

    func connect(settings: ConnectionSettings, launch: WorkerLaunch, name: String = "Priva Mac") throws {
        guard !state.connected else { throw TrayError("A connection is already open.") }
        let process = Process()
        process.executableURL = sshExecutable
        process.arguments = settings.arguments
        let fromServer = Pipe(), toServer = Pipe()
        process.standardInput = toServer
        process.standardOutput = fromServer
        process.standardError = FileHandle.nullDevice
        try process.run()
        child = process
        output = PipeWriter(toServer.fileHandleForWriting)
        self.launch = launch
        buffer = LineBuffer()
        usedIDs = []
        state = .connecting(settings.host)
        reader = PipeReader(fromServer.fileHandleForReading) { [weak self] chunk in
            guard let self else { return }
            guard let chunk else {
                stop("SSH closed. Check the host key, credentials and subsystem."); return
            }
            do {
                for line in try buffer.append(chunk) {
                    guard state.connected else { return }
                    try receive(IncomingMessage(line: line))
                }
            } catch { stop(error.localizedDescription) }
        }
        send(Greeting(name: String(name.prefix(64))))
        monitor = Task { [weak self] in
            let clock = ContinuousClock()
            let deadline = clock.now.advanced(by: .seconds(15))
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(200)) } catch { return }
                guard let self, state.connected else { return }
                updateAvailability()
                if case .connecting = state, clock.now >= deadline { stop("SSH handshake timed out."); return }
            }
        }
    }

    private func receive(_ message: IncomingMessage) throws {
        switch (state, message) {
        case let (.connecting(host), .ready(deviceID)):
            state = .active(host: host, deviceID: deviceID, unlocked: canOperate)
        case let (.active, .request(id, method)):
            guard usedIDs.count < 4096, usedIDs.insert(id).inserted else {
                throw TrayError("Repeated request ID or connection request limit reached.")
            }
            switch method {
            case "status":
                // The console can report its lock state even when the runtime is absent.
                send(Success(id: id, value: DeviceStatus(unlocked: canOperate, runtime: try? RuntimeVersions.read())))
            case "open": openWorker(id: id)
            default: send(Failure(id: id, error: "Unsupported method."))
            }
        case let (.active, .worker(line)):
            // A message for a worker that already ended has nowhere to go; the Runner has been told.
            worker?.write(line)
        case (.active, .close):
            stopWorker()
        default: throw TrayError("Unexpected message for the current connection state.")
        }
    }

    private func openWorker(id: String) {
        guard canOperate else {
            send(Failure(id: id, error: "Unlock the active Mac console before using its desktop.")); return
        }
        guard worker == nil, let launch else {
            send(Failure(id: id, error: "This Mac is already in use by another session.")); return
        }
        let process = WorkerProcess()
        do {
            try process.start(launch, line: { [weak self, weak process] line in
                guard let self, worker === process else { return }
                sendWorkerLine(line)
            }, ended: { [weak self, weak process] failure in
                guard let self, worker === process else { return }
                worker = nil
                localDiagnostic?(String(failure.localDetail.prefix(1280)))
                send(WorkerExit(reason: failure.remoteReason))
            })
            worker = process
            send(Success(id: id, value: Done()))
        } catch {
            localDiagnostic?(String(error.localizedDescription.prefix(1280)))
            send(Failure(id: id, error: (error as? TrayError)?.message ?? "The Mac desktop worker could not start."))
        }
    }

    private func stopWorker() {
        worker?.stop()
        worker = nil
    }

    private func sendWorkerLine(_ line: Data) {
        var data = Data([61])
        data.append(line)
        data.append(10)
        write(data)
    }

    private func send(_ message: some Encodable) {
        guard var data = try? JSONEncoder().encode(message), data.count <= 16 * 1024 else {
            stop("Invalid outgoing message."); return
        }
        data.append(10)
        write(data)
    }

    private func write(_ data: Data) {
        output?.write(data) { [weak self] in
            Task { @MainActor in self?.stop("SSH output closed or stalled.") }
        }
    }

    func stop(_ reason: String = "Disconnected locally") {
        guard state.connected else { return }
        stopWorker()
        monitor?.cancel()
        monitor = nil
        reader?.close()
        reader = nil
        output?.close()
        output = nil
        if let child { terminate(child) }
        child = nil
        state = .idle(reason)
    }
}
