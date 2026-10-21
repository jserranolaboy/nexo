import AppKit
import WebKit
import PDFKit
import UniformTypeIdentifiers
import ExperienceKit
import VRRCore

@main
struct ValentinaMain {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let delegate = AppDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private var experience: ExperienceStore?
    private var startupError: String?
    private var hasUnsavedDraft = false
    private var rendered: [String: Data] = [:]
    private var renderOrder: [String] = []
    private var directory: URL!
    private var drafts: TemplateDraftStore { TemplateDraftStore(directory: directory) }
    private var google: GoogleAuthorization?
    private var driveClient: GoogleDriveClient?
    private var drive: DriveCoordinator?
    private var driveError = ""
    private var googleAccount = ""
    private var appearancePreference: String {
        let value = UserDefaults.standard.string(forKey: "appearance") ?? "system"
        return ["system", "light", "dark"].contains(value) ? value : "system"
    }
    private func applyAppearance(_ value: String) {
        NSApplication.shared.appearance = value == "dark" ? NSAppearance(named: .darkAqua) : value == "light" ? NSAppearance(named: .aqua) : nil
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        applyAppearance(appearancePreference)
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let isQA = Bundle.main.bundleIdentifier?.hasSuffix(".qa") == true
        directory = support.appendingPathComponent(isQA ? "Valentina-Experience-QA" : "Valentina-Experience", isDirectory: true)
        do { experience = try ExperienceStore(directory: directory, previewDirectory: isQA ? nil : support.appendingPathComponent("VRR-Next-Preview", isDirectory: true)) }
        catch { startupError = NexoLocale.text("El espacio no se pudo abrir. Puedes recuperar una copia; el archivo actual se conservará.") }
        setupDrive(isQA: isQA)
        installMenus()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addUserScript(WKUserScript(source: "window.nexoAppearance='\(appearancePreference)';window.nexoLocale='\(NexoLocale.language)';", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "valentina")
        configuration.setURLSchemeHandler(BundleScheme(), forURLScheme: "valentina")
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.allowsBackForwardNavigationGestures = false
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1380, height: 900), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.delegate = self
        window.title = "Nexo"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = .windowBackgroundColor
        window.minSize = NSSize(width: 760, height: 620)
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("ValentinaExperienceWindow")
        web.load(URLRequest(url: URL(string: "valentina://experience/index.html")!))
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
    private func mayLeaveDraft() -> Bool {
        guard hasUnsavedDraft else { return true }
        let alert = NSAlert(); alert.messageText = NexoLocale.text("Hay cambios en tu plantilla")
        alert.informativeText = NexoLocale.text("El borrador se conservará en este Mac para continuar al abrir Nexo.")
        alert.addButton(withTitle: NexoLocale.text("Volver a la plantilla")); alert.addButton(withTitle: NexoLocale.text("Cerrar y conservar borrador"))
        if alert.runModal() == .alertSecondButtonReturn { hasUnsavedDraft = false; return true }
        return false
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { mayLeaveDraft() }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { mayLeaveDraft() ? .terminateNow : .terminateCancel }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard navigationAction.request.url?.scheme == "valentina", navigationAction.request.url?.host == "experience" else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "valentina",
              let body = message.body as? [String: Any], let command = body["command"] as? String else { replyHandler(nil, NexoLocale.text("Solicitud no válida.")); return }
        Task { @MainActor in
            do { replyHandler(try await handle(command, body: body), nil) }
            catch {
                let text: String
                if let error = error as? WorkspaceCommandError {
                    switch error {
                    case .capacityReached: text = NexoLocale.text("Los cupos están completos. Retira una selección para liberar espacio.")
                    case .alreadyIncluded, .alreadyListed, .alreadyRegistered: text = NexoLocale.text("Esta persona ya está en la lista.")
                    case .invalidTransition: text = NexoLocale.text("El registro cambió. Revisa su estado antes de continuar.")
                    default: text = NexoLocale.text("No se pudo guardar este cambio. Revisa la selección.")
                    }
                } else if error is WorkspaceValidationError { text = NexoLocale.text("Revisa los datos: hay un nombre, fecha o relación que no es válida.") }
                else { text = error.localizedDescription }
                replyHandler(nil, NexoLocale.text(text))
            }
        }
    }
    private func handle(_ command: String, body: [String: Any]) async throws -> Any {
        if command.hasPrefix("drive") { return try await handleDrive(command, body: body) }
        switch command {
        case "appearance":
            guard let value = body["value"] as? String, ["system", "light", "dark"].contains(value) else { throw ExperienceError.invalidInput(NexoLocale.text("Aspecto no válido.")) }
            UserDefaults.standard.set(value, forKey: "appearance")
            applyAppearance(value)
            return ["ok": true]
        case "interfaceError":
            NSLog("Nexo interface error: %@", String((body["message"] as? String ?? "Unknown").prefix(500)))
            return ["ok": true]
        case "draftState":
            try drafts.save(body); hasUnsavedDraft = body["dirty"] as? Bool ?? false; return ["ok": true]
        case "recoverDraft": return try drafts.read() ?? [:]
        case "load":
            guard let experience else { throw ExperienceError.invalidInput(startupError ?? NexoLocale.text("No se pudo abrir el espacio.")) }
            return ["snapshot": try snapshotObject(experience.load()), "copiedPreview": experience.copiedPreview, "drive": try driveStatus(), "activeOrganizationID": UserDefaults.standard.string(forKey: "activeOrganizationID") ?? ""]
        case "activeOrganization":
            guard let raw = body["id"] as? String, let id = UUID(uuidString: raw), try experience?.load().organizations.contains(where: { $0.id == id }) == true else { throw ExperienceError.invalidInput(NexoLocale.text("El espacio no existe.")) }
            UserDefaults.standard.set(raw, forKey: "activeOrganizationID")
            return ["ok": true]
        case "mutate":
            guard let experience, let action = body["action"] as? [String: Any], let revision = body["expectedRevision"] as? NSNumber else { throw ExperienceError.unavailable }
            return try snapshotObject(experience.perform(action, expectedRevision: revision.uint64Value))
        case "exportWorkspace":
            guard let experience else { throw ExperienceError.unavailable }
            let panel = NSSavePanel(); panel.allowedContentTypes = [.json]; panel.nameFieldStringValue = "Nexo-\(dateStamp()).json"
            guard await panel.beginSheetModal(for: window) == .OK, let url = panel.url else { return ["cancelled": true] }
            try WorkspaceTransfer.export(experience.load()).write(to: url, options: .atomic)
            return ["saved": true]
        case "restoreWorkspace":
            guard drive?.syncing != true else { throw GoogleDriveError.message(NexoLocale.text("Espera a que termine la sincronización.")) }
            let panel = NSOpenPanel(); panel.allowedContentTypes = [.json]; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
            let localBackups = directory.appendingPathComponent("Backups", isDirectory: true)
            if FileManager.default.fileExists(atPath: localBackups.path) { panel.directoryURL = localBackups }
            guard await panel.beginSheetModal(for: window) == .OK, let url = panel.url else { return ["cancelled": true] }
            let store = experience?.store ?? SnapshotStore(directory: directory)
            let candidate = try WorkspaceTransfer.inspect(at: url)
            let alert = NSAlert(); alert.messageText = NexoLocale.text("Recuperar esta copia"); alert.informativeText = NexoLocale.text("Contiene {0} espacios, {1} personas y {2} encuentros. El contenido actual se reemplazará; conservaremos una copia anterior. Drive quedará en pausa, con su historial y cambios pendientes intactos.", candidate.organizations.count, candidate.members.count, candidate.events.count); alert.addButton(withTitle: NexoLocale.text("Recuperar")); alert.addButton(withTitle: NexoLocale.text("Cancelar"))
            guard await alert.beginSheetModal(for: window) == .alertFirstButtonReturn else { return ["cancelled": true] }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if let drive { try drive.restoreWorkspace(candidate) }
            else { try WorkspaceTransfer.restore(candidate, into: store) }
            experience = try ExperienceStore(directory: directory)
            startupError = nil
            setupDrive(isQA: Bundle.main.bundleIdentifier?.hasSuffix(".qa") == true)
            return ["restored": true]
        case "importPDF":
            let panel = NSOpenPanel(); panel.allowedContentTypes = [.pdf]; panel.allowsMultipleSelection = false
            guard await panel.beginSheetModal(for: window) == .OK, let url = panel.url else { return ["cancelled": true] }
            let data = try boundedData(url, limit: 8_000_000)
            guard let document = PDFDocument(data: data), document.pageCount > 0, !document.isLocked else { throw ExperienceError.invalidInput(NexoLocale.text("El PDF no se puede abrir o está protegido.")) }
            var pages: [[String: Any]] = []
            for index in 0..<document.pageCount {
                let bounds = document.page(at: index)!.bounds(for: .mediaBox)
                pages.append(["width": bounds.width, "height": bounds.height])
            }
            guard let index = pages.firstIndex(where: { AttendancePDF.supportsListPage(CGSize(width: $0["width"] as? CGFloat ?? 0, height: $0["height"] as? CGFloat ?? 0)) }) else { throw ExperienceError.invalidInput(NexoLocale.text("El PDF no tiene una página donde pueda colocarse la lista.")) }
            let token = cache(data)
            return ["data": data.base64EncodedString(), "pages": pages, "listPageIndex": index, "token": token, "image": try thumbnail(document, index: index)]
        case "backgroundPage":
            guard let encoded = body["data"] as? String, let data = Data(base64Encoded: encoded), data.count <= 8_000_000,
                  let document = PDFDocument(data: data), !document.isLocked else { throw ExperienceError.invalidInput(NexoLocale.text("El PDF no se puede abrir.")) }
            let index = body["index"] as? Int ?? 0
            var pages: [[String: Double]] = []
            for i in 0..<document.pageCount { let bounds = document.page(at: i)!.bounds(for: .mediaBox); pages.append(["width": bounds.width, "height": bounds.height]) }
            return ["pages": pages, "image": try thumbnail(document, index: index)]
        case "importImage":
            let panel = NSOpenPanel(); panel.allowedContentTypes = [.png, .jpeg]; panel.allowsMultipleSelection = false
            guard await panel.beginSheetModal(for: window) == .OK, let url = panel.url else { return ["cancelled": true] }
            let data = try boundedData(url, limit: 8_000_000)
            guard let image = NSImage(data: data), let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { throw ExperienceError.invalidInput(NexoLocale.text("La imagen no se puede abrir.")) }
            guard png.count <= 2_000_000 else { throw ExperienceError.invalidInput(NexoLocale.text("La imagen debe ocupar menos de 2 MB. Usa una versión más pequeña.")) }
            return ["data": png.base64EncodedString(), "width": image.size.width, "height": image.size.height]
        case "renderPDF":
            let request = try ExperienceStore.decoder().decode(PDFRequest.self, from: JSONSerialization.data(withJSONObject: body))
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("valentina-\(UUID()).pdf")
            defer { try? FileManager.default.removeItem(at: url) }
            let language = NexoLocale.language
            let data = try await Task.detached(priority: .userInitiated) {
                try AttendancePDF.render(organization: request.organization, event: request.event, entries: request.entries, template: request.template, mode: request.mode == "blank" ? .blank : .completed, language: language, to: url)
                return try Data(contentsOf: url)
            }.value
            guard let document = PDFDocument(data: data) else { throw ExperienceError.invalidInput(NexoLocale.text("No se pudo preparar el documento.")) }
            return ["token": cache(data), "pageCount": document.pageCount, "image": try thumbnail(document, index: 0)]
        case "pdfPage":
            guard let token = body["token"] as? String, let data = rendered[token], let document = PDFDocument(data: data), let index = body["index"] as? Int else { throw ExperienceError.invalidInput(NexoLocale.text("La vista del documento caducó. Vuelve a prepararlo.")) }
            return ["image": try thumbnail(document, index: index)]
        case "exportPDF":
            guard let token = body["token"] as? String, let data = rendered[token] else { throw ExperienceError.invalidInput(NexoLocale.text("Actualiza la vista final antes de guardar.")) }
            let panel = NSSavePanel(); panel.allowedContentTypes = [.pdf]; panel.nameFieldStringValue = NexoLocale.text("Registro de asistencia.pdf")
            guard await panel.beginSheetModal(for: window) == .OK, let url = panel.url else { return ["cancelled": true] }
            try data.write(to: url, options: .atomic); return ["saved": true]
        default: throw ExperienceError.invalidInput(NexoLocale.text("Esta función no está disponible."))
        }
    }
    private func setupDrive(isQA: Bool) {
        do {
            let auth = try GoogleAuthorization(directory: directory, keychainService: isQA ? "org.nexo.google.qa" : "org.nexo.google", bundledConfiguration: Bundle.main.url(forResource: "GoogleOAuth", withExtension: "json"))
            google = auth
            let client = GoogleDriveClient(auth: auth); driveClient = client
            if let experience { drive = DriveCoordinator(store: experience.store, transport: client) }
            driveError = ""
        } catch { driveError = error.localizedDescription }
    }
    private func snapshotObject(_ snapshot: WorkspaceSnapshot) throws -> Any {
        var lightweight = snapshot; lightweight.driveReplicas = []
        return try object(lightweight)
    }
    private func driveStatus() throws -> [String: Any] {
        let snapshot = try experience?.load() ?? WorkspaceSnapshot()
        let spaces: [[String: Any]] = snapshot.driveReplicas.map { replica in
            var result: [String: Any] = ["organizationID": replica.organizationID.uuidString, "folderID": replica.folderID, "pending": replica.outbox.count, "canEdit": replica.canEdit, "paused": replica.isPaused == true, "error": NexoLocale.text(drive?.errors[replica.organizationID] ?? "")]
            if let date = drive?.checkedAt[replica.organizationID] ?? replica.lastSyncAt { result["lastSyncAt"] = ISO8601DateFormatter().string(from: date) }
            result["conflicts"] = replica.conflicts.map { key -> [String: Any] in
                ["key": key, "versions": replica.versions[key, default: []].map { version -> [String: Any] in
                    ["id": version.batchID.uuidString, "device": version.deviceName, "date": ISO8601DateFormatter().string(from: version.createdAt), "summary": DrivePresentation.conflictSummary(version.value, key: key, snapshot: snapshot)]
                }]
            }
            return result
        }
        return ["configured": google?.configured == true, "connected": google?.signedIn == true, "requiresKeychainAccess": google?.requiresKeychainAccess == true, "account": googleAccount, "error": NexoLocale.text(driveError), "spaces": spaces]
    }
    private func handleDrive(_ command: String, body: [String: Any]) async throws -> Any {
        func orgID() throws -> UUID {
            guard let raw = body["organizationID"] as? String, let id = UUID(uuidString: raw) else { throw DriveSyncError.wrongWorkspace }; return id
        }
        func response() throws -> Any {
            ["drive": try driveStatus(), "snapshot": try snapshotObject(experience?.load() ?? WorkspaceSnapshot())]
        }
        if command == "driveStatus" { return try driveStatus() }
        if command == "drivePreviewTemplate" {
            let id = try orgID()
            guard let snapshot = try experience?.load(), let key = body["key"] as? String, key.hasPrefix("template:"),
                  let raw = body["versionID"] as? String, let versionID = UUID(uuidString: raw),
                  let value = snapshot.driveReplicas.first(where: { $0.organizationID == id })?.versions[key]?.first(where: { $0.batchID == versionID })?.value,
                  let organization = snapshot.organizations.first(where: { $0.id == id }) else { throw DriveSyncError.wrongWorkspace }
            let template = try ExperienceStore.decoder().decode(DocumentTemplate.self, from: ExperienceStore.encoder().encode(value))
            let event = ActivityEvent(organizationID: id, title: NexoLocale.text("Vista de plantilla"), startsAt: .now, componentID: UUID())
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("nexo-template-\(UUID()).pdf")
            defer { try? FileManager.default.removeItem(at: url) }
            try AttendancePDF.render(organization: organization, event: event, entries: [], template: template, mode: .blank, language: NexoLocale.language, to: url)
            let data = try Data(contentsOf: url)
            guard let document = PDFDocument(data: data) else { throw ExperienceError.unavailable }
            return ["token": cache(data), "pageCount": document.pageCount, "image": try thumbnail(document, index: 0)]
        }
        guard let google, let driveClient else { throw GoogleDriveError.message(driveError.isEmpty ? NexoLocale.text("No se pudo preparar Drive.") : driveError) }
        do {
            switch command {
            case "driveImportConfiguration":
                let panel = NSOpenPanel(); panel.allowedContentTypes = [.json]; panel.allowsMultipleSelection = false
                guard await panel.beginSheetModal(for: window) == .OK, let url = panel.url else { return try response() }
                try google.importConfiguration(boundedData(url, limit: 100_000))
            case "driveEnterConfiguration":
                let alert = NSAlert(); alert.messageText = NexoLocale.text("Configuración de Google")
                alert.informativeText = NexoLocale.text("Datos del cliente de escritorio de Nexo.")
                let view = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 112))
                let idLabel = NSTextField(labelWithString: "Client ID"), secretLabel = NSTextField(labelWithString: "Client secret")
                let clientID = NSTextField(frame: NSRect(x: 0, y: 65, width: 420, height: 25))
                let secret = NSSecureTextField(frame: NSRect(x: 0, y: 10, width: 420, height: 25))
                clientID.setAccessibilityLabel("Client ID"); secret.setAccessibilityLabel("Client secret")
                idLabel.frame = NSRect(x: 0, y: 91, width: 420, height: 20); secretLabel.frame = NSRect(x: 0, y: 36, width: 420, height: 20)
                [idLabel, clientID, secretLabel, secret].forEach { view.addSubview($0) }
                alert.accessoryView = view; alert.addButton(withTitle: NexoLocale.text("Guardar")); alert.addButton(withTitle: NexoLocale.text("Cancelar"))
                guard await alert.beginSheetModal(for: window) == .alertFirstButtonReturn else { return try response() }
                let config: [String: Any] = ["installed": ["client_id": clientID.stringValue.trimmingCharacters(in: .whitespacesAndNewlines), "client_secret": secret.stringValue]]
                try google.importConfiguration(JSONSerialization.data(withJSONObject: config))
            case "driveConnect":
                if google.requiresKeychainAccess { try google.restoreStoredSession() }
                else { try await google.signIn() }
                guard google.signedIn else { throw GoogleDriveError.signIn }
                googleAccount = try await driveClient.account()
            case "driveDisconnect":
                guard drive?.syncing != true else { throw GoogleDriveError.message(NexoLocale.text("Espera a que termine la sincronización.")) }
                try google.disconnect(); googleAccount = ""
            case "driveSpaces": return try object(await driveClient.spaces())
            case "driveCreate":
                guard let experience, let drive, !drive.syncing else { throw ExperienceError.unavailable }
                let id = try orgID(), snapshot = try experience.load()
                guard !snapshot.driveReplicas.contains(where: { $0.organizationID == id }), let org = snapshot.organizations.first(where: { $0.id == id }) else { throw DriveSyncError.alreadyLinked }
                let alert = NSAlert(); alert.messageText = NexoLocale.text("Guardar en Drive")
                alert.informativeText = NexoLocale.text("Se subirán las personas, encuentros, asistencia y plantillas de {0} a la cuenta {1}.", org.name, googleAccount)
                alert.addButton(withTitle: NexoLocale.text("Subir espacio")); alert.addButton(withTitle: NexoLocale.text("Cancelar"))
                guard await alert.beginSheetModal(for: window) == .alertFirstButtonReturn else { return try response() }
                let folder = try await driveClient.createSpace(name: org.name, organizationID: id)
                try drive.activate(organizationID: id, folderID: folder.id)
                try await drive.sync(organizationID: id)
            case "driveJoin":
                guard let drive, let folderID = body["folderID"] as? String else { throw DriveSyncError.wrongWorkspace }
                let joined = try await drive.join(folderID: folderID)
                UserDefaults.standard.set(joined.uuidString, forKey: "activeOrganizationID")
                driveError = ""
                return ["drive": try driveStatus(), "snapshot": try snapshotObject(experience?.load() ?? WorkspaceSnapshot()), "openedOrganizationID": joined.uuidString]
            case "driveSync":
                guard let drive else { throw ExperienceError.unavailable }
                if googleAccount.isEmpty { googleAccount = try await driveClient.account() }
                try await drive.syncAvailable(organizationID: (body["organizationID"] as? String).flatMap(UUID.init(uuidString:)))
            case "drivePause":
                guard let drive else { throw ExperienceError.unavailable }
                try drive.setPaused(true, organizationID: orgID())
            case "driveResume":
                guard let drive else { throw ExperienceError.unavailable }
                let id = try orgID()
                let alert = NSAlert(); alert.messageText = NexoLocale.text("Reanudar Drive")
                alert.informativeText = NexoLocale.text("Se descargarán los cambios de Drive y se enviarán los cambios pendientes de este espacio. Las versiones en conflicto se conservarán para revisarlas.")
                alert.addButton(withTitle: NexoLocale.text("Reanudar")); alert.addButton(withTitle: NexoLocale.text("Cancelar"))
                guard await alert.beginSheetModal(for: window) == .alertFirstButtonReturn else { return try response() }
                try drive.setPaused(false, organizationID: id)
                try await drive.syncAvailable(organizationID: id)
            case "driveResolve":
                guard let drive, let key = body["key"] as? String, let raw = body["versionID"] as? String, let versionID = UUID(uuidString: raw),
                      let revision = body["expectedRevision"] as? NSNumber, try experience?.load().revision == revision.uint64Value else { throw ExperienceError.stale }
                try drive.resolve(organizationID: orgID(), key: key, versionID: versionID)
            case "driveOpenFolder":
                let id = try orgID()
                guard let folder = try experience?.load().driveReplicas.first(where: { $0.organizationID == id })?.folderID,
                      folder.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }),
                      let url = URL(string: "https://drive.google.com/drive/folders/" + folder) else { throw DriveSyncError.wrongWorkspace }
                NSWorkspace.shared.open(url)
            default: throw ExperienceError.invalidInput(NexoLocale.text("Esta función no está disponible."))
            }
            driveError = ""
            return try response()
        } catch {
            driveError = error.localizedDescription
            // A partial upload can have durably acknowledged earlier changes.
            // Return its current snapshot so the UI never keeps a stale revision.
            if command == "driveSync" || command == "driveCreate" { return try response() }
            throw error
        }
    }
    private func cache(_ data: Data) -> String {
        let token = UUID().uuidString; rendered[token] = data; renderOrder.append(token)
        while renderOrder.count > 4 { rendered.removeValue(forKey: renderOrder.removeFirst()) }
        return token
    }
    private func thumbnail(_ document: PDFDocument, index: Int) throws -> String {
        guard index >= 0, index < document.pageCount, let page = document.page(at: index) else { throw ExperienceError.invalidInput(NexoLocale.text("La página no existe.")) }
        let image = page.thumbnail(of: NSSize(width: 950, height: 1300), for: .mediaBox)
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { throw ExperienceError.invalidInput(NexoLocale.text("No se pudo mostrar la página.")) }
        return "data:image/png;base64," + png.base64EncodedString()
    }
    private func boundedData(_ url: URL, limit: Int) throws -> Data {
        let count = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard count <= limit else { throw ExperienceError.invalidInput(NexoLocale.text("El archivo supera el tamaño permitido ({0} MB).", limit / 1_000_000)) }
        return try Data(contentsOf: url)
    }
    private func object<T: Encodable>(_ value: T) throws -> Any { try JSONSerialization.jsonObject(with: ExperienceStore.encoder().encode(value)) }
    private func dateStamp() -> String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: .now) }
    private func installMenus() {
        let main = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu()
        appMenu.addItem(withTitle: NexoLocale.text("Acerca de Nexo"), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator()); appMenu.addItem(withTitle: NexoLocale.text("Salir de Nexo"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; main.addItem(appItem)
        let edit = NSMenuItem(); edit.title = NexoLocale.text("Edición"); let editMenu = NSMenu(title: NexoLocale.text("Edición"))
        for (title, selector, key) in [(NexoLocale.text("Deshacer"), "undo:", "z"), (NexoLocale.text("Cortar"), "cut:", "x"), (NexoLocale.text("Copiar"), "copy:", "c"), (NexoLocale.text("Pegar"), "paste:", "v"), (NexoLocale.text("Seleccionar todo"), "selectAll:", "a")] { editMenu.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key) }
        edit.submenu = editMenu; main.addItem(edit)
        let view = NSMenuItem(); view.title = NexoLocale.text("Ventana"); let viewMenu = NSMenu(title: NexoLocale.text("Ventana"))
        viewMenu.addItem(withTitle: NexoLocale.text("Minimizar"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        view.submenu = viewMenu; main.addItem(view)
        NSApplication.shared.mainMenu = main
    }
}
private struct PDFRequest: Decodable, Sendable {
    let organization: Organization; let event: ActivityEvent; let entries: [AttendanceEntry]; let template: DocumentTemplate; let mode: String
}
@MainActor
final class BundleScheme: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url, requestURL.host == "experience", let root = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true) else { urlSchemeTask.didFailWithError(URLError(.badURL)); return }
        let path = requestURL.path == "/" ? "index.html" : String(requestURL.path.dropFirst())
        let url = root.appendingPathComponent(path).standardizedFileURL
        guard url.path.hasPrefix(root.standardizedFileURL.path + "/"), let data = try? Data(contentsOf: url) else { urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist)); return }
        let mime = ["html": "text/html", "js": "text/javascript", "css": "text/css", "woff2": "font/woff2", "svg": "image/svg+xml", "png": "image/png"][url.pathExtension] ?? "application/octet-stream"
        urlSchemeTask.didReceive(URLResponse(url: requestURL, mimeType: mime, expectedContentLength: data.count, textEncodingName: mime.hasPrefix("text/") ? "utf-8" : nil))
        urlSchemeTask.didReceive(data); urlSchemeTask.didFinish()
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}
}
