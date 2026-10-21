#if os(macOS)
import AppKit
import CryptoKit
import Network
import Security
import LocalAuthentication

public struct GoogleDesktopClient: Codable, Sendable {
    public let client_id: String
    public let client_secret: String?
    public init(data: Data) throws {
        struct File: Decodable { let installed: GoogleDesktopClient }
        let client = try JSONDecoder().decode(File.self, from: data).installed
        guard client.client_id.hasSuffix(".apps.googleusercontent.com"), client.client_id.count < 300 else { throw GoogleDriveError.configuration }
        self = client
    }
}
private struct GoogleTokens: Codable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var clientID: String
}
private struct TokenResponse: Decodable {
    let access_token: String
    let refresh_token: String?
    let expires_in: Double
    let scope: String?
}
@MainActor
public final class GoogleAuthorization {
    private let configURL: URL
    private let service: String
    private let sessionReader: ((Bool) throws -> Data?)?
    private let sessionWriter: ((Data?) throws -> Void)?
    private let tokenExchange: (@MainActor (URLRequest) async throws -> (Data, URLResponse))?
    private var sessionGeneration = UUID()
    private var client: GoogleDesktopClient?
    private var tokens: GoogleTokens?
    private var signingIn = false
    public private(set) var requiresKeychainAccess = false
    public private(set) var configurationError: String?
    public private(set) var sessionError: String?
    public var configured: Bool { client != nil }
    public var signedIn: Bool { tokens != nil }
    public convenience init(directory: URL, keychainService: String, bundledConfiguration: URL? = nil) throws {
        try self.init(directory: directory, keychainService: keychainService,
                      bundledConfiguration: bundledConfiguration, sessionReader: nil)
    }
    init(directory: URL, keychainService: String, bundledConfiguration: URL? = nil,
         sessionReader: ((Bool) throws -> Data?)?, sessionWriter: ((Data?) throws -> Void)? = nil,
         tokenExchange: (@MainActor (URLRequest) async throws -> (Data, URLResponse))? = nil) throws {
        self.configURL = directory.appendingPathComponent("GoogleOAuth.json")
        self.service = keychainService
        self.sessionReader = sessionReader
        self.sessionWriter = sessionWriter
        self.tokenExchange = tokenExchange
        do {
            if FileManager.default.fileExists(atPath: configURL.path) { client = try GoogleDesktopClient(data: Data(contentsOf: configURL)) }
            else if let bundledConfiguration { client = try GoogleDesktopClient(data: Data(contentsOf: bundledConfiguration)) }
        } catch { configurationError = error.localizedDescription }
        // An optional cloud connection must never put a password prompt in
        // front of the local workspace during launch (e.g. after an ad hoc build).
        if client != nil {
            do { try restoreStoredSession(allowInteraction: false) }
            catch { sessionError = error.localizedDescription }
        }
    }
    public func restoreStoredSession(allowInteraction: Bool = true) throws {
        sessionGeneration = UUID()
        guard client != nil else { return }
        let data: Data?
        if let sessionReader { data = try sessionReader(allowInteraction) }
        else { data = try keychainRead(allowInteraction: allowInteraction) }
        if let data {
            let value = try JSONDecoder().decode(GoogleTokens.self, from: data)
            tokens = value.clientID == client?.client_id ? value : nil
        } else { tokens = nil }
        sessionError = nil
    }
    public func importConfiguration(_ data: Data) throws {
        let candidate = try GoogleDesktopClient(data: data)
        guard !signingIn else { throw GoogleDriveError.message(NexoLocale.text("Completa el inicio de sesión que está abierto.")) }
        try FileManager.default.createDirectory(at: configURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if configurationError != nil, FileManager.default.fileExists(atPath: configURL.path) {
            let preserved = configURL.deletingLastPathComponent().appendingPathComponent("GoogleOAuth-recovered-\(UUID()).json")
            try FileManager.default.copyItem(at: configURL, to: preserved)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: preserved.path)
        }
        try data.write(to: configURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configURL.path)
        sessionGeneration = UUID()
        // Importing configuration must not delete an existing account session.
        if candidate.client_id != tokens?.clientID { tokens = nil }
        client = candidate
        configurationError = nil
        do { try restoreStoredSession(allowInteraction: false) }
        catch { sessionError = error.localizedDescription }
    }
    public func signIn() async throws {
        guard let client else { throw GoogleDriveError.configuration }
        guard !signingIn else { throw GoogleDriveError.message(NexoLocale.text("El inicio de sesión ya está abierto.")) }
        signingIn = true; defer { signingIn = false }
        sessionGeneration = UUID()
        let generation = sessionGeneration
        let verifier = try Self.random(), state = try Self.random()
        let challenge = Self.base64(Data(SHA256.hash(data: Data(verifier.utf8))))
        let callback = GoogleLoopback(state: state)
        let redirect = try await callback.start()
        defer { callback.stop() }
        var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        url.queryItems = [
            .init(name: "client_id", value: client.client_id), .init(name: "redirect_uri", value: redirect.absoluteString),
            .init(name: "response_type", value: "code"), .init(name: "scope", value: "https://www.googleapis.com/auth/drive"),
            .init(name: "access_type", value: "offline"), .init(name: "prompt", value: "consent select_account"),
            .init(name: "state", value: state), .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256")
        ]
        guard NSWorkspace.shared.open(url.url!) else { throw GoogleDriveError.message(NexoLocale.text("No se pudo abrir Google en el navegador.")) }
        let code = try await callback.code()
        guard generation == sessionGeneration else { throw GoogleDriveError.signIn }
        let response = try await exchange(["code": code, "code_verifier": verifier, "redirect_uri": redirect.absoluteString, "grant_type": "authorization_code"], client: client)
        guard generation == sessionGeneration else { throw GoogleDriveError.signIn }
        guard let refresh = response.refresh_token else { throw GoogleDriveError.signIn }
        if let scope = response.scope, !scope.split(separator: " ").contains("https://www.googleapis.com/auth/drive") { throw GoogleDriveError.message(NexoLocale.text("Google no concedió el acceso a Drive.")) }
        let value = GoogleTokens(accessToken: response.access_token, refreshToken: refresh, expiresAt: Date().addingTimeInterval(response.expires_in), clientID: client.client_id)
        try save(value)
    }
    public func accessToken(forceRefresh: Bool = false) async throws -> String {
        guard let client, let stored = tokens, stored.clientID == client.client_id else { throw GoogleDriveError.signIn }
        if !forceRefresh && stored.expiresAt > Date().addingTimeInterval(60) { return stored.accessToken }
        let generation = sessionGeneration
        let response = try await exchange(["refresh_token": stored.refreshToken, "grant_type": "refresh_token"], client: client)
        guard generation == sessionGeneration else { throw GoogleDriveError.signIn }
        let value = GoogleTokens(accessToken: response.access_token, refreshToken: response.refresh_token ?? stored.refreshToken, expiresAt: Date().addingTimeInterval(response.expires_in), clientID: client.client_id)
        try save(value); return value.accessToken
    }
    public func disconnect() throws {
        sessionGeneration = UUID()
        if let sessionWriter { try sessionWriter(nil) }
        else {
            let result = SecItemDelete(keychainQuery() as CFDictionary)
            guard result == errSecSuccess || result == errSecItemNotFound else { throw GoogleDriveError.keychain(result) }
        }
        tokens = nil; requiresKeychainAccess = false
        sessionError = nil
    }
    private func exchange(_ fields: [String: String], client: GoogleDesktopClient) async throws -> TokenResponse {
        var fields = fields; fields["client_id"] = client.client_id; fields["client_secret"] = client.client_secret
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        let form = fields.sorted { $0.key < $1.key }.map { $0.key + "=" + $0.value.addingPercentEncoding(withAllowedCharacters: allowed)! }.joined(separator: "&")
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!); request.httpMethod = "POST"
        request.timeoutInterval = 30; request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type"); request.httpBody = Data(form.utf8)
        let result: (Data, URLResponse)
        if let tokenExchange { result = try await tokenExchange(request) }
        else { result = try await URLSession.shared.data(for: request) }
        let (data, raw) = result
        guard let response = raw as? HTTPURLResponse, response.statusCode == 200 else { throw GoogleDriveError.signIn }
        return try JSONDecoder().decode(TokenResponse.self, from: data)
    }
    private func save(_ value: GoogleTokens) throws {
        let data = try JSONEncoder().encode(value), query = keychainQuery()
        if let sessionWriter { try sessionWriter(data) }
        else {
            let result = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            if result == errSecItemNotFound {
                var new = query; new[kSecValueData as String] = data; new[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                let added = SecItemAdd(new as CFDictionary, nil)
                guard added == errSecSuccess else { throw GoogleDriveError.keychain(added) }
            } else if result != errSecSuccess { throw GoogleDriveError.keychain(result) }
        }
        tokens = value; requiresKeychainAccess = false
        sessionError = nil
    }
    private func keychainQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "google-drive"]
    }
    private func keychainRead(allowInteraction: Bool) throws -> Data? {
        var query = keychainQuery(); query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        // The file-based macOS keychain ignores the modern query UI flag.
        // Refuse protected reads at launch, restoring this process's previous
        // UI policy immediately afterward. Access still requires user consent.
        var previousInteraction: DarwinBoolean = true
        if !allowInteraction {
            let status = SecKeychainGetUserInteractionAllowed(&previousInteraction)
            guard status == errSecSuccess else { throw GoogleDriveError.keychain(status) }
            let updated = SecKeychainSetUserInteractionAllowed(false)
            guard updated == errSecSuccess else { throw GoogleDriveError.keychain(updated) }
        }
        defer { if !allowInteraction { SecKeychainSetUserInteractionAllowed(previousInteraction.boolValue) } }
        if !allowInteraction {
            let context = LAContext(); context.interactionNotAllowed = true
            query[kSecUseAuthenticationContext as String] = context
        }
        var result: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &result)
        if !allowInteraction && (status == errSecInteractionNotAllowed || status == errSecAuthFailed) {
            requiresKeychainAccess = true; return nil
        }
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw GoogleDriveError.keychain(status) }
        requiresKeychainAccess = false
        return result as? Data
    }
    private static func random() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw GoogleDriveError.signIn }
        return base64(Data(bytes))
    }
    private static func base64(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
}
@MainActor
private final class GoogleLoopback {
    private let state: String
    private var listener: NWListener?
    private var ready: CheckedContinuation<URL, Error>?
    private var pending: CheckedContinuation<String, Error>?
    private var result: Result<String, Error>?
    private var timeout: Task<Void, Never>?
    init(state: String) { self.state = state }
    func start() async throws -> URL {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: params); self.listener = listener
        return try await withCheckedThrowingContinuation { continuation in
            ready = continuation
            listener.stateUpdateHandler = { [weak self] status in
                Task { @MainActor in
                    guard let self else { return }
                    switch status {
                    case .ready:
                        guard let port = self.listener?.port else { return }
                        self.ready?.resume(returning: URL(string: "http://127.0.0.1:\(port.rawValue)/oauth/callback")!); self.ready = nil
                    case .failed(let error): self.ready?.resume(throwing: error); self.ready = nil; self.finish(.failure(error))
                    default: break
                    }
                }
            }
            listener.newConnectionHandler = { [weak self] connection in Task { @MainActor in self?.read(connection, buffer: Data()) } }
            listener.start(queue: .main)
            timeout = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(240)) } catch { return }
                self?.ready?.resume(throwing: GoogleDriveError.signIn); self?.ready = nil
                self?.finish(.failure(GoogleDriveError.message(NexoLocale.text("El inicio de sesión caducó. Vuelve a conectar Google.")))); self?.listener?.cancel()
            }
        }
    }
    func code() async throws -> String {
        if let result { return try result.get() }
        return try await withCheckedThrowingContinuation { pending = $0 }
    }
    func stop() { timeout?.cancel(); listener?.cancel(); listener = nil }
    private func finish(_ value: Result<String, Error>) {
        guard result == nil else { return }; result = value; pending?.resume(with: value); pending = nil
    }
    private func read(_ connection: NWConnection, buffer: Data) {
        if buffer.isEmpty { connection.start(queue: .main) }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] chunk, _, complete, error in
            Task { @MainActor in
                guard let self else { connection.cancel(); return }
                var data = buffer; if let chunk { data.append(chunk) }
                guard error == nil, data.count <= 8192 else { connection.cancel(); return }
                guard let request = String(data: data, encoding: .utf8), request.contains("\r\n\r\n") else {
                    if complete { connection.cancel() } else { self.read(connection, buffer: data) }; return
                }
                let first = request.components(separatedBy: "\r\n")[0].split(separator: " ")
                var valid = false
                if first.count == 3, first[0] == "GET", let url = URLComponents(string: "http://127.0.0.1" + first[1]), url.path == "/oauth/callback" {
                    let items = url.queryItems ?? []
                    if items.filter({ $0.name == "state" }).count == 1, items.first(where: { $0.name == "state" })?.value == self.state {
                        if let code = items.first(where: { $0.name == "code" })?.value, code.count < 4096 {
                            self.finish(.success(code)); valid = true
                        } else if items.contains(where: { $0.name == "error" }) { self.finish(.failure(GoogleDriveError.message(NexoLocale.text("No se autorizó la conexión con Google.")))) }
                    }
                }
                let body = "<!doctype html><html lang=es><meta charset=utf-8><title>Nexo</title><style>body{font:17px -apple-system,sans-serif;padding:12vh 10%;color:#1d1d1f;background:#f5f5f7}h1{font-size:40px}</style><h1>Nexo</h1><p>\(valid ? "Puedes volver a Nexo para completar la conexión." : "Esta solicitud no es válida. Vuelve a Nexo.")</p></html>"
                let response = "HTTP/1.1 \(valid ? "200 OK" : "400 Bad Request")\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nConnection: close\r\nContent-Length: \(body.utf8.count)\r\n\r\n\(body)"
                connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
            }
        }
    }
}

#endif
