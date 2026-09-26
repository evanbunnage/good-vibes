import AppKit
import CoreGraphics

/// The Dock matches ⌘Tab and ⌘⇧Tab in the WindowServer's symbolic-hotkey layer, ahead
/// of any app's Carbon hot key, so CoolSwitch only hears them while the system switcher's
/// shortcuts are off. The setting outlives the process, so every way out turns them
/// back on: `KeyboardInput.stop()` (quit, lost permission, failure), termination
/// signals, and uncaught exceptions. Only SIGKILL (Force Quit) skips this; opening and
/// quitting CoolSwitch restores it.
enum SystemCommandTab {
    private static let hotKeys: [Int32] = [1, 2] // ⌘Tab, ⌘⇧Tab
    /// Whether this process turned them off. A copy that never took over ⌘Tab must not
    /// turn the system switcher back on underneath the copy that did.
    nonisolated(unsafe) private static var disabledHere = false

    static func setEnabled(_ enabled: Bool) {
        for hotKey in hotKeys { _ = CGSSetSymbolicHotKeyEnabled(hotKey, enabled) }
        disabledHere = !enabled
    }

    fileprivate static func restoreIfDisabledHere() {
        if disabledHere { setEnabled(true) }
    }

    /// Call once at launch, before the app runs.
    static func restoreOnAbnormalExit() {
        // Asynchronous signals are handled on a queue: nothing here is async-signal-safe.
        let queued = [SIGTERM, SIGINT, SIGHUP]
        signalSources = queued.map { number in
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .global())
            source.setEventHandler { restoreAndExit() }
            source.resume()
            return source
        }
        // A Swift runtime trap stops on the trapping instruction, so it must exit in the handler.
        signal(SIGTRAP) { _ in restoreAndExit() }
        // A launcher can hand us a mask that blocks these; blocked signals are never delivered.
        var mask = sigset_t()
        sigemptyset(&mask)
        (queued + [SIGTRAP]).forEach { sigaddset(&mask, $0) }
        pthread_sigmask(SIG_UNBLOCK, &mask, nil)
        NSSetUncaughtExceptionHandler { _ in restoreAndExit() }
    }

    nonisolated(unsafe) private static var signalSources: [any DispatchSourceSignal] = []
}

/// File scope so the C signal and exception handlers can call it without context.
private func restoreAndExit() -> Never {
    SystemCommandTab.restoreIfDisabledHere()
    _exit(0)
}

@_silgen_name("CGSSetSymbolicHotKeyEnabled")
private func CGSSetSymbolicHotKeyEnabled(_ hotKey: Int32, _ enabled: Bool) -> CGError
