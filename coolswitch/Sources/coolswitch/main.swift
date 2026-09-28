import AppKit
import ApplicationServices

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Full discovery reads every window (and tab) of every app, so it runs when
    /// something changed, at most this often, plus a slow safety-net interval.
    private static let minimumDiscoveryInterval: TimeInterval = 2
    private static let periodicDiscoveryInterval: TimeInterval = 10

    private let settingsModel = SettingsModel()
    private var settingsWindow: SettingsWindowController?
    private let panel = SwitcherPanel()
    private var status: NSStatusItem!
    private let keyboard = KeyboardInput()
    private var timer: Timer?
    private var catalog = WindowCatalog()
    private var desktops: [CGWindowID: String] = [:]
    private let work = WindowWork()
    private lazy var switcher = SwitchController(work: work)
    private var gesture = SwitchGesture()
    private let keyRepeater = HeldKeyRepeater()
    private let permissionGuide = PermissionGuide()
    private var discoveryToken: OperationToken?
    private var renderedToken: OperationToken?
    private var refreshing = false
    private var sampling = false
    private var discoveryWanted = false
    private var lastDiscovery = -TimeInterval.infinity
    private var workspaceObservers: [NSObjectProtocol] = []
    private var settingsRequest: NSObjectProtocol?
    private var started = false
    private var active: Bool { switcher.isActive }
    private var showMenuBarIcon: Bool { UserDefaults.standard.bool(forKey: "showMenuBarIcon") }
    private var isPreview: Bool { CommandLine.arguments.contains("--preview") }

    func applicationDidFinishLaunching(_ notification: Notification) {
        ApplicationInstall.prepare { [weak self] in self?.start() }
    }

    private func start() {
        guard !started else { return }
        started = true
        UserDefaults.standard.register(defaults: ["includeTabs": true])
        switcher.changed = { [weak self] in
            self?.keyboard.setSessionActive(self?.active ?? false)
            DispatchQueue.main.async { [weak self] in self?.render() }
        }
        switcher.observed = { [weak self] in self?.catalog.remember($0) }
        switcher.completed = { [weak self] _, result in
            // A successful request is not proof of focus. Discovery observes the result.
            if case .failure(let error) = result, error != .cancelled, error != .permissionDenied { NSSound.beep() }
            self?.requestDiscovery()
        }
        switcher.lookupFailed = { error in
            if error != .cancelled && error != .permissionDenied { NSSound.beep() }
        }
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        status.button?.image = NSImage(systemSymbolName: "rectangle.on.rectangle", accessibilityDescription: "CoolSwitch")
        status.menu = makeMenu()
        status.isVisible = showMenuBarIcon || isPreview
        // Never shown (CoolSwitch has no Dock icon), but supplies key equivalents to Settings.
        NSApp.mainMenu = {
            let menu = NSMenu()
            let window = NSMenu(title: "Window")
            window.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
            for submenu in [makeMenu(), window] {
                let item = NSMenuItem()
                item.submenu = submenu
                menu.addItem(item)
            }
            return menu
        }()
        configureSettingsModel()
        settingsRequest = DistributedNotificationCenter.default().addObserver(
            forName: AppIdentity.showSettingsNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.showSettings() }
        }
        if isPreview {
            let app = NSRunningApplication.current
            let element = AXElement.application(app.processIdentifier)
            panel.show(["Project notes", "Terminal — CoolSwitch", "Design document"].enumerated().map {
                WindowEntry(element: element, app: app, title: $1, minimized: false, windowID: CGWindowID($0 + 1))
            }, selected: 1, desktops: [1: "1", 2: "2", 3: "2"])
            return
        }
        LoginItem.configureOnFirstInstalledLaunch()
        keyboard.received = { [weak self] in self?.handle($0) }
        keyboard.interrupted = { [weak self] in
            self?.gesture.reset()
            self?.cancel()
        }
        keyboard.stopped = { [weak self] message in
            guard let self else { return }
            self.gesture.reset()
            self.cancel()
            self.settingsModel.keyboardStopped(reason: message)
            self.refreshSettings()
            self.showSettings()
        }
        if AXIsProcessTrusted() { keyboard.start() }
        observeWorkspace()
        refresh()
        timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            // This timer is installed only on the main run loop.
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(timer!, forMode: .common)
        refreshSettings()
        if !Self.launchesQuietly { showSettings() }
        // Settings holds its own foreground state; release the one taken at launch.
        if Self.launchedInForeground {
            Self.launchedInForeground = false
            Foreground.end()
        }
    }

    /// Opened at login with everything working: no window, so no Dock icon either. There's
    /// no reliable signal for "opened at login" with SMAppService, so use the setup state.
    static var launchesQuietly: Bool {
        !CommandLine.arguments.contains("--installed") && AXIsProcessTrusted() && LoginItem.isEnabled
            && (ApplicationInstall.isInstalled || AppIdentity.isDevelopmentBuild)
    }
    static var launchedInForeground = false

    private func configureSettingsModel() {
        settingsModel.menuBarIconChanged = { [weak self] in
            guard let self else { return }
            self.status.isVisible = self.showMenuBarIcon || self.isPreview
        }
        settingsModel.includeTabsChanged = { [weak self] in
            guard let self else { return }
            // Tab entries replace their windows, so the old list and its order no longer apply.
            self.cancel()
            self.discoveryToken?.cancel()
            self.catalog.clear()
            self.refresh(force: true)
        }
        settingsModel.requestAccessibility = { [weak self] in self?.showPermissions() }
        settingsModel.retryKeyboard = { [weak self] in
            guard let self else { return }
            self.settingsModel.keyboardRestarted()
            if AXIsProcessTrusted() { self.keyboard.retry() }
            self.refreshSettings()
        }
        settingsModel.setOpenAtLogin = { [weak self] enabled in
            do { try LoginItem.set(enabled) } catch { self?.settingsModel.loginItemError = error.localizedDescription }
            self?.settingsModel.loginItemChanged(LoginItem.status)
        }
    }

    // MARK: Permission and background refresh

    private func tick() {
        refreshSettings()
        if settingsModel.trusted, permissionGuide.isActive {
            // Access granted: put the guide away and bring the person back to CoolSwitch.
            permissionGuide.stop()
            showSettings()
        }
        guard settingsModel.trusted else {
            cancel()
            gesture.reset()
            discoveryToken?.cancel()
            catalog.clear()
            keyboard.stop()
            return
        }
        if !keyboard.failed { keyboard.start() }
        let elapsed = ProcessInfo.processInfo.systemUptime - lastDiscovery
        if (discoveryWanted && elapsed >= Self.minimumDiscoveryInterval) || elapsed >= Self.periodicDiscoveryInterval {
            refresh()
        } else {
            sampleFocus()
        }
    }

    private func refreshSettings() {
        settingsModel.permissionChanged(trusted: AXIsProcessTrusted())
        let ready = settingsModel.trusted && keyboard.ready
        // Runs every second; assigning an unchanged @Published value still redraws Settings.
        if settingsModel.ready != ready { settingsModel.ready = ready }
    }

    private func observeWorkspace() {
        let center = NSWorkspace.shared.notificationCenter
        let names: [Notification.Name] = [
            NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification,
            NSWorkspace.didActivateApplicationNotification, NSWorkspace.didHideApplicationNotification,
            NSWorkspace.didUnhideApplicationNotification, NSWorkspace.activeSpaceDidChangeNotification,
            NSWorkspace.didWakeNotification
        ]
        workspaceObservers = names.map { name in
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.requestDiscovery() }
            }
        }
    }

    /// Something changed. Rediscover now if the last pass wasn't too recent, otherwise soon.
    private func requestDiscovery() {
        discoveryWanted = true
        if ProcessInfo.processInfo.systemUptime - lastDiscovery >= Self.minimumDiscoveryInterval { refresh() }
    }

    private func refresh(force: Bool = false) {
        guard !refreshing, switcher.isIdle, AXIsProcessTrusted() else { return }
        refreshing = true
        discoveryWanted = false
        lastDiscovery = ProcessInfo.processInfo.systemUptime
        let revision = catalog.revision
        let token = OperationToken()
        discoveryToken = token
        work.discover(includeTabs: UserDefaults.standard.bool(forKey: "includeTabs"),
                      previous: catalog.entries, token: token) { [weak self] result, focused in
            guard let self else { return }
            self.refreshing = false
            guard !token.isCancelled, revision == self.catalog.revision, AXIsProcessTrusted() else {
                if force { self.discoveryWanted = true }
                return
            }
            if case .success(let entries) = result {
                self.catalog.receive(entries, revision: revision)
                if let focused { self.catalog.remember(focused) }
                self.refreshDesktops(entries)
            }
        }
    }

    /// Cheap once-a-second check of the focused window, so recency stays accurate
    /// between full discoveries. An unknown window means the list is out of date.
    private func sampleFocus() {
        guard !sampling, !refreshing, switcher.isIdle, !catalog.entries.isEmpty else { return }
        sampling = true
        work.resolve(catalog.entries, token: OperationToken()) { [weak self] result in
            guard let self else { return }
            self.sampling = false
            guard case .success(let identity?) = result, identity != self.catalog.mostRecent,
                  self.switcher.isIdle, !self.refreshing else { return }
            if self.catalog.contains(identity) {
                self.catalog.remember(identity)
            } else if case .application = identity {
                // An app with no focused window (for example, Finder's desktop).
            } else {
                self.requestDiscovery()
            }
        }
    }

    // MARK: Menus and windows

    private func makeMenu() -> NSMenu {
        let menu = NSMenu()
        let settings = NSMenuItem(title: "Settings…", action: #selector(showSettings), keyEquivalent: ",")
        settings.target = self
        menu.addItem(settings)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit CoolSwitch", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        return menu
    }

    @objc private func showSettings() {
        refreshSettings()
        settingsModel.loginItemChanged(LoginItem.status)
        if settingsWindow == nil { settingsWindow = SettingsWindowController(model: settingsModel) }
        settingsWindow?.present()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if started && !active { showSettings() }
        return false
    }

    @objc private func quit() { NSApp.terminate(nil) }

    @objc private func showPermissions() {
        guard !settingsModel.openingSettings else { return }
        settingsModel.beginPermissionRequest()
        // Hand off asynchronously so System Settings cannot block our UI.
        // Send only the pane URL; a simultaneous permission prompt adds another handoff.
        let url = URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility")!
        NSWorkspace.shared.open(url, configuration: .init()) { [weak self] _, error in
            let failed = error != nil
            Task { @MainActor [weak self] in
                self?.settingsModel.settingsOpened(failed: failed)
                if failed { self?.permissionGuide.stop() }
            }
        }
        permissionGuide.start(from: settingsWindow?.window?.frame)
    }

    func applicationWillTerminate(_ notification: Notification) {
        permissionGuide.stop()
        keyboard.stop()
    }

    // MARK: Gesture

    private static var commandHeld: Bool {
        CGEventSource.flagsState(.combinedSessionState).contains(.maskCommand)
    }

    private static var tabHeld: Bool {
        CGEventSource.keyState(.hidSystemState, key: 48) // kVK_Tab
    }

    private func handle(_ event: KeyboardInput.Event) {
        guard settingsModel.trusted else { cancel(); return }
        let actions: [SwitchGesture.Action]
        switch event {
        case .tab(let backwards, let pressed, let time):
            actions = gesture.tab(backwards: backwards, pressed: pressed, time: time,
                                  active: active, commandHeld: Self.commandHeld)
        case .modifiers(let flags, let time):
            actions = gesture.modifiers(command: flags.contains(.maskCommand), shift: flags.contains(.maskShift),
                                        time: time, active: active, tabHeld: Self.tabHeld)
        case .key(let code, let time):
            actions = gesture.key(code, time: time, active: active)
        }
        for action in actions { perform(action) }
    }

    private func perform(_ action: SwitchGesture.Action) {
        switch action {
        case .begin(let backwards): begin(backwards: backwards)
        case .step(let delta): switcher.move(.step(delta))
        case .move(let direction):
            keyRepeater.stop()
            switcher.move(.direction(direction))
        case .commit:
            keyRepeater.stop()
            switcher.commit()
        case .cancel: cancel()
        case .startRepeat: startKeyRepeat()
        case .stopRepeat: keyRepeater.stop()
        }
    }

    /// Carbon hot keys and modifier-only navigation share the system repeat timing.
    private func startKeyRepeat() {
        keyRepeater.stop()
        guard active, gesture.wantsRepeat else { return }
        keyRepeater.start(delay: NSEvent.keyRepeatDelay, interval: NSEvent.keyRepeatInterval) { [weak self] in
            guard let self else { return }
            guard let delta = self.gesture.repeatStep(active: self.active, tabHeld: Self.tabHeld) else {
                self.keyRepeater.stop()
                return
            }
            self.switcher.move(.step(delta))
        }
    }

    private func begin(backwards: Bool) {
        discoveryToken?.cancel()
        catalog.invalidate()
        var entries = catalog.entries
        if entries.isEmpty {
            // Discovery hasn't finished yet (just launched, or it failed). Switching
            // between apps beats swallowing ⌘Tab and showing nothing.
            entries = WindowStore.sorted(work.applications.map(WindowEntry.init(app:)), recent: [])
            requestDiscovery()
        }
        panel.prepare(count: entries.count)
        switcher.begin(entries: entries, backwards: backwards, screenSize: panel.availableSize)
        // Windows can change desktop without any app or Space notification (AeroSpace
        // moves them itself), so look again now and correct the open panel.
        refreshDesktops(entries)
    }

    private func refreshDesktops(_ entries: [WindowEntry]) {
        work.desktops(for: entries) { [weak self] labels in
            guard let self else { return }
            self.desktops = labels
            if self.switcher.visibleSession != nil { self.panel.setDesktops(labels) }
        }
    }

    private func render() {
        if let session = switcher.visibleSession {
            if renderedToken === switcher.state.token { panel.highlight(session.selection) }
            else {
                panel.show(session.entries, selected: session.selection, desktops: desktops)
                renderedToken = switcher.state.token
            }
        } else {
            renderedToken = nil
            panel.orderOut(nil)
            panel.clearEntries()
        }
    }

    private func cancel() {
        keyRepeater.stop()
        switcher.cancel()
    }
}

SystemCommandTab.restoreOnAbnormalExit()
let app = NSApplication.shared
// A launch that shows a prompt or Settings starts as a regular app, so macOS activates it
// like any app the person opened; switching later is too late for it to come forward.
if AppDelegate.launchesQuietly || CommandLine.arguments.contains("--preview") {
    app.setActivationPolicy(.accessory)
} else {
    AppDelegate.launchedInForeground = true
    Foreground.begin()
}
let delegate = AppDelegate()
app.delegate = delegate
app.run()
