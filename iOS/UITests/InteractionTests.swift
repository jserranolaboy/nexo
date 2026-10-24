import XCTest

/// Only the hosted CI helper selects this test, on a NEW account-free simulator.
/// It uses the real bundled WebView and bridge, with no seed or test app hooks.
@MainActor
final class FreshInstallSmokeTests: XCTestCase {
    func testSpaceAndPersonPersistAcrossRelaunch() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("Fresh-install mutations require a disposable simulator")
        #endif
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["NEXO_FRESH_SIMULATOR_SMOKE"] == "1" else {
            XCTFail("Use the hosted CI helper to create a new isolated simulator")
            return
        }
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(es)", "-AppleLocale", "es_PR"]
        defer { app.terminate() }
        let suffix = String(UUID().uuidString.prefix(8))
        let spaceName = "Nexo CI Space \(suffix)"
        let personName = "Nexo CI Person \(suffix)"

        func visible(_ label: String, file: StaticString = #filePath, line: UInt = #line) {
            let element = app.webViews.descendants(matching: .any)
                .matching(NSPredicate(format: "label == %@", label)).firstMatch
            XCTAssertTrue(element.waitForExistence(timeout: 15), "Missing \(label)\n\(app.debugDescription)", file: file, line: line)
        }
        func readyToTap(_ element: XCUIElement, label: String, file: StaticString = #filePath, line: UInt = #line) {
            // Existence alone does not establish an enabled, onscreen hit target.
            let ready = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == true AND enabled == true AND hittable == true"),
                object: element
            )
            // A single hosted accessibility evaluation can consume nearly 15 seconds.
            let started = ProcessInfo.processInfo.systemUptime
            let result = XCTWaiter.wait(for: [ready], timeout: 30)
            print("Readiness observation for \(label): \(result), \(ProcessInfo.processInfo.systemUptime - started)s")
            XCTAssertEqual(result, .completed, "Control is not ready: \(label)\n\(app.debugDescription)", file: file, line: line)
        }
        func tap(_ label: String, file: StaticString = #filePath, line: UInt = #line) {
            let button = app.webViews.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
            readyToTap(button, label: label, file: file, line: line)
            button.tap()
        }
        func type(_ value: String, into label: String, file: StaticString = #filePath, line: UInt = #line) {
            let field = app.webViews.textFields.matching(NSPredicate(format: "label == %@", label)).firstMatch
            readyToTap(field, label: label, file: file, line: line)
            field.tap()
            field.typeText(value)
            // Observe the complete input before submitting; never retype a prefix.
            let complete = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: field)
            let result = XCTWaiter.wait(for: [complete], timeout: 8)
            XCTAssertEqual(result, .completed, "Incomplete input for \(label)\n\(app.debugDescription)")
            XCTAssertEqual(field.value as? String, value, "The complete text must reach \(label)")
        }

        app.launch()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30))
        // Fail before any mutation if this is not the ordinary empty-workspace screen.
        tap("Crear espacio")
        type(spaceName, into: "Nombre del espacio")
        tap("Crear")
        visible(spaceName)
        for area in ["Encuentros", "Personas", "Documentos"] { visible(area) }
        tap("Personas")
        visible("Sin personas")
        tap("Nueva persona")
        type(personName, into: "Nombre completo")
        tap("Añadir")
        visible(personName)

        // A new app process must load both native mutations from its own container.
        app.terminate()
        app.launch()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30))
        visible(spaceName)
        XCTAssertFalse(app.webViews.buttons["Crear espacio"].exists)
        tap("Personas")
        visible(personName)
        XCTAssertFalse(app.webViews.staticTexts["Sin personas"].exists)
    }
}

/// Preview-only integration on a separate NEW account-free hosted simulator.
/// This never opens an export picker, sends a file, or injects application data.
@MainActor
final class FreshDocumentPreviewTests: XCTestCase {
    func testBlankDocumentRendersNativeFinalPreview() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("Document preview mutations require a disposable simulator")
        #endif
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["NEXO_FRESH_PDF_PREVIEW"] == "1" else {
            XCTFail("Use the hosted CI helper to create a new isolated preview simulator")
            return
        }
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(es)", "-AppleLocale", "es_PR"]
        defer { app.terminate() }
        let suffix = String(UUID().uuidString.prefix(8))
        let spaceName = "Nexo PDF Space \(suffix)"
        let eventName = "Nexo PDF Event \(suffix)"
        let componentName = "Nexo PDF Component \(suffix)"

        func button(_ label: String) -> XCUIElement {
            app.webViews.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
        }
        func visible(_ label: String, file: StaticString = #filePath, line: UInt = #line) {
            let element = app.webViews.descendants(matching: .any)
                .matching(NSPredicate(format: "label == %@", label)).firstMatch
            XCTAssertTrue(element.waitForExistence(timeout: 15), "Missing \(label)\n\(app.debugDescription)", file: file, line: line)
        }
        func ready(_ element: XCUIElement, label: String, file: StaticString = #filePath, line: UInt = #line) {
            let expectation = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == true AND enabled == true AND hittable == true"),
                object: element
            )
            // Keep the complete readiness condition while allowing a costly AX observation.
            let started = ProcessInfo.processInfo.systemUptime
            let result = XCTWaiter.wait(for: [expectation], timeout: 30)
            print("Readiness observation for \(label): \(result), \(ProcessInfo.processInfo.systemUptime - started)s")
            XCTAssertEqual(result, .completed, "Control is not ready: \(label)\n\(app.debugDescription)", file: file, line: line)
        }
        func tap(_ label: String, file: StaticString = #filePath, line: UInt = #line) {
            let control = button(label)
            ready(control, label: label, file: file, line: line)
            control.tap()
        }
        @discardableResult
        func type(_ value: String, into label: String, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
            let field = app.webViews.textFields.matching(NSPredicate(format: "label == %@", label)).firstMatch
            ready(field, label: label, file: file, line: line)
            field.tap()
            field.typeText(value)
            let complete = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: field)
            XCTAssertEqual(XCTWaiter.wait(for: [complete], timeout: 8), .completed,
                           "Incomplete input for \(label)\n\(app.debugDescription)", file: file, line: line)
            XCTAssertEqual(field.value as? String, value, file: file, line: line)
            return field
        }

        app.launch()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30))
        tap("Crear espacio")
        type(spaceName, into: "Nombre del espacio")
        tap("Crear")
        visible(spaceName)

        tap("Nuevo encuentro")
        type(eventName, into: "Nombre del encuentro")
        tap("Crear componente")
        let componentField = type(componentName, into: "Crear componente")
        // One Return submits only the inline component, not the event form.
        componentField.typeText("\n")
        visible(componentName)
        tap("Crear")
        visible(eventName)

        tap("Documento")
        func documentState(_ stage: String) {
            let blank = button("Hoja en blanco")
            let loading = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Abriendo plantilla")).firstMatch
            let recovery = app.webViews.staticTexts["No se pudo mostrar Nexo"]
            print("Nexo PDF transition \(stage): blank=\(blank.exists), frame=\(blank.exists ? String(describing: blank.frame) : "absent"), save=\(button("Guardar").exists), loading=\(loading.exists), recovery=\(recovery.exists)\n\(app.debugDescription)")
        }
        documentState("before blank-page tap")
        tap("Hoja en blanco")
        documentState("after blank-page tap")
        tap("Guardar")
        // Observe the committed-save notification immediately; never retry Save.
        visible("Plantilla guardada")
        // WebKit exposes the aria-pressed preview control as a switch.
        let previewToggle = app.webViews.switches.matching(NSPredicate(format: "label == %@", "Revisar PDF")).firstMatch
        ready(previewToggle, label: "Revisar PDF")
        previewToggle.tap()

        let preview = app.webViews.images.matching(NSPredicate(format: "label == %@", "Vista final, página 1")).firstMatch
        XCTAssertTrue(preview.waitForExistence(timeout: 30), "Missing native final preview\n\(app.debugDescription)")
        XCTAssertFalse(preview.frame.isEmpty)
        visible("1 / 1")
        // Readiness is asserted without tapping: no document picker or outbound export.
        ready(button("Compartir PDF"), label: "Compartir PDF")
        for label in ["Página anterior", "Página siguiente"] {
            let control = button(label)
            XCTAssertTrue(control.waitForExistence(timeout: 15), "Missing \(label)\n\(app.debugDescription)")
            XCTAssertFalse(control.isEnabled, "A one-page preview must not enable \(label)")
        }
        XCTAssertFalse(button("Volver al diseño").exists, "The final preview must not be an error state")
    }
}

/// Run only on a simulator populated with synthetic data using seed-simulator.mjs.
/// These tests do not connect an account or upload files.
@MainActor
final class InteractionTests: XCTestCase {
    private var app: XCUIApplication!
    override func setUp() async throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(es)", "-AppleLocale", "es_PR"]
        app.launch()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(element("Continuar en Círculo · Pruebas").waitForExistence(timeout: 10), "Requires an isolated synthetic simulator workspace")
        tap("Continuar en Círculo · Pruebas")
    }
    private func element(_ label: String) -> XCUIElement {
        app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }
    private func visible(_ label: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element(label).waitForExistence(timeout: 5), "Expected \(label)\n\(app.debugDescription)", file: file, line: line)
    }
    private func tap(_ label: String) { visible(label); element(label).tap() }
    private func drag(_ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat, speed: XCUIGestureVelocity = .slow) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: x1, dy: y1))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: x2, dy: y2))
        start.press(forDuration: 0.06, thenDragTo: end, withVelocity: speed, thenHoldForDuration: 0.12)
    }
    private func dayLabel(_ offset: Int) -> String {
        let date = Calendar.current.date(byAdding: .day, value: offset, to: .now)!
        let format = DateFormatter(); format.locale = Locale(identifier: "es"); format.dateFormat = "EEEE, d 'de' MMMM"
        return format.string(from: date)
    }
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    func testContentSwipeTraversesPagesAndReturns() {
        visible("Crear encuentro")
        drag(0.86, 0.58, 0.14, 0.58)
        visible("Añadir persona")
        drag(0.86, 0.35, 0.14, 0.35)
        visible("Cálculo de asistencia")
        drag(0.86, 0.30, 0.14, 0.30)
        visible("Nueva plantilla")
        drag(0.86, 0.56, 0.14, 0.56)
        visible("Crear componente")
        capture("05-organizacion")
        drag(0.14, 0.55, 0.86, 0.55)
        visible("Nueva plantilla")
    }
    func testDockCanBeScrubbedAcrossSeveralTabs() {
        drag(0.13, 0.91, 0.88, 0.91)
        visible("Crear componente")
        drag(0.88, 0.91, 0.31, 0.91)
        visible("Añadir persona")
        capture("02-personas")
    }
    func testDockDragStartsOnAnUnselectedItemAndReverses() {
        // Press Personas while Encuentros is selected, then slide to Plantillas.
        // The destination is under the finger, independent of the old selection.
        drag(0.31, 0.91, 0.70, 0.91)
        visible("Nueva plantilla")
        drag(0.70, 0.91, 0.31, 0.91)
        visible("Añadir persona")
    }
    func testShortDragCancelsAndVerticalScrollDoesNotNavigate() {
        drag(0.65, 0.58, 0.60, 0.58)
        visible("Crear encuentro")
        drag(0.50, 0.78, 0.50, 0.37)
        visible("Primera jornada")
        capture("01-calendario-desplazado")
        // Returning to this page retains its scroll position.
        tap("Personas")
        visible("Añadir persona")
        tap("Encuentros")
        XCTAssertTrue(element("Primera jornada").isHittable)
    }
    func testWeekSwipeStaysInsideCalendar() {
        tap("Semana siguiente")
        visible(dayLabel(7))
        drag(0.15, 0.42, 0.85, 0.42)
        visible(dayLabel(0))
        visible("Crear encuentro")
    }
    func testEventTabsSwipeWithoutChangingWorkspaceSection() {
        tap("Jornada de bienestar")
        visible("Añadir personas")
        drag(0.86, 0.65, 0.14, 0.65)
        visible("Añadir interesados")
        visible("Jornada de bienestar")
        capture("04-voluntariado")
        drag(0.14, 0.65, 0.86, 0.65)
        visible("Añadir personas")
    }
    func testTableConsumesItsOwnHorizontalScroll() {
        tap("Asistencia")
        visible("Cálculo de asistencia")
        drag(0.85, 0.64, 0.20, 0.64)
        visible("Cálculo de asistencia")
        XCTAssertFalse(element("Nueva plantilla").exists)
        capture("03-tabla")
    }
    func testCreateDialogAndKeyboardDoNotChangePage() {
        tap("Crear encuentro")
        capture("06-crear-encuentro")
        drag(0.83, 0.45, 0.17, 0.45)
        visible("Cerrar")
        tap("Cerrar")
        visible("Crear encuentro")
        tap("Buscar en el espacio")
        visible("Búsqueda global")
        capture("07-busqueda")
        tap("Cerrar")
        visible("Crear encuentro")
    }
    func testDarkModeAndRotationKeepNavigationUsable() {
        tap("En este iPhone")
        tap("Oscuro")
        capture("08-aspecto-oscuro")
        tap("Cerrar")
        drag(0.86, 0.58, 0.14, 0.58)
        visible("Añadir persona")
        XCUIDevice.shared.orientation = .landscapeLeft
        visible("Añadir persona")
        capture("09-horizontal")
        XCUIDevice.shared.orientation = .portrait
        visible("Añadir persona")
    }
}

/// Navigation only. Does not edit records, choose another space or open Drive.
@MainActor
final class PhysicalDockTests: XCTestCase {
    func testDockTracksTheFingerOnConnectedIPhone() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("This check requires the connected physical iPhone")
        #else
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let open = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ OR label BEGINSWITH %@", "Continuar en ", "Continue in ")).firstMatch
        XCTAssertTrue(open.waitForExistence(timeout: 15))
        open.tap()
        let templates = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR label == %@", "Nueva plantilla", "New template")).firstMatch
        let people = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR label == %@", "Añadir persona", "Add person")).firstMatch
        func drag(_ x1: CGFloat, _ x2: CGFloat) {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: x1, dy: 0.91))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: x2, dy: 0.91))
            start.press(forDuration: 0.06, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.12)
        }
        // Starts over an unselected tab; relative-to-old-selection tracking fails here.
        drag(0.31, 0.70)
        XCTAssertTrue(templates.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(templates.isHittable)
        XCTAssertFalse(people.exists)
        drag(0.70, 0.31)
        XCTAssertTrue(people.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(people.isHittable)
        XCTAssertFalse(templates.exists)
        // Touch handling must preserve ordinary taps after scrubbing.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.70, dy: 0.91)).tap()
        XCTAssertTrue(templates.waitForExistence(timeout: 5))
        XCTAssertTrue(templates.isHittable)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.31, dy: 0.91)).tap()
        XCTAssertTrue(people.waitForExistence(timeout: 5))
        XCTAssertTrue(people.isHittable)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "barra-iphone-fisico"; attachment.lifetime = .keepAlways
        add(attachment)
        #endif
    }
}

/// Creates templates only inside the dedicated synthetic simulator workspace.
@MainActor
final class TemplateExperienceTests: XCTestCase {
    private var app: XCUIApplication!
    private func element(_ label: String) -> XCUIElement {
        app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }
    private func tap(_ label: String, file: StaticString = #filePath, line: UInt = #line) {
        let target = element(label)
        XCTAssertTrue(target.waitForExistence(timeout: 8), "Missing \(label)\n\(app.debugDescription)", file: file, line: line)
        target.tap()
    }
    private func launch(_ language: String) throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("Template changes require an isolated simulator")
        #endif
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(\(language))", "-AppleLocale", language == "es" ? "es_PR" : "en_US"]
        app.launch()
        let continueLabel = language == "es" ? "Continuar en Círculo · Pruebas" : "Continue in Círculo · Pruebas"
        if element(continueLabel).waitForExistence(timeout: 30) {
            tap(continueLabel)
        } else {
            // A failed prior run can legitimately recover its local draft.
            tap(language == "es" ? "Volver a plantillas" : "Back to templates")
            let discard = language == "es" ? "Salir sin guardar" : "Leave without saving"
            if element(discard).waitForExistence(timeout: 2) { tap(discard) }
            XCTAssertTrue(app.webViews.buttons["Círculo · Pruebas"].exists, "Requires the synthetic simulator workspace")
        }
    }
    private func replace(_ label: String, value: String) {
        let field = app.webViews.textFields.matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), app.debugDescription)
        field.tap()
        // Tapping the trailing inset places the caret after the complete value.
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.5)).tap()
        let existing = field.value as? String ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count) + value)
        XCTAssertEqual(field.value as? String, value)
    }
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    func testEnglishTemplateEditingSavingAndPDFPreview() throws {
        try launch("en")
        tap("Templates"); tap("New template")
        XCTAssertTrue(element("Review PDF").waitForExistence(timeout: 5))
        capture("template-en-editor")
        app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Document preview")).firstMatch.pinch(withScale: 1.8, velocity: 1)
        XCTAssertTrue(element("Fit page to screen").waitForExistence(timeout: 5))
        capture("template-en-zoom")
        tap("Fit page to screen")
        tap("Edit template name")
        let templateName = "Mobile · QA " + String(UUID().uuidString.prefix(6))
        replace("Name", value: templateName)
        replace("Title", value: "Annual attendance")
        tap("Close")
        tap("Elements"); tap("Add text")
        let text = app.webViews.textViews.matching(NSPredicate(format: "label == %@", "Text")).firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        XCTAssertTrue(text.isHittable)
        text.typeText(" · verified")
        XCTAssertGreaterThan(text.frame.height, 60)
        XCTAssertGreaterThanOrEqual(text.frame.minY, 62)
        XCTAssertTrue(element("Close").isHittable)
        XCTAssertLessThanOrEqual(text.frame.maxY, app.keyboards.firstMatch.frame.minY)
        capture("template-en-keyboard")
        tap("Close")
        tap("Save")
        let saved = expectation(for: NSPredicate(format: "enabled == false"), evaluatedWith: app.webViews.buttons["Save"])
        wait(for: [saved], timeout: 5)
        tap("Review PDF")
        XCTAssertTrue(element("Final preview, page 1").waitForExistence(timeout: 10))
        XCTAssertTrue(element("Share PDF").isEnabled)
        capture("template-en-pdf")
        tap("Back to templates")
        let card = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", templateName)).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        app.terminate(); app.launch()
        tap("Continue in Círculo · Pruebas"); tap("Templates"); card.tap()
        XCTAssertTrue(element("Annual attendance").waitForExistence(timeout: 5))
    }
    func testSpanishPanelsColumnChangesAndUndo() throws {
        try launch("es")
        tap("Plantillas"); tap("Nueva plantilla")
        tap("Columnas")
        capture("template-es-columnas")
        tap("Opciones de columna Presente"); tap("Quitar columna")
        XCTAssertFalse(app.webViews.textFields["Título de columna Presente"].exists)
        tap("Cerrar")
        tap("Deshacer")
        tap("Columnas")
        XCTAssertTrue(app.webViews.textFields["Título de columna Presente"].waitForExistence(timeout: 5))
        tap("Formato")
        XCTAssertTrue(element("Posición de la lista").exists)
        capture("template-es-formato")
        tap("Cerrar")
        tap("Volver a plantillas"); tap("Salir sin guardar")
        XCTAssertTrue(element("Nueva plantilla").waitForExistence(timeout: 5))
    }
    func testDarkNavigationAndTemplateLayout() throws {
        try launch("en")
        tap("On this iPhone"); tap("Dark"); tap("Close")
        let start = app.coordinate(withNormalizedOffset: CGVector(dx:0.31,dy:0.91))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx:0.70,dy:0.91))
        start.press(forDuration:0.06, thenDragTo:end, withVelocity:.slow, thenHoldForDuration:0.12)
        XCTAssertTrue(element("New template").waitForExistence(timeout:5))
        capture("dock-dark-translucent")
        tap("New template"); tap("Layout")
        capture("template-en-dark-layout")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(element("Row height").exists)
        capture("template-landscape")
        XCUIDevice.shared.orientation = .portrait
        tap("Close"); tap("Back to templates"); tap("Leave without saving")
        tap("On this iPhone"); tap("Automatic"); tap("Close")
    }
}

/// Field geometry and keyboard checks use only an isolated synthetic workspace.
@MainActor
final class FieldExperienceTests: XCTestCase {
    private var app: XCUIApplication!
    private func element(_ label: String) -> XCUIElement {
        app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }
    private func tap(_ label: String) {
        let target = element(label)
        XCTAssertTrue(target.waitForExistence(timeout: 8), "Missing \(label)\n\(app.debugDescription)")
        target.tap()
    }
    private func launch(_ language: String) throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("Field editing requires an isolated synthetic simulator")
        #endif
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(\(language))", "-AppleLocale", language == "es" ? "es_PR" : "en_US"]
        app.launch()
        let start = language == "es" ? "Continuar en Círculo · Pruebas" : "Continue in Círculo · Pruebas"
        XCTAssertTrue(element(start).waitForExistence(timeout: 30), "Requires the isolated synthetic workspace after cold simulator startup")
        tap(start)
    }
    private func capture(_ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
    }
    private func checkBounds(_ field: XCUIElement, minHeight: CGFloat = 44) {
        XCTAssertGreaterThanOrEqual(field.frame.height, minHeight)
        XCTAssertGreaterThanOrEqual(field.frame.minX, 0)
        XCTAssertLessThanOrEqual(field.frame.maxX, app.frame.width)
        XCTAssertTrue(field.isHittable)
    }
    private func expectValue(_ field: XCUIElement, _ value: String) {
        let complete = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: field)
        let result = XCTWaiter.wait(for: [complete], timeout: 8)
        if result != .completed { capture("fields-incomplete-input") }
        XCTAssertEqual(field.value as? String, value, "The complete text must reach the field")
        XCTAssertEqual(result, .completed)
    }
    private func eventForm(_ language: String) throws {
        try launch(language)
        let spanish = language == "es"
        tap(spanish ? "Crear encuentro" : "Create event")
        XCTAssertFalse(app.keyboards.firstMatch.exists, "Opening a form must not force the software keyboard")
        let name = app.webViews.textFields[spanish ? "Nombre" : "Name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        checkBounds(name)
        for field in app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR label == %@", "Fecha y hora", "Date and time")).allElementsBoundByIndex {
            if field.elementType != .staticText { checkBounds(field) }
        }
        capture("fields-\(language)-event")
        name.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8), "Wait for the software keyboard before injecting text")
        let text = "Jornada de participación - información y orientación"
        name.typeText(text)
        expectValue(name, text)
        XCTAssertTrue(element(spanish ? "Cerrar" : "Close").isHittable, "The header remains accessible with the keyboard")
        checkBounds(name)
        if app.keyboards.firstMatch.exists {
            XCTAssertLessThanOrEqual(name.frame.maxY, app.keyboards.firstMatch.frame.minY)
        }
        capture("fields-\(language)-event-keyboard")
        tap(spanish ? "Cerrar" : "Close")
        XCTAssertTrue(element(spanish ? "Crear encuentro" : "Create event").waitForExistence(timeout: 5))
    }
    func testEnglishEventFieldsAndKeyboard() throws { try eventForm("en") }
    func testSpanishEventFieldsAndKeyboard() throws { try eventForm("es") }
    func testSearchCanBeClearedAndReused() throws {
        try launch("en")
        tap("People")
        let search = app.webViews.searchFields["Search people"]
        XCTAssertTrue(search.waitForExistence(timeout: 5), app.debugDescription)
        checkBounds(search)
        search.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8))
        search.typeText("Ana")
        expectValue(search, "Ana")
        tap("Clear search")
        XCTAssertNotEqual(search.value as? String, "Ana")
        search.typeText("Lucía")
        expectValue(search, "Lucía")
        capture("fields-search")
        tap("Clear search")
    }
    func testTemplateFieldsMultilineAndRotation() throws {
        try launch("es")
        tap("Plantillas"); tap("Nueva plantilla"); tap("Documento")
        let name = app.webViews.textFields["Nombre"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        checkBounds(name)
        let footer = app.webViews.textViews["Pie de página"]
        XCTAssertTrue(footer.exists)
        checkBounds(footer, minHeight: 90)
        footer.tap(); footer.typeText("Primera línea\nSegunda línea\nFirma de la coordinación")
        let complete = expectation(for: NSPredicate(format: "value CONTAINS %@", "Segunda línea"), evaluatedWith: footer)
        wait(for: [complete], timeout: 8)
        XCTAssertTrue((footer.value as? String)?.contains("Segunda línea") == true)
        XCTAssertTrue(element("Cerrar").isHittable)
        capture("fields-template-multiline")
        tap("Cerrar")
        XCUIDevice.shared.orientation = .landscapeLeft
        capture("fields-template-landscape")
        XCUIDevice.shared.orientation = .portrait
        tap("Volver a plantillas"); tap("Salir sin guardar")
        XCTAssertTrue(element("Nueva plantilla").waitForExistence(timeout: 5))
    }
}
