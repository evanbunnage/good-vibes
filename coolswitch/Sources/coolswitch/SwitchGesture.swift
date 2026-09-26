import Foundation

/// The hold-⌘ gesture, kept free of AppKit so event orderings can be unit tested.
///
/// Input arrives from two sources that can be processed out of order after a UI
/// stall: Carbon hot keys (⌘Tab, ⌘⇧Tab) and the modifier/arrow-key taps. Every
/// time here is seconds since boot, the clock shared by `GetEventTime` and
/// `NSEvent.timestamp`. Never mix in raw `CGEvent.timestamp` values.
struct SwitchGesture {
    enum Action: Equatable {
        case begin(backwards: Bool)
        case step(Int)
        case move(GridDirection)
        case commit
        case cancel
        /// Restart held-key repeat if Tab or Shift is still held, otherwise stop it.
        case startRepeat
        case stopRepeat
    }

    private(set) var tabDown = false
    private(set) var reverseDown = false
    private var started = -TimeInterval.infinity
    private var commandReleased = -TimeInterval.infinity

    var wantsRepeat: Bool { tabDown || reverseDown }

    /// Carbon hot key press or release. A held Tab may deliver repeated presses;
    /// only the first press of a physical hold counts.
    mutating func tab(backwards: Bool, pressed: Bool, time: TimeInterval,
                      active: Bool, commandHeld: Bool) -> [Action] {
        let wasDown = tabDown
        tabDown = pressed
        guard pressed else { return [.startRepeat] }
        if wasDown { return [] }
        var actions: [Action] = [.stopRepeat]
        if active {
            actions.append(.step(backwards ? -1 : 1))
        } else {
            started = time
            reverseDown = backwards
            actions.append(.begin(backwards: backwards))
        }
        // A quick tap must commit even if ⌘'s release was processed first.
        actions.append(commandReleased >= time || !commandHeld ? .commit : .startRepeat)
        return actions
    }

    /// Modifier change from the listen-only tap. `tabHeld` is the current
    /// physical Tab state, used to recover from a Carbon release that never arrived.
    mutating func modifiers(command: Bool, shift: Bool, time: TimeInterval,
                            active: Bool, tabHeld: Bool) -> [Action] {
        sync(tabHeld: tabHeld)
        if !command { commandReleased = max(commandReleased, time) }
        // Ignore modifier changes from before this gesture began.
        guard time >= started else { return [] }
        let pressedReverse = shift && !reverseDown
        reverseDown = shift
        var actions: [Action] = []
        if !wantsRepeat { actions.append(.stopRepeat) }
        if active && !command {
            actions.append(.commit)
        } else if active && pressedReverse {
            actions += [.step(-1), .startRepeat]
        }
        return actions
    }

    /// A navigation key the filter consumed while the switcher was open.
    func key(_ code: Int64, time: TimeInterval, active: Bool) -> [Action] {
        guard active, time >= started else { return [] }
        switch code {
        case 53: return [.cancel]
        case 36, 76: return [.commit]
        case 126: return [.move(.up)]
        case 125: return [.move(.down)]
        case 123: return [.move(.left)]
        case 124: return [.move(.right)]
        default: return []
        }
    }

    /// The step for one held-key repeat, or nil when repeat should stop.
    mutating func repeatStep(active: Bool, tabHeld: Bool) -> Int? {
        sync(tabHeld: tabHeld)
        guard active, wantsRepeat else { return nil }
        return reverseDown ? -1 : 1
    }

    mutating func sync(tabHeld: Bool) {
        if !tabHeld { tabDown = false }
    }

    mutating func reset() {
        tabDown = false
        reverseDown = false
    }
}
