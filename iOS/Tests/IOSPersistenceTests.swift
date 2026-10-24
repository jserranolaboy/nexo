import Foundation
import PDFKit
import UIKit
import WebKit
import XCTest
import NexoCore
import NexoKit
@testable import Nexo

@MainActor
final class IOSPersistenceTests: XCTestCase {
    /// Diagnose bundled module loading separately from the UI test's real tap.
    /// This WebView has no native bridge, account, synthetic seed, or user actions.
    func testBundledStudioModuleLoadsThroughApplicationScheme() throws {
        let root = try XCTUnwrap(Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true))
        let assets = try FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("assets"), includingPropertiesForKeys: nil)
        let modules = assets.filter { $0.lastPathComponent.hasPrefix("Studio-") && $0.pathExtension == "js" }
        guard modules.count == 1 else {
            XCTFail("The built application must contain exactly one Studio module")
            return
        }
        let module = try XCTUnwrap(modules.first)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.setURLSchemeHandler(BundleScheme(), forURLScheme: "valentina")
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 393, height: 793), configuration: configuration)
        let navigation = BundledPageNavigation()
        web.navigationDelegate = navigation
        defer { web.stopLoading(); web.navigationDelegate = nil }
        let page = try XCTUnwrap(URL(string: "valentina://experience/index.html"))
        web.load(URLRequest(url: page))
        guard XCTWaiter.wait(for: [navigation.finished], timeout: 20) == .completed else {
            XCTFail("Bundled application page did not finish loading")
            return
        }
        if let error = navigation.error { throw error }
        guard web.url == page else { XCTFail("Unexpected bundled page URL"); return }

        // The basic ObjC evaluation API avoids the unavailable Swift WebKit overlay
        // in the pinned simulator. A title result stays inside this isolated page.
        func javascriptString(_ value: String) throws -> String {
            try XCTUnwrap(String(data: JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed), encoding: .utf8))
        }
        let prefix = "NexoStudioDiagnostic-\(UUID().uuidString):"
        let moduleURL = "valentina://experience/assets/\(module.lastPathComponent)"
        let started = XCTestExpectation(description: "Bundled Studio diagnostic started")
        var evaluationError: Error?
        var evaluationStarted = false
        web.evaluateJavaScript("""
            (() => {
              const moduleURL = \(try javascriptString(moduleURL));
              const prefix = \(try javascriptString(prefix));
              const finish = result => { document.title = prefix + JSON.stringify(result); };
              let timer;
              Promise.race([
                import(moduleURL),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Studio module import timed out')), 15000); })
              ]).then(
                module => finish({ exportType: typeof module.DocumentStudio, href: location.href }),
                error => finish({ error: String(error), href: location.href })
              ).finally(() => clearTimeout(timer));
            })();
            true;
            """) { value, error in
                evaluationError = error
                evaluationStarted = value as? Bool == true
                started.fulfill()
            }
        guard XCTWaiter.wait(for: [started], timeout: 20) == .completed else {
            XCTFail("Bundled Studio diagnostic did not start")
            return
        }
        if let error = evaluationError { throw error }
        guard evaluationStarted else { XCTFail("Unexpected JavaScript startup result"); return }
        let imported = XCTNSPredicateExpectation(predicate: NSPredicate(format: "title BEGINSWITH %@", prefix), object: web)
        guard XCTWaiter.wait(for: [imported], timeout: 20) == .completed else {
            XCTFail("Bundled Studio evaluation did not complete")
            return
        }
        let title = try XCTUnwrap(web.title)
        let text = String(title.dropFirst(prefix.count))
        let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: String])
        XCTAssertNil(decoded["error"], text)
        XCTAssertEqual(decoded["exportType"], "function", text)
        XCTAssertEqual(decoded["href"], page.absoluteString, text)
    }

    func testDraftSurvivesRestartWithoutSavingOrUploadingTemplate() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try WorkspaceStore(directory: root)
        let orgID = UUID()
        let snapshot = try store.perform(["kind":"createOrganization", "id":orgID.uuidString, "name":"Prueba iOS"], expectedRevision: 0)
        var template = DocumentTemplate(organizationID: orgID, name: "Borrador sin guardar")
        template.footerText = "Edición recuperable"
        let object = try JSONSerialization.jsonObject(with: WorkspaceStore.encoder().encode(template))
        let drafts = IOSDraftStore(directory: root)
        try drafts.save(["dirty":true, "organizationID":orgID.uuidString, "template":object])
        let reopened = try IOSDraftStore(directory: root).read()
        XCTAssertEqual((reopened?["template"] as? [String:Any])?["footerText"] as? String, "Edición recuperable")
        XCTAssertEqual(try WorkspaceStore(directory: root).load(), snapshot)
        XCTAssertTrue(try store.load().driveReplicas.isEmpty)
        try drafts.save(["dirty": false])
        XCTAssertNil(try drafts.read())
    }
    func testUIKitPDFRendersEveryRowAndCanBeReopened() throws {
        let org = Organization(name: "Equipo iOS")
        let event = ActivityEvent(organizationID: org.id, title: "Encuentro de prueba", startsAt: .now, componentID: UUID())
        let entries = (1...55).map { AttendanceEntry(eventID: event.id, memberID: UUID(), status: $0 == 1 ? .excused : .present, note: "Nota de la persona \($0)", memberNameSnapshot: "Persona \($0)") }
        var template = DocumentTemplate(organizationID: org.id, name: "Lista", columns: [.participant, .excused, .notes])
        template.headerTitle = "Lista de asistencia"
        template.footerText = "Nexo para iOS"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ios-pdf-\(UUID()).pdf")
        defer { try? FileManager.default.removeItem(at: url) }
        try AttendancePDF.render(organization: org, event: event, entries: entries, template: template, mode: .completed, to: url)
        let attachment = XCTAttachment(data: try Data(contentsOf: url), uniformTypeIdentifier: "com.adobe.pdf")
        attachment.name = "Nexo-iOS-attendance.pdf"; attachment.lifetime = .keepAlways; add(attachment)
        let pdf = try XCTUnwrap(PDFDocument(url: url))
        XCTAssertGreaterThan(pdf.pageCount, 1)
        let text = pdf.string ?? ""
        XCTAssertTrue(text.contains("Persona 55"))
        XCTAssertTrue(text.contains("Lista de asistencia"))
        XCTAssertTrue(text.contains("Nota de la persona 55"))
        XCTAssertNotNil(pdf.page(at: 0)?.thumbnail(of: CGSize(width: 612, height: 792), for: .mediaBox).pngData())
    }
}

@MainActor
private final class BundledPageNavigation: NSObject, WKNavigationDelegate {
    let finished = XCTestExpectation(description: "Bundled application page loaded")
    private(set) var error: Error?
    private var completed = false
    private func finish(_ error: Error? = nil) {
        guard !completed else { return }
        completed = true
        self.error = error
        finished.fulfill()
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finish() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(error) }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        let bundled = url?.scheme == "valentina" && url?.host == "experience"
        if !bundled { finish(URLError(.unsupportedURL)) }
        decisionHandler(bundled ? .allow : .cancel)
    }
}
