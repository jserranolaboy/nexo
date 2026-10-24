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
