import AppKit

/// Use Launch Services' reopen behavior, as when opening an app from the Dock.
/// Merely activating NSRunningApplication does not ask it to show a window.
struct ApplicationReopener: Sendable {
    typealias Open = @Sendable (URL, NSWorkspace.OpenConfiguration, @escaping @Sendable (Bool) -> Void) -> Void
    var open: Open = { url, configuration, completion in
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { app, error in
            completion(app != nil && error == nil)
        }
    }

    func reopen(at url: URL?, completion: @escaping @Sendable (Bool) -> Void) {
        guard let url else { completion(false); return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.hides = false
        configuration.createsNewApplicationInstance = false
        configuration.addsToRecentItems = false
        open(url, configuration, completion)
    }
}
