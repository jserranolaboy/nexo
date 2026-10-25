import Darwin
import Foundation
import JavaScriptCore

public enum EmbeddedKernel {
    public static func press(directory: URL, action: String, lang: String) -> String {
        call(directory, "globalThis.nexoPress(\(jsonString(action)), \(jsonString(lang)))")
    }

    public static func submit(directory: URL, payload: String) -> String {
        call(directory, "globalThis.nexoForm(\(jsonString(payload)))")
    }

    private static func call(_ directory: URL, _ script: String) -> String {
        let root = directory.standardizedFileURL.resolvingSymlinksInPath()
        let context = JSContext()!
        let bridge = FileBridge(root: root)
        let function: @convention(block) (String, String) -> String = { op, payload in
            bridge.call(op, payload)
        }
        context.setObject(function, forKeyedSubscript: "nexoFs" as NSString)
        context.evaluateScript("globalThis.NEXO_DIRECTORY = \(jsonString(root.path));")
        let source = loadSource()
        if source.isEmpty { return "Error: missing-kernel" }
        context.evaluateScript(source)
        if let exception = context.exception {
            return "Error: \(exception.toString() ?? "javascript")"
        }
        context.exception = nil
        let value = context.evaluateScript(script)
        if let exception = context.exception {
            return "Error: \(exception.toString() ?? "javascript")"
        }
        return value?.toString() ?? "Error: empty"
    }

    private static func loadSource() -> String {
        if let url = Bundle.module.url(forResource: "kernel", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8),
           !source.isEmpty {
            return source
        }
        let beside = Bundle.main.bundleURL.appendingPathComponent("kernel.js")
        if let source = try? String(contentsOf: beside, encoding: .utf8), !source.isEmpty {
            return source
        }
        return ""
    }

    private static func jsonString(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value])
        let wrapped = String(data: data ?? Data("[]".utf8), encoding: .utf8) ?? "[]"
        return String(wrapped.dropFirst().dropLast())
    }
}

private final class FileBridge: @unchecked Sendable {
    let root: URL
    var opened = Set<Int32>()

    init(root: URL) {
        self.root = root
    }

    func call(_ op: String, _ payload: String) -> String {
        guard let raw = payload.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else {
            return json(ok: false, code: "EIO")
        }
        func text(_ key: String) -> String { object[key] as? String ?? "" }
        func number(_ key: String) -> Int { (object[key] as? NSNumber)?.intValue ?? -1 }
        do {
            switch op {
            case "read":
                guard let url = file(text("path")) else { return json(ok: false, code: "EPERM") }
                let data = try Data(contentsOf: url)
                return json(ok: true, data: data.base64EncodedString())
            case "write":
                guard let url = file(text("path")) else { return json(ok: false, code: "EPERM") }
                let encoded = text("data")
                let data = encoded.isEmpty ? Data() : Data(base64Encoded: encoded)
                guard let data else { return json(ok: false, code: "EIO") }
                try data.write(to: url, options: .atomic)
                return json(ok: true)
            case "exists":
                guard let url = file(text("path")) else { return json(ok: true, data: false) }
                return json(ok: true, data: FileManager.default.fileExists(atPath: url.path))
            case "mkdir":
                guard let url = file(text("path")) else { return json(ok: false, code: "EPERM") }
                try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
                return json(ok: true)
            case "rename":
                guard let from = file(text("from")), let to = file(text("to")) else { return json(ok: false, code: "EPERM") }
                if FileManager.default.fileExists(atPath: to.path) {
                    try FileManager.default.removeItem(at: to)
                }
                try FileManager.default.moveItem(at: from, to: to)
                return json(ok: true)
            case "unlink":
                guard let url = file(text("path")) else { return json(ok: false, code: "EPERM") }
                try FileManager.default.removeItem(at: url)
                return json(ok: true)
            case "readdir":
                guard let url = file(text("path")) else { return json(ok: false, code: "EPERM") }
                let names = try FileManager.default.contentsOfDirectory(atPath: url.path)
                return json(ok: true, data: names)
            case "open":
                guard let url = file(text("path")) else { return json(ok: false, code: "EPERM") }
                let fd = url.path.withCString { Darwin.open($0, O_CREAT | O_EXCL | O_WRONLY, mode_t(0o644)) }
                if fd < 0 { return json(ok: false, code: errno == EEXIST ? "EEXIST" : "EIO") }
                opened.insert(fd)
                return json(ok: true, data: Int(fd))
            case "writefd":
                let fd = Int32(number("fd"))
                guard opened.contains(fd) else { return json(ok: false, code: "EBADF") }
                let bytes = Array(text("data").utf8)
                let wrote = bytes.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, $0.count) }
                if wrote < 0 { return json(ok: false, code: "EIO") }
                return json(ok: true)
            case "close":
                let fd = Int32(number("fd"))
                guard opened.contains(fd) else { return json(ok: false, code: "EBADF") }
                _ = Darwin.close(fd)
                opened.remove(fd)
                return json(ok: true)
            default:
                return json(ok: false, code: "EIO")
            }
        } catch {
            return json(ok: false, code: "EIO")
        }
    }

    private func file(_ path: String) -> URL? {
        guard !path.isEmpty else { return nil }
        let url = URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath()
        let rootPath = root.standardizedFileURL.resolvingSymlinksInPath().path
        let candidate = url.path
        guard candidate == rootPath || candidate.hasPrefix(rootPath + "/") else { return nil }
        if candidate.contains("/Application Support/") { return nil }
        return url
    }

    private func json(ok: Bool, data: Any? = nil, code: String? = nil) -> String {
        var object: [String: Any] = ["ok": ok]
        if let data { object["data"] = data }
        if let code { object["code"] = code }
        guard let bytes = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: bytes, encoding: .utf8) else {
            return #"{"ok":false,"code":"EIO"}"#
        }
        return text
    }
}
