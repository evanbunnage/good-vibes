import AppKit
import Carbon
import OSLog

/// Carbon owns the two shortcuts. A passive observer tracks modifiers. Only the
/// switcher's navigation keys use an active tap, on a dedicated input thread.
@MainActor
final class KeyboardInput {
    enum Event: Sendable {
        case tab(backwards: Bool, pressed: Bool, time: TimeInterval)
        case modifiers(CGEventFlags, time: TimeInterval)
        case key(Int64, time: TimeInterval)
    }
    var received: (Event) -> Void = { _ in }
    /// macOS briefly disabled interception; any open switcher should close.
    var interrupted: () -> Void = {}
    var stopped: (String) -> Void = { _ in }
    private(set) var ready = false
    private(set) var failed = false
    private var sessionActive = false
    private var hotkeys: [EventHotKeyRef] = []
    private var handler: EventHandlerRef?
    private var taps: SwitcherInputTaps?
    private let logger = Logger(subsystem: AppIdentity.logSubsystem, category: "keyboard")

    func start() {
        guard taps == nil, !failed else { return }
        let worker = SwitcherInputTaps()
        taps = worker
        worker.start { [weak self, weak worker] event in
            guard let self, let worker, self.taps === worker else { return }
            switch event {
            case .ready:
                self.registerShortcuts()
            case .input(let input):
                if self.ready { self.received(input) }
            case .interrupted:
                self.logger.notice("Keyboard interception was interrupted by macOS; recovering")
                self.interrupted()
            case .failure(let message): self.fail(message)
            }
        }
    }

    /// Clears a previous failure (for the Settings "Try Again" button) and restarts.
    func retry() {
        stop()
        failed = false
        start()
    }

    func setSessionActive(_ active: Bool) {
        guard sessionActive != active else { return }
        sessionActive = active
        taps?.setActive(active)
    }

    func stop() {
        if ready { SystemCommandTab.setEnabled(true) }
        ready = false
        sessionActive = false
        hotkeys.forEach { UnregisterEventHotKey($0) }
        hotkeys.removeAll()
        if let handler { RemoveEventHandler(handler) }
        handler = nil
        taps?.stop()
        taps = nil
    }

    /// `reason` is for the log; the person sees `message`.
    private func fail(_ reason: String, message: String = "Something went wrong starting CoolSwitch.") {
        failed = true
        stop()
        logger.error("Keyboard input stopped: \(reason, privacy: .public)")
        stopped(message)
    }

    private func registerShortcuts() {
        var types = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased))
        ]
        let status = InstallEventHandler(GetEventDispatcherTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var id = EventHotKeyID()
            let status = GetEventParameter(event, EventParamName(kEventParamDirectObject),
                EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
            guard status == noErr, id.signature == 0x636F6F6C, (1...2).contains(id.id) else {
                return OSStatus(eventNotHandledErr)
            }
            let owner = Unmanaged<KeyboardInput>.fromOpaque(context).takeUnretainedValue()
            MainActor.assumeIsolated {
                guard owner.ready else { return }
                owner.received(.tab(backwards: id.id == 2,
                                    pressed: GetEventKind(event) == UInt32(kEventHotKeyPressed),
                                    time: GetEventTime(event)))
            }
            return noErr
        }, types.count, &types, Unmanaged.passUnretained(self).toOpaque(), &handler)
        guard status == noErr else { fail("InstallEventHandler failed (\(status))"); return }
        for (index, modifiers) in [UInt32(cmdKey), UInt32(cmdKey | shiftKey)].enumerated() {
            var ref: EventHotKeyRef?
            let result = RegisterEventHotKey(UInt32(kVK_Tab), modifiers,
                EventHotKeyID(signature: 0x636F6F6C, id: UInt32(index + 1)),
                GetEventDispatcherTarget(), 0, &ref)
            guard result == noErr, let ref else {
                fail("RegisterEventHotKey failed (\(result))",
                     message: "Another app is using ⌘Tab. Quit it first.")
                return
            }
            hotkeys.append(ref)
        }
        ready = true
        SystemCommandTab.setEnabled(false)
        logger.notice("Command-Tab shortcuts registered")
    }
}

/// Run-loop-owned tap state. The lock protects only startup/stop coordination;
/// callbacks never wait for the main thread or perform Accessibility/UI work.
private final class SwitcherInputTaps: @unchecked Sendable {
    enum Event: Sendable { case ready, input(KeyboardInput.Event), interrupted, failure(String) }
    /// macOS disables a tap when a callback is slow, around sleep, or during some
    /// secure input. Occasional interruptions are normal over a long session; only
    /// a burst of them means recovery isn't working, so stop instead of looping.
    private static let maximumInterruptions = 5
    private static let interruptionWindow: TimeInterval = 60
    private var interruptions: [TimeInterval] = []
    private let lock = NSLock()
    private var loop: CFRunLoop?
    private var stopping = false
    // Accessed only on the input thread after start.
    private var observer: CFMachPort?
    private var filter: CFMachPort?
    private var filterEnabled = false
    private var policy = KeyboardEventPolicy()
    private var deliver: (@MainActor @Sendable (Event) -> Void)?

    func start(deliver: @escaping @MainActor @Sendable (Event) -> Void) {
        self.deliver = deliver
        let thread = Thread { self.run() }
        thread.name = "coolswitch.keyboard"
        thread.qualityOfService = .userInteractive
        thread.start()
    }

    func stop() {
        lock.lock()
        stopping = true
        let loop = self.loop
        lock.unlock()
        if let loop {
            CFRunLoopPerformBlock(loop, CFRunLoopMode.commonModes.rawValue) { CFRunLoopStop(loop) }
            CFRunLoopWakeUp(loop)
        }
    }

    func setActive(_ active: Bool) {
        lock.lock()
        let loop = stopping ? nil : self.loop
        lock.unlock()
        guard let loop else { return }
        CFRunLoopPerformBlock(loop, CFRunLoopMode.commonModes.rawValue) {
            // A queued UI request must not re-enable interception after Command release.
            self.policy.setActive(active && CGEventSource.flagsState(.combinedSessionState).contains(.maskCommand))
            self.updateFilter()
        }
        CFRunLoopWakeUp(loop)
    }

    private func send(_ event: Event) {
        guard let deliver else { return }
        DispatchQueue.main.async { deliver(event) }
    }

    private func run() {
        let loop = CFRunLoopGetCurrent()!
        let context = Unmanaged.passUnretained(self).toOpaque()
        observer = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
            options: .listenOnly, eventsOfInterest: CGEventMask(1 << CGEventType.flagsChanged.rawValue),
            callback: { _, type, event, context in
                guard let context else { return Unmanaged.passUnretained(event) }
                let owner = Unmanaged<SwitcherInputTaps>.fromOpaque(context).takeUnretainedValue()
                if !owner.check(type, fromFilter: false) { return Unmanaged.passUnretained(event) }
                if type == .flagsChanged {
                    if !event.flags.contains(.maskCommand) {
                        owner.policy.setActive(false)
                        owner.updateFilter()
                    }
                    owner.send(.input(.modifiers(event.flags, time: seconds(event))))
                }
                return Unmanaged.passUnretained(event)
            }, userInfo: context)
        filter = CGEvent.tapCreate(tap: .cghidEventTap, place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: CGEventMask((1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)),
            callback: { _, type, event, context in
                guard let context else { return Unmanaged.passUnretained(event) }
                let owner = Unmanaged<SwitcherInputTaps>.fromOpaque(context).takeUnretainedValue()
                guard owner.check(type, fromFilter: true) else { return Unmanaged.passUnretained(event) }
                if !event.flags.contains(.maskCommand) { owner.policy.setActive(false) }
                let code = event.getIntegerValueField(.keyboardEventKeycode)
                let result = owner.policy.key(type, code: code,
                    repeating: event.getIntegerValueField(.keyboardEventAutorepeat) != 0)
                if result.act { owner.send(.input(.key(code, time: seconds(event)))) }
                owner.updateFilter()
                return result.consume ? nil : Unmanaged.passUnretained(event)
            }, userInfo: context)
        defer {
            if let observer { CFMachPortInvalidate(observer) }
            if let filter { CFMachPortInvalidate(filter) }
            self.observer = nil; self.filter = nil
            lock.lock(); self.loop = nil; lock.unlock()
        }
        guard let observer, let filter else {
            send(.failure("CGEvent.tapCreate returned nil"))
            return
        }
        CGEvent.tapEnable(tap: filter, enable: false)
        let sources = [observer, filter].compactMap { CFMachPortCreateRunLoopSource(nil, $0, 0) }
        guard sources.count == 2 else { send(.failure("CFMachPortCreateRunLoopSource failed")); return }
        for source in sources { CFRunLoopAddSource(loop, source, .commonModes) }
        lock.lock()
        self.loop = loop
        let shouldRun = !stopping
        lock.unlock()
        guard shouldRun else { return }
        send(.ready)
        CFRunLoopRun()
        for source in sources { CFRunLoopRemoveSource(loop, source, .commonModes) }
    }

    private func check(_ type: CGEventType, fromFilter: Bool) -> Bool {
        guard type == .tapDisabledByTimeout || type == .tapDisabledByUserInput else { return policy.failure == nil }
        // Turning the filter off ourselves (it's off except while the switcher is open)
        // is reported as disabled-by-user-input. That's expected, not an interruption;
        // treating it as one would disable the filter again and loop until failure.
        if fromFilter, type == .tapDisabledByUserInput, !filterEnabled { return false }
        let now = ProcessInfo.processInfo.systemUptime
        interruptions = interruptions.filter { now - $0 < Self.interruptionWindow } + [now]
        // Never leave the filter on: drop interception state and let the next session re-enable it.
        policy.interrupt()
        if let filter { CGEvent.tapEnable(tap: filter, enable: false) }
        filterEnabled = false
        if interruptions.count > Self.maximumInterruptions {
            policy.disable(type == .tapDisabledByTimeout ? .timeout : .disabledBySystem)
            send(.failure("event tap disabled \(interruptions.count) times in \(Int(Self.interruptionWindow))s"))
            CFRunLoopStop(CFRunLoopGetCurrent())
            return false
        }
        // The observer only listens, so it's always safe to turn back on.
        if let observer, !CGEvent.tapIsEnabled(tap: observer) { CGEvent.tapEnable(tap: observer, enable: true) }
        send(.interrupted)
        return false
    }

    private func updateFilter() {
        guard let filter else { return }
        let enabled = policy.needsFilter
        if filterEnabled != enabled {
            CGEvent.tapEnable(tap: filter, enable: enabled)
            filterEnabled = enabled
        }
    }
}

/// `CGEvent.timestamp` units differ across Macs and macOS versions. AppKit converts
/// it to seconds since boot, matching `GetEventTime`.
private func seconds(_ event: CGEvent) -> TimeInterval {
    NSEvent(cgEvent: event)?.timestamp ?? ProcessInfo.processInfo.systemUptime
}
