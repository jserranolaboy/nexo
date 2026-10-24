import AppKit
import Foundation
import Darwin

// This smoke is restricted to a new GitHub-hosted VM, not a user's Mac.
// Foundation, preferences and WebKit may use the runner's real home directory.
@main
@MainActor
struct PackagedMacSmoke {
    struct Failure: Error, CustomStringConvertible {
        let description: String
        init(_ description: String) { self.description = description }
    }

    static func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        if !condition() { throw Failure(message) }
    }

    static func main() {
        do { try run() }
        catch {
            FileHandle.standardError.write(Data("Packaged Mac smoke failed: \(error)\n".utf8))
            exit(1)
        }
    }

    static func run() throws {
        let environment = ProcessInfo.processInfo.environment
        try require(environment["GITHUB_ACTIONS"] == "true" && environment["RUNNER_ENVIRONMENT"] == "github-hosted" && environment["RUNNER_OS"] == "macOS", "Requires a fresh GitHub-hosted macOS runner")
        try require(environment["NEXO_LIVE_DRIVE_TEST"] == "0", "Live Drive must remain disabled")
        try require(environment["CFFIXED_USER_HOME"] == nil, "Do not substitute the Foundation home directory")
        try require(CommandLine.arguments.count == 2, "Pass exactly one packaged Nexo.app path")
        guard let temporary = environment["RUNNER_TEMP"] else { throw Failure("RUNNER_TEMP is missing") }
        let files = FileManager.default
        let temporaryURL = URL(fileURLWithPath: temporary, isDirectory: true).resolvingSymlinksInPath().standardizedFileURL
        let app = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true).resolvingSymlinksInPath().standardizedFileURL
        try require(app.path.hasPrefix(temporaryURL.path + "/") && app.lastPathComponent == "Nexo.app", "App must be inside owned runner temporary storage")
        guard let bundle = Bundle(url: app) else { throw Failure("App bundle is unreadable") }
        let identifier = "org.vrr.valentina.experience"
        try require(bundle.bundleIdentifier == identifier, "Unexpected application identity")
        let executable = app.appendingPathComponent("Contents/MacOS/Nexo").resolvingSymlinksInPath().standardizedFileURL
        try require(executable.path.hasPrefix(app.path + "/Contents/MacOS/") && executable.lastPathComponent == "Nexo", "Executable must remain inside the owned app")
        try require(files.isExecutableFile(atPath: executable.path), "Nexo executable is missing")
        try require(!files.fileExists(atPath: app.appendingPathComponent("Contents/Resources/GoogleOAuth.json").path) && bundle.url(forResource: "GoogleOAuth", withExtension: "json") == nil, "OAuth configuration must not be packaged, including localized resources")
        try require(NSWorkspace.shared.runningApplications.allSatisfy { $0.bundleIdentifier != identifier }, "An existing Nexo process must not be disturbed")

        let home = files.homeDirectoryForCurrentUser.resolvingSymlinksInPath().standardizedFileURL
        try require(environment["HOME"] == home.path, "Runner HOME must match Foundation's real home")
        guard let support = files.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.resolvingSymlinksInPath().standardizedFileURL else { throw Failure("Application Support is unavailable") }
        try require(support.path == home.appendingPathComponent("Library/Application Support").path, "Unexpected Application Support location")
        for name in ["Valentina-Experience", "Valentina-Experience-QA", "VRR-Next-Preview", "VRR", "Nexo", "Nexo-DataBackups", "Nexo-AppBuilds"] {
            let path = support.appendingPathComponent(name)
            try require(!files.fileExists(atPath: path.path) && (try? files.attributesOfItem(atPath: path.path)) == nil, "Existing app data prevents this fresh-install smoke: \(name)")
        }
        let preferences = home.appendingPathComponent("Library/Preferences/\(identifier).plist")
        try require(!files.fileExists(atPath: preferences.path), "Existing Nexo preferences prevent this smoke")
        let dataDirectory = support.appendingPathComponent("Valentina-Experience", isDirectory: true)
        let primary = dataDirectory.appendingPathComponent("workspace-v1.json")
        let logURL = temporaryURL.appendingPathComponent("nexo-macos-launch-\(UUID().uuidString).log")
        try Data().write(to: logURL, options: .withoutOverwriting)
        let log = try FileHandle(forWritingTo: logURL)
        defer { try? log.close() }
        let process = Process()
        process.executableURL = executable
        process.currentDirectoryURL = app
        // Do not forward Actions tokens or unrelated runner credentials to the app.
        process.environment = environment.filter { ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "LOGNAME", "RUNNER_TRACKING_ID"].contains($0.key) }
        process.standardOutput = log
        process.standardError = log
        var launched = false
        defer {
            if launched && process.isRunning {
                process.terminate()
                let deadline = Date().addingTimeInterval(5)
                while process.isRunning && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
                if process.isRunning {
                    _ = kill(process.processIdentifier, SIGKILL)
                    let forcedDeadline = Date().addingTimeInterval(5)
                    while process.isRunning && Date() < forcedDeadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
                }
                if process.isRunning {
                    FileHandle.standardError.write(Data("Owned app process did not terminate; runner cleanup required\n".utf8))
                    exit(1)
                }
            }
            // This exact directory was verified absent before our only launch.
            // Never remove unrelated preferences, caches, accounts or app paths.
            if launched {
                do {
                    try require(dataDirectory.resolvingSymlinksInPath().standardizedFileURL.path == support.appendingPathComponent("Valentina-Experience").path, "Owned data directory changed location; refusing cleanup")
                    if files.fileExists(atPath: dataDirectory.path) { try files.removeItem(at: dataDirectory) }
                    try require(!files.fileExists(atPath: dataDirectory.path), "Owned data directory was not removed")
                    print("Owned app process stopped and test-created store removed")
                } catch {
                    FileHandle.standardError.write(Data("Owned startup cleanup failed: \(error)\n".utf8))
                    exit(1)
                }
            }
        }
        try process.run()
        launched = true
        print("Started packaged Nexo process \(process.processIdentifier)")
        let deadline = Date().addingTimeInterval(30)
        var ready = false
        while Date() < deadline && process.isRunning {
            if let running = NSRunningApplication(processIdentifier: process.processIdentifier), running.isFinishedLaunching,
               running.activationPolicy == .regular, running.bundleIdentifier == identifier,
               running.executableURL?.resolvingSymlinksInPath().path == executable.path,
               files.fileExists(atPath: primary.path) {
                ready = true
                break
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        try require(ready && process.isRunning, "Owned app did not finish native startup with a local store")
        guard let snapshot = try JSONSerialization.jsonObject(with: Data(contentsOf: primary)) as? [String: Any] else { throw Failure("Fresh store is not JSON") }
        try require((snapshot["schemaVersion"] as? NSNumber)?.intValue == 1 && (snapshot["revision"] as? NSNumber)?.uint64Value == 0, "Unexpected initial store version")
        let collections = ["organizations", "periods", "members", "groups", "memberships", "components", "categories", "events", "attendance", "volunteers", "collaborators", "templates", "syncStates", "driveReplicas", "resolvedSyncConflicts"]
        for key in collections { try require((snapshot[key] as? [Any])?.isEmpty == true, "Fresh store contains unexpected \(key)") }
        let observation = Date().addingTimeInterval(3)
        while Date() < observation && process.isRunning { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
        try require(process.isRunning, "Packaged app exited immediately after startup")
        try log.synchronize()
        let output = try String(contentsOf: logURL, encoding: .utf8)
        try require(!output.contains("Nexo interface error:"), "Web interface reported an error during startup")
        print("Packaged native startup and fresh empty store verified; this is not visual WebKit or Gatekeeper validation")
    }
}
