import Foundation

/// Detects whether the app bundle contains all resources needed to run fully
/// without any external CLI install, global Node, or pnpm.
enum BundledAppDetector {
    static func hasNodeRuntime() -> Bool {
        guard let dir = CommandResolver.bundledNodeBinPath() else { return false }
        return FileManager().isExecutableFile(atPath: dir + "/node")
    }

    static func hasGateway() -> Bool {
        CommandResolver.bundledGatewayEntrypoint() != nil
    }

    static func hasWebApp() -> Bool {
        guard let r = Bundle.main.resourceURL else { return false }
        return FileManager().fileExists(atPath: r.appendingPathComponent("webapp/server.js").path)
    }

    static func isFullyBundled() -> Bool {
        hasNodeRuntime() && hasGateway() && hasWebApp()
    }
}
