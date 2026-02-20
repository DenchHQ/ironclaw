import Foundation
import Observation
import OSLog

/// Manages the bundled Next.js standalone server as a direct subprocess.
/// Only active when `BundledAppDetector.hasWebApp()` returns true.
@MainActor
@Observable
final class WebAppProcessManager {
    static let shared = WebAppProcessManager()

    private let logger = Logger(subsystem: "ai.openclaw", category: "webapp")

    enum Status: Equatable {
        case stopped
        case starting
        case running
        case failed(String)
    }

    private(set) var status: Status = .stopped
    private var process: Process?

    private static let port = 3100

    // MARK: - Public API

    func start() async {
        guard BundledAppDetector.hasWebApp() else {
            self.logger.debug("webapp: no bundled web app; skipping")
            return
        }
        guard case .stopped = self.status else {
            self.logger.debug("webapp: already started or starting; skipping")
            return
        }

        // If something is already listening on 3100, attach to it.
        if await Self.isPortResponsive() {
            self.logger.info("webapp: port \(Self.port) already responsive; attaching")
            self.status = .running
            return
        }

        guard let nodePath = CommandResolver.bundledNodeBinPath().map({ $0 + "/node" }),
              FileManager().isExecutableFile(atPath: nodePath)
        else {
            let msg = "bundled node binary not found or not executable"
            self.logger.error("webapp: \(msg, privacy: .public)")
            self.status = .failed(msg)
            return
        }

        guard let resources = Bundle.main.resourceURL else {
            let msg = "bundle resource URL unavailable"
            self.logger.error("webapp: \(msg, privacy: .public)")
            self.status = .failed(msg)
            return
        }

        let serverScript = resources.appendingPathComponent("webapp/server.js").path
        guard FileManager().fileExists(atPath: serverScript) else {
            let msg = "webapp/server.js not found at \(serverScript)"
            self.logger.error("webapp: \(msg, privacy: .public)")
            self.status = .failed(msg)
            return
        }

        self.status = .starting
        self.logger.info("webapp: starting Next.js server on port \(Self.port)")

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: nodePath)
        proc.arguments = [serverScript]
        proc.environment = [
            "PORT": "\(Self.port)",
            "HOSTNAME": "127.0.0.1",
            "NODE_ENV": "production",
            // Pass through minimal PATH so the process can find itself
            "PATH": CommandResolver.preferredPaths().joined(separator: ":"),
        ]
        // Run server from the webapp directory so relative asset paths resolve.
        proc.currentDirectoryURL = resources.appendingPathComponent("webapp")

        // Discard stdout/stderr to avoid filling pipe buffers.
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice

        proc.terminationHandler = { [weak self] p in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if case .running = self.status { return }
                let code = p.terminationStatus
                let msg = "webapp process exited with code \(code)"
                self.logger.error("webapp: \(msg, privacy: .public)")
                if case .starting = self.status {
                    self.status = .failed(msg)
                }
                self.process = nil
            }
        }

        do {
            try proc.run()
        } catch {
            let msg = "failed to launch webapp: \(error.localizedDescription)"
            self.logger.error("webapp: \(msg, privacy: .public)")
            self.status = .failed(msg)
            return
        }

        self.process = proc

        // Poll for readiness.
        if await self.waitForReady(timeout: 10) {
            self.logger.info("webapp: server ready on port \(Self.port)")
            self.status = .running
        } else {
            let msg = "webapp did not become ready within 10s"
            self.logger.error("webapp: \(msg, privacy: .public)")
            self.status = .failed(msg)
            proc.terminate()
            self.process = nil
        }
    }

    func stop() {
        guard let proc = self.process else { return }
        self.logger.info("webapp: stopping server")
        proc.terminate()
        self.process = nil
        self.status = .stopped
    }

    // MARK: - Private helpers

    private func waitForReady(timeout: TimeInterval) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await Self.isPortResponsive() { return true }
            try? await Task.sleep(for: .milliseconds(300))
        }
        return false
    }

    private static func isPortResponsive() async -> Bool {
        let url = URL(string: "http://127.0.0.1:\(port)/")!
        var req = URLRequest(url: url, timeoutInterval: 2)
        req.httpMethod = "HEAD"
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            if let http = resp as? HTTPURLResponse, http.statusCode < 500 {
                return true
            }
        } catch {}
        return false
    }
}
