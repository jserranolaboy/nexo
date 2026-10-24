import Foundation

// shortcut: shells out to Node on the Mac; move the same journey to the simulator only when that runtime can run this kernel.

private let usage = "Uso: nexo-adapter journey|show --directory DIR --kernel DIR [--node PATH] [--lang es|en]"

@main
enum NexoAdapter {
    static func main() {
        do {
            let status = try run(Array(CommandLine.arguments.dropFirst()))
            if status != 0 { exit(status) }
        } catch {
            fputs("\(error)\n", stderr)
            exit(1)
        }
    }
}

private struct Invocation {
    var command: String
    var directory: URL
    var kernel: URL
    var node: URL
    var lang: String
}

private func run(_ arguments: [String]) throws -> Int32 {
    let invocation = try parse(arguments)
    try validate(invocation.directory, kernel: invocation.kernel)
    let cli = invocation.kernel.appendingPathComponent("src/cli.ts")
    guard FileManager.default.isReadableFile(atPath: cli.path) else {
        throw AdapterError("No está el núcleo: \(cli.path)")
    }
    let process = Process()
    process.executableURL = invocation.node
    process.arguments = [
        "--experimental-strip-types",
        cli.path,
        invocation.command,
        "--directory", invocation.directory.path,
        "--lang", invocation.lang,
    ]
    process.currentDirectoryURL = invocation.kernel
    let temporary = NSTemporaryDirectory()
    process.environment = [
        "PATH": invocation.node.deletingLastPathComponent().path + ":/usr/bin:/bin",
        "HOME": temporary,
        "TMPDIR": temporary,
        "LANG": "en_US.UTF-8",
    ]
    let output = Pipe()
    let errors = Pipe()
    process.standardOutput = output
    process.standardError = errors
    try process.run()
    process.waitUntilExit()
    FileHandle.standardOutput.write(output.fileHandleForReading.readDataToEndOfFile())
    FileHandle.standardError.write(errors.fileHandleForReading.readDataToEndOfFile())
    return process.terminationStatus
}

private func parse(_ arguments: [String]) throws -> Invocation {
    guard let command = arguments.first, command == "journey" || command == "show" else {
        throw AdapterError(usage)
    }
    var directory = ""
    var kernel = ProcessInfo.processInfo.environment["NEXO_KERNEL"] ?? ""
    var node = ProcessInfo.processInfo.environment["NEXO_NODE"] ?? ""
    var lang = "es"
    var index = 1
    while index < arguments.count {
        let token = arguments[index]
        index += 1
        guard index < arguments.count else { throw AdapterError(usage) }
        let value = arguments[index]
        index += 1
        switch token {
        case "--directory": directory = value
        case "--kernel": kernel = value
        case "--node": node = value
        case "--lang": lang = value
        default: throw AdapterError(usage)
        }
    }
    guard !directory.isEmpty, !kernel.isEmpty, lang == "es" || lang == "en" else {
        throw AdapterError(usage)
    }
    return Invocation(
        command: command,
        directory: URL(fileURLWithPath: directory),
        kernel: URL(fileURLWithPath: kernel),
        node: try resolveNode(node),
        lang: lang
    )
}

private func resolveNode(_ explicit: String) throws -> URL {
    if !explicit.isEmpty {
        guard FileManager.default.isExecutableFile(atPath: explicit) else {
            throw AdapterError("No está node: \(explicit)")
        }
        return URL(fileURLWithPath: explicit)
    }
    for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        where FileManager.default.isExecutableFile(atPath: candidate) {
        return URL(fileURLWithPath: candidate)
    }
    throw AdapterError("No está node. Pasa --node o NEXO_NODE.")
}

private func validate(_ directory: URL, kernel: URL) throws {
    let dir = directory.standardizedFileURL.resolvingSymlinksInPath()
    let kern = kernel.standardizedFileURL.resolvingSymlinksInPath()
    let path = dir.path
    let banned = [
        "/Library/Application Support/",
        "/Documents/Codex/",
        "/Documents/ChatGPT/",
        "/Applications/Nexo.app",
        "Valentina-Experience",
        "Nexo-AppBuilds",
        "Nexo-DataBackups",
        "VRR-Next-AppBuilds",
        "workspace-v1.json",
        "vrr-data.json",
    ]
    let roots = temporaryRoots()
    let insideTemporary = roots.contains { path != $0 && path.hasPrefix($0 + "/") }
    let insideKernel = path == kern.path || path.hasPrefix(kern.path + "/")
    let checkout = FileManager.default.fileExists(atPath: dir.appendingPathComponent(".git").path)
    if !insideTemporary || insideKernel || checkout || banned.contains(where: { path.contains($0) }) {
        throw AdapterError("Directorio rechazado. Hace falta un temporal sintético, fuera del núcleo y de los datos reales.")
    }
}

private func temporaryRoots() -> [String] {
    [
        FileManager.default.temporaryDirectory.standardizedFileURL.resolvingSymlinksInPath().path,
        URL(fileURLWithPath: NSTemporaryDirectory()).standardizedFileURL.resolvingSymlinksInPath().path,
        URL(fileURLWithPath: "/tmp").resolvingSymlinksInPath().path,
        "/private/tmp",
    ].map { $0.hasSuffix("/") ? String($0.dropLast()) : $0 }
}

private struct AdapterError: Error, CustomStringConvertible {
    var description: String
    init(_ description: String) { self.description = description }
}
