import CoreGraphics

/// State for the short-lived switcher key filter. Ordinary typing always passes.
struct KeyboardEventPolicy {
    enum Failure: String { case timeout, disabledBySystem }
    private(set) var failure: Failure?
    private(set) var active = false
    private(set) var held = Set<Int64>()
    var needsFilter: Bool { failure == nil && (active || !held.isEmpty) }

    mutating func setActive(_ value: Bool) { active = value && failure == nil }

    /// macOS switched the filter off. Forget interception state without failing.
    mutating func interrupt() {
        active = false
        held.removeAll()
    }

    mutating func disable(_ reason: Failure) {
        if failure == nil { failure = reason }
        active = false
        held.removeAll()
    }

    /// Returns whether to suppress this event and whether to perform its action.
    mutating func key(_ type: CGEventType, code: Int64, repeating: Bool) -> (consume: Bool, act: Bool) {
        guard failure == nil else { return (false, false) }
        if type == .keyUp { return (held.remove(code) != nil, false) }
        guard type == .keyDown else { return (false, false) }
        if held.contains(code) {
            if repeating { return (true, active) }
            // A new physical press also recovers from a key-up lost during secure input.
            held.remove(code)
        }
        guard active, Self.isSessionKey(code), !repeating else { return (false, false) }
        held.insert(code)
        // Stop accepting other keys immediately, before the UI handles commit/cancel.
        if code == 53 || code == 36 || code == 76 { active = false }
        return (true, true)
    }

    static func isSessionKey(_ code: Int64) -> Bool {
        [53, 36, 76, 123, 124, 125, 126].contains(code) // Escape, Return, Enter, arrows.
    }
}
