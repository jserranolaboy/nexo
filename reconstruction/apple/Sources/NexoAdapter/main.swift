import Foundation
import NexoAdapterKit

@main
enum NexoAdapter {
    static func main() {
        do {
            let command = try NexoAdapterKit.command(Array(CommandLine.arguments.dropFirst()))
            let status = try launch(command)
            if status != 0 { exit(status) }
        } catch {
            fputs("\(error)\n", stderr)
            exit(1)
        }
    }
}

private func launch(_ command: KernelCommand) throws -> Int32 {
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
    FileHandle.standardOutput.write(output.fileHandleForReading.readDataToEndOfFile())
    FileHandle.standardError.write(errors.fileHandleForReading.readDataToEndOfFile())
    return process.terminationStatus
}
