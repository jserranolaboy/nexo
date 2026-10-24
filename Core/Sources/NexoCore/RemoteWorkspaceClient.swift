import Foundation

public indirect enum JSONValue: Codable, Equatable, Sendable {
    case string(String), integer(Int), number(Double), bool(Bool)
    case object([String: JSONValue]), array([JSONValue]), null

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let bool = try? value.decode(Bool.self) { self = .bool(bool) }
        else if let integer = try? value.decode(Int.self) { self = .integer(integer) }
        else if let number = try? value.decode(Double.self) { self = .number(number) }
        else if let string = try? value.decode(String.self) { self = .string(string) }
        else if let array = try? value.decode([JSONValue].self) { self = .array(array) }
        else { self = .object(try value.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case let .string(item): try value.encode(item)
        case let .integer(item): try value.encode(item)
        case let .number(item): try value.encode(item)
        case let .bool(item): try value.encode(item)
        case let .object(item): try value.encode(item)
        case let .array(item): try value.encode(item)
        case .null: try value.encodeNil()
        }
    }
}

public struct RemoteOrganization: Decodable, Sendable {
    public let id: UUID
    public let name: String
    public let timeZone: String
    public let role: String
}

public struct CreatedRemoteOrganization: Decodable, Sendable {
    public let id: UUID
    public let name: String
    public let timeZone: String
}

public struct RemoteChange: Decodable, Sendable {
    public let cursor: Int
    public let kind: String
    public let id: UUID
    public let revision: Int
    public let payload: [String: JSONValue]
    public let before: [String: JSONValue]?
    public let mutationID: UUID?
    public let changedAt: String?
    public let actor: String
}

public struct RemoteChangePage: Decodable, Sendable {
    public let cursor: Int
    public let changes: [RemoteChange]
}

public struct RemoteAcknowledgement: Decodable, Sendable {
    public let id: UUID
    public let kind: String
    public let revision: Int
    public let payload: [String: JSONValue]
}

public enum RemoteWorkspaceError: Error, Equatable, Sendable {
    case invalidResponse
    case revisionConflict(revision: Int, payload: [String: JSONValue])
    case server(Int)
}

private struct RevisionConflictEnvelope: Decodable {
    struct Detail: Decodable {
        let revision: Int
        let payload: [String: JSONValue]
    }
    let detail: Detail
}

public protocol SyncTransport: Sendable {
    func createOrganization(id: UUID, mutationID: UUID, name: String,
                            timeZone: String) async throws -> CreatedRemoteOrganization
    func put(organizationID: UUID, kind: String, entityID: UUID,
             payload: [String: JSONValue], expectedRevision: Int?,
             mutationID: UUID) async throws -> RemoteAcknowledgement
    func changes(organizationID: UUID, after cursor: Int) async throws -> RemoteChangePage
}

private struct RemoteMutationRequest: Encodable {
    let mutationID: UUID
    let expectedRevision: Int?
    let payload: [String: JSONValue]
}

private struct CreateOrganizationRequest: Encodable {
    let id: UUID
    let mutationID: UUID
    let name: String
    let timeZone: String
}

/// The token callback can read a short-lived OIDC access token from Keychain.
/// No token or service secret is persisted by this client.
public actor RemoteWorkspaceClient: SyncTransport {
    private let baseURL: URL
    private let session: URLSession
    private let accessToken: @Sendable () async throws -> String

    public init(baseURL: URL, session: URLSession = .shared,
                accessToken: @escaping @Sendable () async throws -> String) {
        self.baseURL = baseURL.appendingPathComponent("")
        self.session = session
        self.accessToken = accessToken
    }

    public func organizations() async throws -> [RemoteOrganization] {
        try await send([RemoteOrganization].self, path: "organizations", method: "GET")
    }

    /// A stable local ID and mutation ID make a lost creation response safe to retry.
    public func createOrganization(
        id: UUID, mutationID: UUID, name: String, timeZone: String
    ) async throws -> CreatedRemoteOrganization {
        let body = try JSONEncoder().encode(CreateOrganizationRequest(
            id: id, mutationID: mutationID, name: name, timeZone: timeZone
        ))
        return try await send(CreatedRemoteOrganization.self,
                              path: "organizations", method: "POST", body: body)
    }

    public func changes(organizationID: UUID, after cursor: Int) async throws -> RemoteChangePage {
        try await send(RemoteChangePage.self,
                       path: "organizations/\(organizationID)/changes?after=\(cursor)", method: "GET")
    }

    public func put(
        organizationID: UUID, kind: String, entityID: UUID, payload: [String: JSONValue],
        expectedRevision: Int?, mutationID: UUID
    ) async throws -> RemoteAcknowledgement {
        let body = try JSONEncoder().encode(RemoteMutationRequest(
            mutationID: mutationID, expectedRevision: expectedRevision, payload: payload
        ))
        return try await send(RemoteAcknowledgement.self,
                              path: "organizations/\(organizationID)/entities/\(kind)/\(entityID)",
                              method: "PUT", body: body)
    }

    /// Converts a model into the service's payload, omitting the entity ID and
    /// association ID carried by the URL. Dates use ISO 8601 over the wire.
    public static func payload<T: Encodable>(for entity: T) throws -> [String: JSONValue] {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(entity)
        var values = try JSONDecoder().decode([String: JSONValue].self, from: data)
        values.removeValue(forKey: "id")
        values.removeValue(forKey: "organizationID")
        return values
    }

    private func send<T: Decodable>(_ type: T.Type, path: String, method: String, body: Data? = nil) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw RemoteWorkspaceError.invalidResponse
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(try await accessToken())", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw RemoteWorkspaceError.invalidResponse }
        if response.statusCode == 409,
           let conflict = try? JSONDecoder().decode(RevisionConflictEnvelope.self, from: data) {
            throw RemoteWorkspaceError.revisionConflict(
                revision: conflict.detail.revision, payload: conflict.detail.payload
            )
        }
        guard (200..<300).contains(response.statusCode) else { throw RemoteWorkspaceError.server(response.statusCode) }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
