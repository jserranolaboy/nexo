import Foundation

// shortcut: iOS compiles this command and does not launch Node. Run it on a simulator only after that runtime is installed.

public struct KernelCommand: Sendable {
    public var node: URL
    public var arguments: [String]
    public var workingDirectory: URL

    public init(node: URL, arguments: [String], workingDirectory: URL) {
        self.node = node
        self.arguments = arguments
        self.workingDirectory = workingDirectory
    }
}

public enum NexoAdapterKit {
    public static let usage = "Uso: nexo-adapter COMANDO --directory DIR --kernel DIR [--node PATH] [--lang es|en] [--source PATH] [--version ID]"

    public static func command(_ arguments: [String]) throws -> KernelCommand {
        let invocation = try parse(arguments)
        try validate(invocation.directory, kernel: invocation.kernel)
        let cli = invocation.kernel.appendingPathComponent("src/cli.ts")
        guard FileManager.default.isReadableFile(atPath: cli.path) else {
            throw AdapterError("No está el núcleo: \(cli.path)")
        }
        var forwarded = [
            "--experimental-strip-types",
            cli.path,
            invocation.command,
            "--directory", invocation.directory.path,
            "--lang", invocation.lang,
        ]
        if !invocation.source.isEmpty { forwarded.append(contentsOf: ["--source", invocation.source]) }
        if !invocation.version.isEmpty { forwarded.append(contentsOf: ["--version", invocation.version]) }
        return KernelCommand(
            node: invocation.node,
            arguments: forwarded,
            workingDirectory: invocation.kernel
        )
    }
}

private struct Invocation {
    var command: String
    var directory: URL
    var kernel: URL
    var node: URL
    var lang: String
    var source: String
    var version: String
}

private func parse(_ arguments: [String]) throws -> Invocation {
    guard let command = arguments.first, !command.isEmpty, !command.hasPrefix("-") else {
        throw AdapterError(NexoAdapterKit.usage)
    }
    var directory = ""
    var kernel = ProcessInfo.processInfo.environment["NEXO_KERNEL"] ?? ""
    var node = ProcessInfo.processInfo.environment["NEXO_NODE"] ?? ""
    var lang = "es"
    var source = ""
    var version = ""
    var index = 1
    while index < arguments.count {
        let token = arguments[index]
        index += 1
        guard index < arguments.count else { throw AdapterError(NexoAdapterKit.usage) }
        let value = arguments[index]
        index += 1
        switch token {
        case "--directory": directory = value
        case "--kernel": kernel = value
        case "--node": node = value
        case "--lang": lang = value
        case "--source": source = value
        case "--version": version = value
        default: throw AdapterError(NexoAdapterKit.usage)
        }
    }
    guard !directory.isEmpty, !kernel.isEmpty, lang == "es" || lang == "en" else {
        throw AdapterError(NexoAdapterKit.usage)
    }
    return Invocation(
        command: command,
        directory: URL(fileURLWithPath: directory),
        kernel: URL(fileURLWithPath: kernel),
        node: try resolveNode(node),
        lang: lang,
        source: source,
        version: version
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

public struct AdapterError: Error, CustomStringConvertible, Sendable {
    public var description: String
    public init(_ description: String) { self.description = description }
}
