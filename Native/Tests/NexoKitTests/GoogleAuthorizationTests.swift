#if os(macOS)
import Foundation
import Testing
@testable import NexoKit

@MainActor
struct GoogleAuthorizationTests {
    private func configuration(_ clientID: String) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["installed": ["client_id": clientID]])
    }
    private func session(_ clientID: String, accessToken: String = "synthetic-access") throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "accessToken": accessToken, "refreshToken": "synthetic-refresh",
            "expiresAt": 2_000_000_000, "clientID": clientID
        ])
    }
    private func scratch() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nexo-auth-tests-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    @Test func missingOrMalformedConfigurationDoesNotReadSessionsOrBlockConstruction() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        var reads = 0
        let reader: (Bool) throws -> Data? = { _ in reads += 1; return nil }
        let missing = try GoogleAuthorization(directory: root, keychainService: "synthetic", sessionReader: reader)
        #expect(!missing.configured)
        #expect(missing.configurationError == nil)
        let malformed = Data("malformed synthetic configuration".utf8)
        let url = root.appendingPathComponent("GoogleOAuth.json")
        try malformed.write(to: url)
        let auth = try GoogleAuthorization(directory: root, keychainService: "synthetic", sessionReader: reader)
        #expect(!auth.configured)
        #expect(!auth.signedIn)
        #expect(auth.configurationError != nil)
        #expect(reads == 0)
        #expect(try Data(contentsOf: url) == malformed)
    }

    @Test func deliberateRepairPreservesMalformedBytesAndMatchingStoredSession() async throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("GoogleOAuth.json")
        let malformed = Data("{not a valid configuration}".utf8)
        try malformed.write(to: url)
        let clientID = "synthetic.apps.googleusercontent.com", storedSession = try session(clientID)
        var interactions: [Bool] = []
        let auth = try GoogleAuthorization(directory: root, keychainService: "synthetic", sessionReader: {
            interactions.append($0)
            return storedSession
        })
        let valid = try configuration(clientID)
        try auth.importConfiguration(valid)
        #expect(auth.configured)
        #expect(auth.signedIn)
        #expect(auth.configurationError == nil)
        #expect(interactions == [false])
        #expect(try await auth.accessToken() == "synthetic-access")
        #expect(try Data(contentsOf: url) == valid)
        let preserved = try #require(FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .first { $0.lastPathComponent.hasPrefix("GoogleOAuth-recovered-") })
        #expect(try Data(contentsOf: preserved) == malformed)
        #expect((try FileManager.default.attributesOfItem(atPath: preserved.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600)
        #expect((try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    }

    @Test func rejectedRepairLeavesMalformedFileUntouched() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("GoogleOAuth.json"), malformed = Data("invalid original".utf8)
        try malformed.write(to: url)
        let auth = try GoogleAuthorization(directory: root, keychainService: "synthetic", sessionReader: { _ in
            Issue.record("Invalid repair must not access a session")
            return nil
        })
        #expect(throws: (any Error).self) { try auth.importConfiguration(configuration("invalid-client")) }
        #expect(try Data(contentsOf: url) == malformed)
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path) == ["GoogleOAuth.json"])
    }

    @Test func changingClientKeepsStoredSessionButCannotUseItsOldToken() async throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let first = "first.apps.googleusercontent.com", second = "second.apps.googleusercontent.com"
        try configuration(first).write(to: root.appendingPathComponent("GoogleOAuth.json"))
        let originalSession = try session(first)
        let auth = try GoogleAuthorization(directory: root, keychainService: "synthetic", sessionReader: { _ in originalSession })
        #expect(auth.signedIn)
        try auth.importConfiguration(configuration(second))
        #expect(auth.configured)
        #expect(!auth.signedIn)
        await #expect(throws: (any Error).self) { try await auth.accessToken() }
        try auth.importConfiguration(configuration(first))
        #expect(auth.signedIn)
        #expect(try await auth.accessToken() == "synthetic-access")
    }

    @Test func validImportSucceedsWhenStoredSessionCannotBeRestored() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let auth = try GoogleAuthorization(directory: root, keychainService: "synthetic", sessionReader: { _ in
            throw GoogleDriveError.signIn
        })
        let valid = try configuration("synthetic.apps.googleusercontent.com")
        try auth.importConfiguration(valid)
        #expect(auth.configured)
        #expect(auth.configurationError == nil)
        #expect(auth.sessionError != nil)
        #expect(try Data(contentsOf: root.appendingPathComponent("GoogleOAuth.json")) == valid)
    }

    @Test(arguments: ["client round trip", "disconnect", "session replacement"])
    func staleRefreshCannotReturnOrSaveTokensAfterSessionChanges(_ change: String) async throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let client = "first.apps.googleusercontent.com"
        try configuration(client).write(to: root.appendingPathComponent("GoogleOAuth.json"))
        var persisted: Data? = try session(client), writes: [Data?] = []
        let exchange = SuspendedTokenExchange()
        let auth = try GoogleAuthorization(directory: root, keychainService: "synthetic",
            sessionReader: { _ in persisted }, sessionWriter: { writes.append($0); persisted = $0 },
            tokenExchange: exchange.call)
        let refresh = Task { try await auth.accessToken(forceRefresh: true) }
        while exchange.pending.isEmpty { await Task.yield() }
        switch change {
        case "client round trip":
            try auth.importConfiguration(configuration("second.apps.googleusercontent.com"))
            try auth.importConfiguration(configuration(client))
        case "disconnect": try auth.disconnect()
        default:
            persisted = try session(client, accessToken: "replacement-access")
            try auth.restoreStoredSession(allowInteraction: false)
        }
        exchange.succeedNext()
        await #expect(throws: (any Error).self) { try await refresh.value }
        #expect(writes.count == (change == "disconnect" ? 1 : 0))
        if change == "disconnect" { #expect(persisted == nil); #expect(!auth.signedIn) }
        else { #expect(try await auth.accessToken() == (change == "session replacement" ? "replacement-access" : "synthetic-access")) }
    }

    @Test func simultaneousRefreshesOfTheSameSessionBothSucceed() async throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let client = "synthetic.apps.googleusercontent.com"
        try configuration(client).write(to: root.appendingPathComponent("GoogleOAuth.json"))
        var persisted: Data? = try session(client), writes = 0
        let exchange = SuspendedTokenExchange()
        let auth = try GoogleAuthorization(directory: root, keychainService: "synthetic",
            sessionReader: { _ in persisted }, sessionWriter: { persisted = $0; writes += 1 },
            tokenExchange: exchange.call)
        let first = Task { try await auth.accessToken(forceRefresh: true) }
        let second = Task { try await auth.accessToken(forceRefresh: true) }
        while exchange.pending.count < 2 { await Task.yield() }
        exchange.succeedNext()
        exchange.succeedNext()
        #expect(try await first.value == "refreshed-access")
        #expect(try await second.value == "refreshed-access")
        #expect(writes == 2)
    }
}

@MainActor
private final class SuspendedTokenExchange {
    var pending: [CheckedContinuation<(Data, URLResponse), Error>] = []
    func call(_ request: URLRequest) async throws -> (Data, URLResponse) {
        try await withCheckedThrowingContinuation { pending.append($0) }
    }
    func succeedNext() {
        let data = Data("{\"access_token\":\"refreshed-access\",\"expires_in\":3600}".utf8)
        let response = HTTPURLResponse(url: URL(string: "https://oauth2.googleapis.com/token")!, statusCode: 200,
                                       httpVersion: nil, headerFields: nil)!
        pending.removeFirst().resume(returning: (data, response))
    }
}
#endif
