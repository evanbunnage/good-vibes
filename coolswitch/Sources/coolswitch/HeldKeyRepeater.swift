import Foundation

/// Carbon shortcuts and modifier-only navigation share the system repeat timing.
/// Main-run-loop timer, cancelled whenever the gesture or switcher ends.
@MainActor
final class HeldKeyRepeater {
    private var timer: Timer?

    func start(delay: TimeInterval, interval: TimeInterval, action: @escaping @MainActor @Sendable () -> Void) {
        stop()
        let timer = Timer(fire: Date().addingTimeInterval(max(0, delay)),
                          interval: max(0.01, interval), repeats: true) { _ in MainActor.assumeIsolated { action() } }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    isolated deinit { timer?.invalidate() }
}
