import UIKit
import WebKit
import PDFKit
import UniformTypeIdentifiers
import ExperienceKit
import VRRCore

@MainActor
final class ExperienceViewController: UIViewController, WKScriptMessageHandlerWithReply, WKNavigationDelegate, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    private var web: WKWebView!
    private var experience: ExperienceStore?
    private var startupError: String?
    private var rendered: [String: Data] = [:]
    private var renderOrder: [String] = []
    private let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Nexo", isDirectory: true)
    private lazy var drafts = IOSDraftStore(directory: directory)
    private let google = IOSGoogleAuthorization()
    private var driveClient: GoogleDriveClient?
    private var drive: DriveCoordinator?
    private var driveError = ""
    private var googleAccount = ""
    private var pickerContinuation: CheckedContinuation<URL?, Never>?
    private var restoringSession: Task<Void, Never>?
    private var appearancePreference: String {
        let value = UserDefaults.standard.string(forKey: "appearance") ?? "system"
        return ["system", "light", "dark"].contains(value) ? value : "system"
    }
    private func applyAppearance(_ value: String) {
        overrideUserInterfaceStyle = value == "dark" ? .dark : value == "light" ? .light : .unspecified
        setNeedsStatusBarAppearanceUpdate()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        applyAppearance(appearancePreference)
        view.backgroundColor = .systemGroupedBackground
        do {
            experience = try ExperienceStore(directory: directory)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: directory.path)
        } catch { startupError = NexoLocale.text("El espacio no se pudo abrir. Recupera una copia; conservaremos el archivo actual.") }
        setupDrive()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addScriptMessageHandler(BridgeProxy(target: self), contentWorld: .page, name: "valentina")
        let device = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        configuration.userContentController.addUserScript(WKUserScript(source: "window.nexoLocale='\(NexoLocale.language)';window.nexoPlatform='ios';window.nexoDevice='\(device)';window.nexoAppearance='\(appearancePreference)';", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.setURLSchemeHandler(BundleScheme(), forURLScheme: "valentina")
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.scrollView.bounces = false
        web.scrollView.showsVerticalScrollIndicator = false
        web.scrollView.showsHorizontalScrollIndicator = false
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = false
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        // Let UIKit resize the workspace with the keyboard animation. This
        // keeps fixed sheets anchored and avoids WebKit panning the whole page.
        view.keyboardLayoutGuide.usesBottomSafeArea = false
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), web.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        restoringSession = Task {
            await google.restore()
            _ = try? await web.evaluateJavaScript("window.dispatchEvent(new Event('nexo-session-restored'))")
        }
        web.load(URLRequest(url: URL(string: "valentina://experience/index.html")!))
    }
    @objc private func keyboardChanged(_ notification: Notification) {
        let frame = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
        let local = view.convert(frame, from: nil)
        let visible = notification.name != UIResponder.keyboardWillHideNotification && local.minY < view.bounds.height - 120 && local.maxY >= view.bounds.height - 2 && local.width > view.bounds.width * 0.7
        web.evaluateJavaScript("window.nexoKeyboardVisible=\(visible ? "true" : "false");window.dispatchEvent(new Event('nexo-keyboard'))", completionHandler: nil)
    }
    deinit { NotificationCenter.default.removeObserver(self) }
    override var preferredStatusBarStyle: UIStatusBarStyle { .default }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard navigationAction.request.url?.scheme == "valentina", navigationAction.request.url?.host == "experience" else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "valentina", message.frameInfo.securityOrigin.host == "experience",
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
        case "selectionFeedback":
            UISelectionFeedbackGenerator().selectionChanged()
            return ["ok": true]
        case "appearance":
            guard let value = body["value"] as? String, ["system", "light", "dark"].contains(value) else { throw ExperienceError.invalidInput(NexoLocale.text("Aspecto no válido.")) }
            UserDefaults.standard.set(value, forKey: "appearance")
            applyAppearance(value)
            return ["ok": true]
        case "interfaceError":
            NSLog("Nexo interface error: %@", String((body["message"] as? String ?? "Unknown").prefix(500)))
            return ["ok": true]
        case "draftState":
            try drafts.save(body); return ["ok": true]
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
            return try await exportData(WorkspaceTransfer.export(experience.load()), name: "Nexo-\(dateStamp()).json")
        case "restoreWorkspace":
            guard drive?.syncing != true else { throw GoogleDriveError.message(NexoLocale.text("Espera a que termine la sincronización.")) }
            guard let url = await pick(types: [.json]) else { return ["cancelled": true] }
            let store = experience?.store ?? SnapshotStore(directory: directory)
            let candidate = try WorkspaceTransfer.inspect(at: url)
            guard await confirm(title: NexoLocale.text("Recuperar esta copia"), message: NexoLocale.text("Contiene {0} espacios, {1} personas y {2} encuentros. Conservaremos el archivo actual. El contenido actual se reemplazará; conservaremos una copia anterior. Drive quedará en pausa, con su historial y cambios pendientes intactos.", candidate.organizations.count, candidate.members.count, candidate.events.count), action: NexoLocale.text("Recuperar")) else { return ["cancelled": true] }
            _ = try WorkspaceTransfer.restore(candidate, into: store)
            experience = try ExperienceStore(directory: directory)
            startupError = nil
            setupDrive()
            return ["restored": true]
        case "importPDF":
            guard let url = await pick(types: [.pdf]) else { return ["cancelled": true] }
            let data = try boundedData(url, limit: 8_000_000)
            guard let document = PDFDocument(data: data), document.pageCount > 0, !document.isLocked else { throw ExperienceError.invalidInput(NexoLocale.text("El PDF no se puede abrir o está protegido.")) }
            var pages: [[String: Any]] = []
            for index in 0..<document.pageCount {
                let bounds = document.page(at: index)!.bounds(for: .mediaBox)
                pages.append(["width": bounds.width, "height": bounds.height])
            }
            guard let index = pages.firstIndex(where: { ($0["width"] as? CGFloat ?? 0) >= 240 && ($0["height"] as? CGFloat ?? 0) >= 200 }) else { throw ExperienceError.invalidInput(NexoLocale.text("El PDF no tiene una página donde pueda colocarse la lista.")) }
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
            guard let url = await pick(types: [.png, .jpeg]) else { return ["cancelled": true] }
            let data = try boundedData(url, limit: 8_000_000)
            guard let image = UIImage(data: data), let png = image.pngData() else { throw ExperienceError.invalidInput(NexoLocale.text("La imagen no se puede abrir.")) }
            guard png.count <= 2_000_000 else { throw ExperienceError.invalidInput(NexoLocale.text("La imagen debe ocupar menos de 2 MB.")) }
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
            return try await exportData(data, name: NexoLocale.text("Registro de asistencia.pdf"))
        default: throw ExperienceError.invalidInput(NexoLocale.text("Esta función no está disponible."))
        }
    }
    private func setupDrive() {
        google.presenter = self
        let client = GoogleDriveClient(auth: google); driveClient = client
        if let experience { drive = DriveCoordinator(store: experience.store, transport: client) }
        driveError = ""
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
        return ["configured": google.configured, "connected": google.signedIn, "requiresKeychainAccess": false, "account": googleAccount, "error": NexoLocale.text(driveError), "spaces": spaces]
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
        guard let driveClient else { throw GoogleDriveError.message(driveError.isEmpty ? NexoLocale.text("No se pudo preparar Drive.") : driveError) }
        do {
            switch command {
            case "driveConnect":
                await restoringSession?.value
                try await google.signIn()
                googleAccount = try await driveClient.account()
            case "driveDisconnect":
                await restoringSession?.value
                guard drive?.syncing != true else { throw GoogleDriveError.message(NexoLocale.text("Espera a que termine la sincronización.")) }
                google.disconnect(); googleAccount = ""
            case "driveSpaces": return try object(await driveClient.spaces())
            case "driveCreate":
                guard let experience, let drive, !drive.syncing else { throw ExperienceError.unavailable }
                let id = try orgID(), snapshot = try experience.load()
                guard !snapshot.driveReplicas.contains(where: { $0.organizationID == id }), let org = snapshot.organizations.first(where: { $0.id == id }) else { throw DriveSyncError.alreadyLinked }
                guard await confirm(title: NexoLocale.text("Guardar en Drive"), message: NexoLocale.text("Se subirán las personas, encuentros, asistencia y plantillas de {0} a la cuenta {1}.", org.name, googleAccount), action: NexoLocale.text("Subir espacio")) else { return try response() }
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
                guard await confirm(title: NexoLocale.text("Reanudar Drive"), message: NexoLocale.text("Se descargarán los cambios de Drive y se enviarán los cambios pendientes de este espacio. Las versiones en conflicto se conservarán para revisarlas."), action: NexoLocale.text("Reanudar")) else { return try response() }
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
                await UIApplication.shared.open(url)
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
        let image = page.thumbnail(of: CGSize(width: 950, height: 1300), for: .mediaBox)
        guard let png = image.pngData() else { throw ExperienceError.invalidInput(NexoLocale.text("No se pudo mostrar la página.")) }
        return "data:image/png;base64," + png.base64EncodedString()
    }
    private func boundedData(_ url: URL, limit: Int) throws -> Data {
        let count = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard count <= limit else { throw ExperienceError.invalidInput(NexoLocale.text("El archivo supera el tamaño permitido ({0} MB).", limit / 1_000_000)) }
        let data = try Data(contentsOf: url)
        guard data.count <= limit else { throw ExperienceError.invalidInput(NexoLocale.text("El archivo es demasiado grande.")) }
        return data
    }
    private func object<T: Encodable>(_ value: T) throws -> Any { try JSONSerialization.jsonObject(with: ExperienceStore.encoder().encode(value)) }
    private func dateStamp() -> String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: .now) }
    private func pick(types: [UTType]) async -> URL? {
        guard pickerContinuation == nil else { return nil }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        return await presentPicker(picker)
    }
    private func presentPicker(_ picker: UIDocumentPickerViewController) async -> URL? {
        picker.delegate = self; picker.allowsMultipleSelection = false
        picker.presentationController?.delegate = self
        return await withCheckedContinuation { continuation in
            pickerContinuation = continuation
            present(picker, animated: true)
        }
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let continuation = pickerContinuation; pickerContinuation = nil
        continuation?.resume(returning: urls.first)
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        let continuation = pickerContinuation; pickerContinuation = nil
        continuation?.resume(returning: nil)
    }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        let continuation = pickerContinuation; pickerContinuation = nil
        continuation?.resume(returning: nil)
    }
    private func exportData(_ data: Data, name: String) async throws -> [String: Bool] {
        guard pickerContinuation == nil else { throw ExperienceError.invalidInput(NexoLocale.text("Cierra el selector de archivos antes de continuar.")) }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let url = folder.appendingPathComponent(name)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        let result = await presentPicker(UIDocumentPickerViewController(forExporting: [url], asCopy: true))
        return result == nil ? ["cancelled": true] : ["saved": true]
    }
    private func confirm(title: String, message: String, action: String) async -> Bool {
        await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: NexoLocale.text("Cancelar"), style: .cancel) { _ in continuation.resume(returning: false) })
            alert.addAction(UIAlertAction(title: action, style: .default) { _ in continuation.resume(returning: true) })
            present(alert, animated: true)
        }
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

@MainActor
private final class BridgeProxy: NSObject, WKScriptMessageHandlerWithReply {
    weak var target: ExperienceViewController?
    init(target: ExperienceViewController) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let target else { replyHandler(nil, NexoLocale.text("El espacio se cerró.")); return }
        target.userContentController(userContentController, didReceive: message, replyHandler: replyHandler)
    }
}
