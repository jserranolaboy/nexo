import Foundation
import XCTest
@testable import NexoCore

private final class RecordingProtocol: URLProtocol {
    static let lock = NSLock()
    nonisolated(unsafe) static var lastRequest: URLRequest?
    nonisolated(unsafe) static var lastBody: Data?
    nonisolated(unsafe) static var responseBody = Data()
    nonisolated(unsafe) static var responseStatus = 201

    static func configureResponse(_ data: Data, status: Int = 201) {
        lock.lock()
        defer { lock.unlock() }
        responseBody = data
        responseStatus = status
    }

    static func recordedRequest() -> (URLRequest?, Data?) {
        lock.lock()
        defer { lock.unlock() }
        return (lastRequest, lastBody)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let body: Data
        if let supplied = request.httpBody {
            body = supplied
        } else if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var bytes = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                bytes.append(contentsOf: buffer.prefix(count))
            }
            body = bytes
        } else {
            body = Data()
        }
        Self.lock.lock()
        Self.lastRequest = request
        Self.lastBody = body
        let returned = Self.responseBody
        let status = Self.responseStatus
        Self.lock.unlock()
        let response = HTTPURLResponse(url: request.url!, statusCode: status,
                                       httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: returned)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class RemoteWorkspaceClientTests: XCTestCase {
    func testCreateOrganizationCarriesStableIDsAndPreservesBasePath() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RecordingProtocol.self]
        let session = URLSession(configuration: configuration)
        let client = RemoteWorkspaceClient(
            baseURL: URL(string: "https://example.test/api/v1")!, session: session,
            accessToken: { "test-token" }
        )
        let organizationID = UUID()
        let mutationID = UUID()
        RecordingProtocol.configureResponse(try JSONSerialization.data(withJSONObject: [
            "id": organizationID.uuidString, "name": "Asociación", "timeZone": "America/Puerto_Rico"
        ]))
        let created = try await client.createOrganization(
            id: organizationID, mutationID: mutationID,
            name: "Asociación", timeZone: "America/Puerto_Rico"
        )
        XCTAssertEqual(created.id, organizationID)

        let (request, data) = RecordingProtocol.recordedRequest()
        XCTAssertEqual(request?.url?.path, "/api/v1/organizations")
        XCTAssertEqual(request?.httpMethod, "POST")
        XCTAssertEqual(request?.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(data)) as? [String: String])
        XCTAssertEqual(fields["id"], organizationID.uuidString)
        XCTAssertEqual(fields["mutationID"], mutationID.uuidString)
    }

    func testRevisionConflictIncludesRemoteValue() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RecordingProtocol.self]
        let session = URLSession(configuration: configuration)
        let client = RemoteWorkspaceClient(
            baseURL: URL(string: "https://example.test/api")!, session: session,
            accessToken: { "test-token" }
        )
        RecordingProtocol.configureResponse(try JSONSerialization.data(withJSONObject: [
            "detail": ["revision": 3, "payload": ["name": "Edición de otro Mac"]]
        ]), status: 409)
        do {
            _ = try await client.put(
                organizationID: UUID(), kind: "member", entityID: UUID(),
                payload: ["name": .string("Mi edición")],
                expectedRevision: 2, mutationID: UUID()
            )
            XCTFail("A stale edit should be rejected")
        } catch let error as RemoteWorkspaceError {
            XCTAssertEqual(error, .revisionConflict(
                revision: 3, payload: ["name": .string("Edición de otro Mac")]
            ))
        }
    }
}
