import UIKit
// GoogleSignIn 9.2's Objective-C async imports lack concurrency annotations.
// SDK completions run on the main queue; keep SDK objects confined to this MainActor adapter.
@preconcurrency import GoogleSignIn
import NexoKit

@MainActor
final class IOSGoogleAuthorization: GoogleAccessAuthorizing {
    weak var presenter: UIViewController?
    private let scope = "https://www.googleapis.com/auth/drive"
    var configured: Bool { Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String != nil }
    var signedIn: Bool { GIDSignIn.sharedInstance.currentUser?.grantedScopes?.contains(scope) == true }

    func restore() async {
        guard GIDSignIn.sharedInstance.hasPreviousSignIn() else { return }
        _ = try? await GIDSignIn.sharedInstance.restorePreviousSignIn()
    }
    func signIn() async throws {
        guard let presenter else { throw GoogleDriveError.signIn }
        if let user = GIDSignIn.sharedInstance.currentUser {
            if !signedIn { _ = try await user.addScopes([scope], presenting: presenter) }
        } else {
            _ = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter, hint: nil, additionalScopes: [scope])
        }
        guard signedIn else { throw GoogleDriveError.signIn }
    }
    func disconnect() { GIDSignIn.sharedInstance.signOut() }
    func accessToken(forceRefresh: Bool) async throws -> String {
        guard signedIn, let user = GIDSignIn.sharedInstance.currentUser else { throw GoogleDriveError.signIn }
        // The SDK refreshes expired tokens in its protected Keychain session.
        let refreshed = try await user.refreshTokensIfNeeded()
        return refreshed.accessToken.tokenString
    }
}
