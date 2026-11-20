import Testing

@Test func runtimeVersions() throws { try ProtocolCases.runtimeStatus() }

@Test func optionsAndFrames() throws { try ProtocolCases.optionsAndFrames() }
@Test func accessAndOutput() throws { try ProtocolCases.accessAndOutput() }
@Test func workerMessagesRoundTrip() async throws { try await ProtocolCases.connection(locked: false) }
@Test func lockedDeviceRefusesWorker() async throws { try await ProtocolCases.connection(locked: true) }
@Test func lockStopsWorker() async throws { try await ProtocolCases.connection(locked: false, lockDuringWork: true) }
@Test func diagnosticsStayLocal() async throws { try await ProtocolCases.connection(locked: false, failingWorker: true) }
@Test func explicitMenuConnection() throws { try ProtocolCases.explicitMenuConnection() }
