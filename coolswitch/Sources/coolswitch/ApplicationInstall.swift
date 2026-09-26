import AppKit
import Darwin
import OSLog

/// First-run install, update-in-place, and one-copy-at-a-time handling. CoolSwitch has no
/// updater and makes no network requests, so opening a newer download is the update path.
@MainActor
enum ApplicationInstall {
    private static var preparing = false
    private static let logger = Logger(subsystem: AppIdentity.logSubsystem, category: "install")

    static var applicationFolders: [URL] {
        [URL(fileURLWithPath: "/Applications", isDirectory: true),
         FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true)]
    }

    static var isInstalled: Bool {
        let path = Bundle.main.bundleURL.resolvingSymlinksInPath().path
        return applicationFolders.contains { path.hasPrefix($0.resolvingSymlinksInPath().path + "/") }
    }

    /// Runs `completion` once this copy should start handling ⌘Tab, or quits.
    static func prepare(completion: @escaping @MainActor () -> Void) {
        guard !preparing else { return }
        preparing = true
        let proceed = { ensureSingleInstance(completion: completion) }
        let source = Bundle.main.bundleURL.resolvingSymlinksInPath()
        guard source.pathExtension == "app", !AppIdentity.isDevelopmentBuild, !isInstalled,
              !CommandLine.arguments.contains("--preview") else {
            proceed()
            return
        }
        guard let installed = installedCopy() else { offerInstall(source, otherwise: proceed); return }
        let existing = AppIdentity.version(of: Bundle(url: installed)) ?? "0.0.0"
        if AppIdentity.compare(AppIdentity.version, existing) == .orderedDescending {
            offerUpdate(installed, with: source, otherwise: proceed)
        } else {
            // The installed copy is as new or newer, so this download has nothing to add.
            showInstalled(installed, otherwise: proceed)
        }
    }

    private static func installedCopy() -> URL? {
        applicationFolders.map { $0.appendingPathComponent("CoolSwitch.app") }
            .first { FileManager.default.fileExists(atPath: $0.path) }
    }

    private static func running(at app: URL) -> [NSRunningApplication] {
        NSWorkspace.shared.runningApplications.filter {
            $0.bundleURL?.resolvingSymlinksInPath() == app.resolvingSymlinksInPath()
        }
    }

    // MARK: Install and update

    private static func offerInstall(_ source: URL, otherwise proceed: @escaping @MainActor () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Finish installing \(AppIdentity.displayName)"
        alert.informativeText = "Move \(AppIdentity.displayName) to your Applications folder to get started."
        alert.addButton(withTitle: "Move to Applications")
        alert.addButton(withTitle: "Not Now")
        guard ask(alert) else { proceed(); return }
        // Standard accounts can't write to /Applications; fall back to ~/Applications.
        let folder = FileManager.default.isWritableFile(atPath: applicationFolders[0].path)
            ? applicationFolders[0] : applicationFolders[1]
        let destination = folder.appendingPathComponent("CoolSwitch.app")
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            // Copy first so the original remains usable if installation or launch fails.
            try copyForInstallation(from: source, to: destination)
        } catch {
            showInstallFailure(error)
            proceed()
            return
        }
        launchInstalled(destination, replacing: source, otherwise: proceed)
    }

    private static func offerUpdate(_ installed: URL, with source: URL,
                                    otherwise proceed: @escaping @MainActor () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Update CoolSwitch to \(AppIdentity.version)?"
        alert.addButton(withTitle: "Update")
        alert.addButton(withTitle: "Not Now")
        guard ask(alert) else { proceed(); return }
        terminate(running(at: installed)) { quit in
            guard quit else { askToQuitOtherCopy(); return }
            let files = FileManager.default
            do {
                var trashed: NSURL?
                try files.trashItem(at: installed, resultingItemURL: &trashed)
                do {
                    try copyForInstallation(from: source, to: installed)
                } catch {
                    // Put the previous version back rather than leave nothing installed.
                    if let trashed = trashed as URL? { try? files.moveItem(at: trashed, to: installed) }
                    throw error
                }
            } catch {
                showInstallFailure(error)
                proceed()
                return
            }
            launchInstalled(installed, replacing: source, otherwise: proceed)
        }
    }

    /// Opening an old or duplicate download shows the installed copy instead.
    private static func showInstalled(_ installed: URL, otherwise proceed: @escaping @MainActor () -> Void) {
        if !running(at: installed).isEmpty {
            AppIdentity.requestSettings()
            NSApp.terminate(nil)
            return
        }
        open(installed) { error in
            if let error { showInstallFailure(error); proceed() } else { NSApp.terminate(nil) }
        }
    }

    // MARK: One copy at a time

    /// Only one process can register ⌘Tab. The copy opened last wins: a download, a local
    /// build, or the copy a move or update just launched while its launcher quits.
    private static func ensureSingleInstance(completion: @escaping @MainActor () -> Void) {
        let me = ProcessInfo.processInfo.processIdentifier
        let others = NSWorkspace.shared.runningApplications.filter {
            $0.processIdentifier != me && AppIdentity.isCoolSwitch($0)
        }
        guard !others.isEmpty, !CommandLine.arguments.contains("--preview") else { completion(); return }
        terminate(others) { quit in
            if quit { completion() } else { askToQuitOtherCopy() }
        }
    }

    /// Another copy wouldn't quit. Its Settings window has a Quit button, so open it and point there.
    private static func askToQuitOtherCopy() {
        AppIdentity.requestSettings()
        let alert = NSAlert()
        alert.messageText = "Quit CoolSwitch first"
        alert.informativeText = "Quit CoolSwitch in the window that just opened."
        _ = ask(alert)
        NSApp.terminate(nil)
    }

    // MARK: Helpers

    /// Runs an alert in front, where its default button can take focus. Returns
    /// whether the first button was chosen.
    private static func ask(_ alert: NSAlert) -> Bool {
        Foreground.begin()
        defer { Foreground.end() }
        if alert.buttons.count > 1 { alert.buttons[1].keyEquivalent = "\u{1b}" } // Escape: Not Now
        return alert.runModal() == .alertFirstButtonReturn
    }

    private static func launchInstalled(_ destination: URL, replacing source: URL,
                                        otherwise proceed: @escaping @MainActor () -> Void) {
        open(destination) { error in
            if let error {
                showInstallFailure(error)
                proceed()
                return
            }
            // A download can be trashed; an app on a read-only disk image cannot.
            try? FileManager.default.trashItem(at: source, resultingItemURL: nil)
            NSApp.terminate(nil)
        }
    }

    private static func open(_ app: URL, completion: @escaping @MainActor @Sendable (NSError?) -> Void) {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        // Tells the new copy to show Settings so the person sees the result.
        configuration.arguments = ["--installed"]
        NSWorkspace.shared.openApplication(at: app, configuration: configuration) { _, error in
            let error = error.map { $0 as NSError }
            Task { @MainActor in completion(error) }
        }
    }

    private static func terminate(_ apps: [NSRunningApplication], completion: @escaping @MainActor (Bool) -> Void) {
        apps.forEach { $0.terminate() }
        Task { @MainActor in
            for _ in 0..<50 where !apps.allSatisfy(\.isTerminated) {
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
            completion(apps.allSatisfy(\.isTerminated))
        }
    }

    // Gatekeeper has already allowed this running app. Clear download metadata only
    // on the new, user-requested copy so macOS launches it at its installed path
    // instead of translocating it and showing the installation prompt again.
    nonisolated static func copyForInstallation(from source: URL, to destination: URL) throws {
        let files = FileManager.default
        try files.copyItem(at: source, to: destination)
        do {
            let contents = try files.subpathsOfDirectory(atPath: destination.path)
            for path in [destination.path] + contents.map({ destination.appendingPathComponent($0).path }) {
                if removexattr(path, "com.apple.quarantine", XATTR_NOFOLLOW) != 0, errno != ENOATTR {
                    throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
                }
            }
        } catch {
            try? files.removeItem(at: destination)
            throw error
        }
    }

    private static func showInstallFailure(_ error: Error) {
        logger.error("Install failed: \(error.localizedDescription, privacy: .public)")
        let alert = NSAlert()
        alert.messageText = "Couldn’t install CoolSwitch"
        alert.informativeText = "Drag CoolSwitch into your Applications folder in Finder."
        _ = ask(alert)
    }
}
