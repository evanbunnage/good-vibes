import XCTest
@testable import coolswitch

@MainActor
private final class ManualSwitchWork: SwitchWorking {
    var lookups: [@MainActor @Sendable (Result<EntryIdentity?, AccessibilityFailure>) -> Void] = []
    var focuses: [(WindowEntry, @MainActor @Sendable (Result<Void, FocusFailure>) -> Void)] = []
    func resolve(_ entries: [WindowEntry], token: OperationToken,
                 completion: @escaping @MainActor @Sendable (Result<EntryIdentity?, AccessibilityFailure>) -> Void) {
        lookups.append(completion)
    }
    func focus(_ entry: WindowEntry, token: OperationToken,
               completion: @escaping @MainActor @Sendable (Result<Void, FocusFailure>) -> Void) {
        focuses.append((entry, completion))
    }
}

@MainActor
final class SwitchControllerTests: XCTestCase {
    private let screen = CGSize(width: 1440, height: 900)
    func testReleaseBeforeLookupCompletesCommitsExactlyOnce() {
        let work = ManualSwitchWork()
        let controller = SwitchController(work: work)
        let entries = sampleWindows()
        controller.begin(entries: entries, backwards: false, screenSize: screen)
        controller.commit() // Command released before the worker replies.
        controller.commit() // A duplicate release must not focus twice.
        XCTAssertFalse(controller.isActive)
        XCTAssertTrue(work.focuses.isEmpty)
        work.lookups[0](.success(entries[1].identity))
        XCTAssertEqual(work.focuses.count, 1)
        XCTAssertEqual(work.focuses[0].0.identity, entries[0].identity)
        work.focuses[0].1(.success(()))
        XCTAssertTrue(controller.isIdle)
    }
    func testCancelDuringLookupIgnoresLateResult() {
        let work = ManualSwitchWork()
        let controller = SwitchController(work: work)
        controller.begin(entries: sampleWindows(), backwards: false, screenSize: screen)
        controller.cancel() // Escape or permission loss.
        work.lookups[0](.success(nil))
        XCTAssertTrue(controller.isIdle)
        XCTAssertTrue(work.focuses.isEmpty)
    }
    func testNavigationWhileResolvingMatchesNavigationAfterResolution() {
        let entries = sampleWindows()
        let pendingWork = ManualSwitchWork()
        let readyWork = ManualSwitchWork()
        let pending = SwitchController(work: pendingWork)
        let ready = SwitchController(work: readyWork)
        pending.begin(entries: entries, backwards: false, screenSize: screen)
        ready.begin(entries: entries, backwards: false, screenSize: screen)
        readyWork.lookups[0](.success(entries[1].identity))
        for move in [SwitchSession.Move.step(1), .direction(.up), .step(-1)] {
            pending.move(move); ready.move(move)
        }
        pending.commit()
        ready.commit()
        pendingWork.lookups[0](.success(entries[1].identity))
        XCTAssertEqual(pendingWork.focuses[0].0.identity, readyWork.focuses[0].0.identity)
    }
    func testNewGestureRejectsBothOldLookupAndOldFocusCompletion() {
        let work = ManualSwitchWork()
        let controller = SwitchController(work: work)
        let entries = sampleWindows()
        var completions = 0
        controller.completed = { _, _ in completions += 1 }
        controller.begin(entries: entries, backwards: false, screenSize: screen)
        controller.begin(entries: entries, backwards: true, screenSize: screen)
        work.lookups[0](.success(entries[0].identity))
        XCTAssertNil(controller.visibleSession)
        work.lookups[1](.success(entries[0].identity))
        controller.commit()
        controller.begin(entries: entries, backwards: false, screenSize: screen)
        work.focuses[0].1(.success(()))
        XCTAssertEqual(completions, 0)
        XCTAssertTrue(controller.isActive)
        work.lookups[2](.success(entries[1].identity))
        XCTAssertEqual(controller.visibleSession?.selected?.identity, entries[0].identity)
    }
    func testLookupFailureCancelsWithoutGuessingAWindow() {
        let work = ManualSwitchWork()
        let controller = SwitchController(work: work)
        var failure: AccessibilityFailure?
        controller.lookupFailed = { failure = $0 }
        controller.begin(entries: sampleWindows(), backwards: false, screenSize: screen)
        controller.commit()
        work.lookups[0](.failure(.permissionDenied))
        XCTAssertTrue(controller.isIdle)
        XCTAssertEqual(failure, .permissionDenied)
        XCTAssertTrue(work.focuses.isEmpty)
    }
}
