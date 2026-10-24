import Foundation
import NexoAdapterKit

enum MacKernel {
    static func press(directory: URL, action: String, lang: String) -> String {
        do {
            let command = try NexoAdapterKit.command([
                "interface-press",
                "--directory", directory.path,
                "--kernel", kernelDirectory().path,
                "--node", nodePath(),
                "--lang", lang,
                "--action", action,
            ])
            return try launch(command)
        } catch {
            return "Error: \(error)"
        }
    }

    private static func kernelDirectory() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private static func nodePath() -> String {
        ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"].first {
            FileManager.default.isExecutableFile(atPath: $0)
        } ?? ""
    }

    private static func launch(_ command: KernelCommand) throws -> String {
        let process = Process()
        process.executableURL = command.node
        process.arguments = command.arguments
        process.currentDirectoryURL = command.workingDirectory
        let temporary = NSTemporaryDirectory()
        process.environment = [
            "PATH": command.node.deletingLastPathComponent().path + ":/usr/bin:/bin",
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
        let stdout = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        let stderr = String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        if process.terminationStatus != 0 {
            let message = stderr.isEmpty ? stdout : stderr
            return "Error: \(message.trimmingCharacters(in: .whitespacesAndNewlines))"
        }
        return stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
