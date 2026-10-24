import XCTest

final class JourneyTests: XCTestCase {
    func testFirstJourneyIsReadByAnotherProcess() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("nexo-adapter-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let binary = try adapterBinary()
        let kernel = reconstructionDirectory().path
        let wrote = try launch(binary, ["journey", "--directory", directory.path, "--kernel", kernel, "--lang", "es"])
        XCTAssertEqual(wrote.status, 0, wrote.error)
        XCTAssertNotEqual(wrote.pid, ProcessInfo.processInfo.processIdentifier)
        XCTAssertTrue(wrote.output.contains("Espacio sintético guardado"))

        let primary = directory.appendingPathComponent("nexo-reconstruction-v1.json")
        let before = try Data(contentsOf: primary)
        XCTAssertTrue(String(decoding: before, as: UTF8.self).contains("\"schema\": \"nexo-reconstruction-v1\""))
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("workspace-v1.json").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("vrr-data.json").path))

        let read = try launch(binary, ["show", "--directory", directory.path, "--kernel", kernel, "--lang", "es"])
        XCTAssertEqual(read.status, 0, read.error)
        XCTAssertNotEqual(read.pid, wrote.pid)
        XCTAssertNotEqual(read.pid, ProcessInfo.processInfo.processIdentifier)
        XCTAssertTrue(read.output.contains("Persona Alfa: presente; 1/1"), read.output)
        XCTAssertTrue(read.output.contains("Persona Beta: ausente; 0/1"), read.output)
        XCTAssertTrue(read.output.contains("Persona Gamma: sin registro; sin encuentros evaluables"), read.output)
        XCTAssertEqual(try Data(contentsOf: primary), before)
    }

    func testInterfaceIsReadByAnotherProcess() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("nexo-adapter-interface-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let binary = try adapterBinary()
        let kernel = reconstructionDirectory().path
        let wrote = try launch(binary, ["interface", "--directory", directory.path, "--kernel", kernel, "--lang", "es"])
        XCTAssertEqual(wrote.status, 0, wrote.error)
        XCTAssertNotEqual(wrote.pid, ProcessInfo.processInfo.processIdentifier)
        assertInterface(wrote.output, restarted: false)

        let read = try launch(binary, ["interface-show", "--directory", directory.path, "--kernel", kernel, "--lang", "es"])
        XCTAssertEqual(read.status, 0, read.error)
        XCTAssertNotEqual(read.pid, wrote.pid)
        assertInterface(read.output, restarted: true)

        let english = try launch(binary, ["interface-show", "--directory", directory.path, "--kernel", kernel, "--lang", "en"])
        XCTAssertEqual(english.status, 0, english.error)
        XCTAssertNotEqual(english.pid, read.pid)
        XCTAssertTrue(english.output.contains("Persona Alfa: present; 1/1"), english.output)
        XCTAssertTrue(english.output.contains("Persona Gamma: no record; no countable encounters"), english.output)
        XCTAssertFalse(english.output.contains("Persona Gamma: absent"))
        XCTAssertTrue(english.output.contains("Does not fit: Persona Alfa\nLinea uno\nLinea dos\nLinea tres\nLinea cuatro"), english.output)
        XCTAssertTrue(english.output.contains("Suggestion: Persona Tardía"), english.output)
        XCTAssertTrue(english.output.contains("selected in Encuentro actual"), english.output)
        XCTAssertTrue(english.output.contains("Quota refusal: capacity-exceeded"), english.output)
        XCTAssertTrue(english.output.contains("Sync: paused"), english.output)
        XCTAssertTrue(english.output.contains("Pending uploads: none"), english.output)
        XCTAssertTrue(english.output.contains("alternativa-local"), english.output)
        XCTAssertFalse(english.output.contains("alternativa-remota"))
        XCTAssertFalse(english.output.contains("Persona Beta: present"))
    }

    func testRealDataDirectoriesAreRefused() throws {
        let binary = try adapterBinary()
        let kernel = reconstructionDirectory().path
        let refused = NSHomeDirectory() + "/Library/Application Support/Nexo-adapter-must-not-write"
        defer { try? FileManager.default.removeItem(atPath: refused) }
        let result = try launch(binary, ["journey", "--directory", refused, "--kernel", kernel, "--lang", "es"])
        XCTAssertNotEqual(result.status, 0)
        XCTAssertTrue(result.error.contains("rechazado"), result.error)
        XCTAssertFalse(FileManager.default.fileExists(atPath: refused))
    }
}

private func assertInterface(_ output: String, restarted: Bool) {
    XCTAssertTrue(output.contains("Persona Alfa: presente; 1/1"), output)
    XCTAssertTrue(output.contains("Persona Beta: ausente; 0/1"), output)
    XCTAssertTrue(output.contains("Persona Gamma: sin registro; sin encuentros evaluables"), output)
    XCTAssertFalse(output.contains("Persona Gamma: ausente"))
    XCTAssertFalse(output.contains("Persona Beta: presente"))
    XCTAssertTrue(output.contains("Borrador: Nota breve"), output)
    XCTAssertTrue(output.contains("PDF: export.pdf"), output)
    XCTAssertTrue(output.contains("No cabe: Persona Alfa\nLinea uno\nLinea dos\nLinea tres\nLinea cuatro"), output)
    XCTAssertTrue(output.contains("Sugerencia: Persona Tardía"), output)
    XCTAssertTrue(output.contains("Persona Cero: seleccionado en Encuentro actual"), output)
    XCTAssertTrue(output.contains("Rechazo de cupo: capacity-exceeded"), output)
    XCTAssertTrue(output.contains("Sincronización: en pausa"), output)
    XCTAssertTrue(output.contains("Subidas pendientes: ninguna"), output)
    XCTAssertTrue(output.contains("alternativa-local"), output)
    if restarted {
        XCTAssertFalse(output.contains("alternativa-remota"))
    } else {
        XCTAssertTrue(output.contains("alternativa-remota"), output)
        XCTAssertTrue(output.contains("Alternativa elegida: alternativa-local"), output)
        XCTAssertTrue(output.contains("Copia nueva anterior restaurada"), output)
    }
}

private struct Launch {
    var status: Int32
    var pid: Int32
    var output: String
    var error: String
}

private func launch(_ binary: URL, _ arguments: [String]) throws -> Launch {
    let process = Process()
    process.executableURL = binary
    process.arguments = arguments
    let output = Pipe()
    let errors = Pipe()
    process.standardOutput = output
    process.standardError = errors
    try process.run()
    let pid = process.processIdentifier
    process.waitUntilExit()
    return Launch(
        status: process.terminationStatus,
        pid: pid,
        output: String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self),
        error: String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    )
}

private func reconstructionDirectory() -> URL {
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
}

private func adapterBinary() throws -> URL {
    if let env = ProcessInfo.processInfo.environment["NEXO_ADAPTER_BIN"],
       FileManager.default.isExecutableFile(atPath: env) {
        return URL(fileURLWithPath: env)
    }
    let names = ["nexo-adapter", "NexoAdapter"]
    var seen = Set<String>()
    for bundle in Bundle.allBundles {
        var url = bundle.bundleURL
        for _ in 0..<8 {
            if !seen.insert(url.path).inserted { break }
            for name in names {
                let candidate = url.appendingPathComponent(name)
                if FileManager.default.isExecutableFile(atPath: candidate.path) {
                    return candidate
                }
            }
            let parent = url.deletingLastPathComponent()
            if parent.path == url.path { break }
            url = parent
        }
    }
    throw TestError("No está nexo-adapter. Bundles: \(Bundle.allBundles.map(\.bundlePath))")
}

private struct TestError: Error, CustomStringConvertible {
    var description: String
    init(_ description: String) { self.description = description }
}
