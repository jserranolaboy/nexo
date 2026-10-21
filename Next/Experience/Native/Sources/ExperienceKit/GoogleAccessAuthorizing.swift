import Foundation

public enum GoogleDriveError: LocalizedError {
    case message(String), http(Int), signIn, configuration, keychain(OSStatus)
    public var errorDescription: String? {
        switch self {
        case .message(let text): text
        case .http(401): NexoLocale.text("Vuelve a conectar tu cuenta de Google. Tus cambios pendientes se conservan.")
        case .http(403): NexoLocale.text("Google no permite esta operación. Revisa el acceso a la carpeta y que Drive API esté activada.")
        case .http(404): NexoLocale.text("Esta cuenta no puede abrir la carpeta o uno de sus archivos. Comprueba la cuenta, el acceso y la papelera de Drive.")
        case .http(429): NexoLocale.text("Drive está recibiendo muchas solicitudes. Nexo volverá a intentarlo.")
        case .http: NexoLocale.text("Drive no pudo completar la operación. Tus cambios pendientes se conservan.")
        case .signIn: NexoLocale.text("Conecta tu cuenta de Google para sincronizar.")
        case .configuration: NexoLocale.text("Importa la configuración de Google para Nexo.")
        case .keychain: NexoLocale.text("No se pudo acceder al llavero del Mac. Desbloquéalo y vuelve a intentarlo.")
        }
    }
}

@MainActor
public protocol GoogleAccessAuthorizing: AnyObject {
    func accessToken(forceRefresh: Bool) async throws -> String
}
#if os(macOS)
extension GoogleAuthorization: GoogleAccessAuthorizing {}
#endif
