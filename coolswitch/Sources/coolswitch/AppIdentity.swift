import AppKit
import ServiceManagement

enum AppIdentity {
    /// Release bundle identifier. Local builds append ".dev" so their Accessibility
    /// approval and running copy never collide with an installed release.
    static let releaseBundleIdentifier = "io.github.evanbunnage.coolswitch"

    static var bundleIdentifier: String { Bundle.main.bundleIdentifier ?? releaseBundleIdentifier }
    static var logSubsystem: String { bundleIdentifier }
    static var isDevelopmentBuild: Bool { bundleIdentifier.hasSuffix(".dev") }
    static var version: String { version(of: Bundle.main) ?? "0.0.0" }
    static var displayName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "CoolSwitch"
    }

    static func version(of bundle: Bundle?) -> String? {
        bundle?.infoDictionary?["CFBundleShortVersionString"] as? String
    }

    /// Numeric comparison, so 0.1.10 sorts after 0.1.9.
    static func compare(_ lhs: String, _ rhs: String) -> ComparisonResult {
        lhs.compare(rhs, options: .numeric)
    }

    static func isCoolSwitch(_ app: NSRunningApplication) -> Bool {
        guard let identifier = app.bundleIdentifier else { return false }
        return identifier.hasPrefix(releaseBundleIdentifier)
    }

    /// Asks the running copy (release or local build) to show Settings.
    static let showSettingsNotification = Notification.Name("\(releaseBundleIdentifier).showSettings")

    static func requestSettings() {
        DistributedNotificationCenter.default().postNotificationName(
            showSettingsNotification, object: nil, userInfo: nil, deliverImmediately: true)
    }
}

/// CoolSwitch has no Dock icon, and macOS 14+ may decline to activate such an app, which
/// leaves its windows inactive: gray default buttons and no keyboard focus. While a
/// window needs the person, run as a regular app.
@MainActor
enum Foreground {
    private static var count = 0

    static func begin() {
        count += 1
        if count == 1 { NSApp.setActivationPolicy(.regular) }
        NSApp.activate(ignoringOtherApps: true)
    }

    static func end() {
        guard count > 0 else { return }
        count -= 1
        if count == 0 { NSApp.setActivationPolicy(.accessory) }
    }
}

@MainActor
enum LoginItem {
    private static let configuredKey = "loginItemConfigured"

    static var status: SMAppService.Status { SMAppService.mainApp.status }
    static var isEnabled: Bool { status == .enabled }

    static func set(_ enabled: Bool) throws {
        if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
    }

    /// A window switcher is expected to survive a restart. Turn this on once, the
    /// first time an installed copy runs; after that it's the person's choice.
    static func configureOnFirstInstalledLaunch() {
        guard ApplicationInstall.isInstalled, !AppIdentity.isDevelopmentBuild,
              !UserDefaults.standard.bool(forKey: configuredKey) else { return }
        UserDefaults.standard.set(true, forKey: configuredKey)
        try? SMAppService.mainApp.register()
    }
}
