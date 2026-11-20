import Foundation

@main enum RunTests {
    @MainActor static func main() async throws {
        try ProtocolCases.runtimeStatus()
        try ProtocolCases.optionsAndFrames()
        try ProtocolCases.explicitMenuConnection()
        try ProtocolCases.accessAndOutput()
        try await ProtocolCases.connection(locked: false)
        try await ProtocolCases.connection(locked: true)
        try await ProtocolCases.connection(locked: false, lockDuringWork: true)
        try await ProtocolCases.connection(locked: false, failingWorker: true)
        print("Passed 8 macOS tray checks.")
    }
}
