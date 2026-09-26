import XCTest
@testable import coolswitch

final class SwitchGestureTests: XCTestCase {
    func testHoldCommandTapTabThenReleaseCommits() {
        var gesture = SwitchGesture()
        XCTAssertEqual(gesture.tab(backwards: false, pressed: true, time: 10, active: false, commandHeld: true),
                       [.stopRepeat, .begin(backwards: false), .startRepeat])
        XCTAssertEqual(gesture.tab(backwards: false, pressed: false, time: 10.05, active: true, commandHeld: true),
                       [.startRepeat])
        XCTAssertEqual(gesture.modifiers(command: false, shift: false, time: 10.3, active: true, tabHeld: false),
                       [.stopRepeat, .commit])
    }

    func testQuickTapCommitsWhenCommandReleaseIsProcessedFirst() {
        var gesture = SwitchGesture()
        // ⌘ released at 10.08, but that event reaches the main thread before Tab's.
        XCTAssertEqual(gesture.modifiers(command: false, shift: false, time: 10.08, active: false, tabHeld: false),
                       [.stopRepeat])
        XCTAssertEqual(gesture.tab(backwards: false, pressed: true, time: 10.02, active: false, commandHeld: false),
                       [.stopRepeat, .begin(backwards: false), .commit])
    }

    func testQuickTapCommitsFromCurrentModifierStateAlone() {
        var gesture = SwitchGesture()
        XCTAssertEqual(gesture.tab(backwards: false, pressed: true, time: 10, active: false, commandHeld: false).last,
                       .commit)
    }

    func testStaleModifierFromBeforeTheGestureIsIgnored() {
        var gesture = SwitchGesture()
        _ = gesture.tab(backwards: false, pressed: true, time: 20, active: false, commandHeld: true)
        // A ⌘ release from an earlier gesture, delivered late, must not commit this one.
        XCTAssertFalse(gesture.modifiers(command: false, shift: false, time: 19.5, active: true, tabHeld: true)
            .contains(.commit))
        XCTAssertTrue(gesture.modifiers(command: false, shift: false, time: 20.4, active: true, tabHeld: true)
            .contains(.commit))
    }

    func testHeldTabRepeatsAreIgnoredButNextPressSteps() {
        var gesture = SwitchGesture()
        _ = gesture.tab(backwards: false, pressed: true, time: 1, active: false, commandHeld: true)
        XCTAssertEqual(gesture.tab(backwards: false, pressed: true, time: 1.5, active: true, commandHeld: true), [])
        _ = gesture.tab(backwards: false, pressed: false, time: 1.6, active: true, commandHeld: true)
        XCTAssertEqual(gesture.tab(backwards: false, pressed: true, time: 1.7, active: true, commandHeld: true),
                       [.stopRepeat, .step(1), .startRepeat])
    }

    func testLostTabReleaseDoesNotSwallowTheNextGesture() {
        var gesture = SwitchGesture()
        _ = gesture.tab(backwards: false, pressed: true, time: 1, active: false, commandHeld: true)
        // Carbon never delivers the release; ⌘ goes up with Tab physically released.
        _ = gesture.modifiers(command: false, shift: false, time: 1.2, active: true, tabHeld: false)
        XCTAssertFalse(gesture.tabDown)
        XCTAssertEqual(gesture.tab(backwards: false, pressed: true, time: 3, active: false, commandHeld: true),
                       [.stopRepeat, .begin(backwards: false), .startRepeat])
    }

    func testRepeatStopsWhenTabIsNoLongerHeld() {
        var gesture = SwitchGesture()
        _ = gesture.tab(backwards: false, pressed: true, time: 1, active: false, commandHeld: true)
        XCTAssertEqual(gesture.repeatStep(active: true, tabHeld: true), 1)
        XCTAssertNil(gesture.repeatStep(active: true, tabHeld: false))
    }

    func testShiftStepsBackwardAndRepeats() {
        var gesture = SwitchGesture()
        _ = gesture.tab(backwards: false, pressed: true, time: 1, active: false, commandHeld: true)
        _ = gesture.tab(backwards: false, pressed: false, time: 1.1, active: true, commandHeld: true)
        XCTAssertEqual(gesture.modifiers(command: true, shift: true, time: 1.2, active: true, tabHeld: false),
                       [.step(-1), .startRepeat])
        XCTAssertEqual(gesture.repeatStep(active: true, tabHeld: false), -1)
        XCTAssertEqual(gesture.modifiers(command: true, shift: false, time: 1.4, active: true, tabHeld: false),
                       [.stopRepeat])
    }

    func testBackwardGestureStartsBackward() {
        var gesture = SwitchGesture()
        XCTAssertEqual(gesture.tab(backwards: true, pressed: true, time: 1, active: false, commandHeld: true),
                       [.stopRepeat, .begin(backwards: true), .startRepeat])
        // Shift is already down, so it isn't a new backward step.
        XCTAssertEqual(gesture.modifiers(command: true, shift: true, time: 1.1, active: true, tabHeld: true), [])
    }

    func testNavigationKeysOnlyActDuringTheCurrentGesture() {
        var gesture = SwitchGesture()
        XCTAssertEqual(gesture.key(53, time: 1, active: false), [])
        _ = gesture.tab(backwards: false, pressed: true, time: 5, active: false, commandHeld: true)
        XCTAssertEqual(gesture.key(126, time: 4, active: true), [])
        XCTAssertEqual(gesture.key(53, time: 6, active: true), [.cancel])
        XCTAssertEqual(gesture.key(36, time: 6, active: true), [.commit])
        XCTAssertEqual(gesture.key(124, time: 6, active: true), [.move(.right)])
        XCTAssertEqual(gesture.key(0, time: 6, active: true), [])
    }
}

final class AppIdentityTests: XCTestCase {
    func testVersionsCompareNumerically() {
        XCTAssertEqual(AppIdentity.compare("0.1.10", "0.1.9"), .orderedDescending)
        XCTAssertEqual(AppIdentity.compare("0.2.0", "0.2.0"), .orderedSame)
        XCTAssertEqual(AppIdentity.compare("0.9.0", "1.0.0"), .orderedAscending)
    }
}

final class WindowCatalogTests: XCTestCase {
    func testUnvisitedWindowsSortLikeFinder() {
        let titles = ["Doc 10", "doc 2", "Doc 1"]
        let entries = titles.enumerated().map { index, title in
            WindowEntry(element: .application(pid_t(index + 1)), app: .current, title: title, minimized: false)
        }
        XCTAssertEqual(WindowStore.sorted(entries, recent: []).map(\.title), ["Doc 1", "doc 2", "Doc 10"])
    }

    func testRememberMovesWindowToFrontAndTracksMostRecent() {
        var catalog = WindowCatalog()
        let windows = sampleWindows()
        catalog.receive(windows, revision: catalog.revision)
        XCTAssertNil(catalog.mostRecent)
        catalog.remember(windows[2].identity)
        XCTAssertEqual(catalog.entries.first?.identity, windows[2].identity)
        XCTAssertEqual(catalog.mostRecent, windows[2].identity)
        XCTAssertTrue(catalog.contains(windows[0].identity))
        XCTAssertFalse(catalog.contains(.window(.application(999))))
    }

    func testStaleDiscoveryIsDiscardedAfterRemember() {
        var catalog = WindowCatalog()
        let revision = catalog.revision
        catalog.remember(sampleWindows()[0].identity)
        catalog.receive(sampleWindows(), revision: revision)
        XCTAssertTrue(catalog.entries.isEmpty)
    }
}
