import XCTest
import CoreGraphics
@testable import coolswitch

final class KeyboardEventPolicyTests: XCTestCase {
    func testOrdinaryTypingAndTabNeverGetSuppressed() {
        var policy = KeyboardEventPolicy()
        XCTAssertFalse(policy.needsFilter)
        for active in [false, true] {
            policy.setActive(active)
            for code in Int64(0)...127 where !KeyboardEventPolicy.isSessionKey(code) {
                XCTAssertFalse(policy.key(.keyDown, code: code, repeating: false).consume)
                XCTAssertFalse(policy.key(.keyUp, code: code, repeating: false).consume)
            }
        }
    }

    func testEndingSessionDrainsOnlyKeysItAlreadyConsumed() {
        var policy = KeyboardEventPolicy()
        policy.setActive(true)
        XCTAssertTrue(policy.key(.keyDown, code: 123, repeating: false).act)
        policy.setActive(false)
        XCTAssertTrue(policy.needsFilter)
        let repeatEvent = policy.key(.keyDown, code: 123, repeating: true)
        XCTAssertTrue(repeatEvent.consume)
        XCTAssertFalse(repeatEvent.act)
        XCTAssertFalse(policy.key(.keyDown, code: 53, repeating: false).consume)
        XCTAssertTrue(policy.key(.keyUp, code: 123, repeating: false).consume)
        XCTAssertFalse(policy.needsFilter)
        XCTAssertFalse(policy.key(.keyDown, code: 123, repeating: false).consume)
    }

    func testMissingKeyUpDoesNotSwallowTheNextPhysicalPress() {
        var policy = KeyboardEventPolicy()
        policy.setActive(true)
        _ = policy.key(.keyDown, code: 123, repeating: false)
        policy.setActive(false)
        XCTAssertFalse(policy.key(.keyDown, code: 123, repeating: false).consume)
        XCTAssertFalse(policy.needsFilter)
        XCTAssertFalse(policy.key(.keyUp, code: 123, repeating: false).consume)
    }

    func testCancelAndCommitCloseFilterBeforeMainThreadHandlesAction() {
        for code: Int64 in [53, 36, 76] {
            var policy = KeyboardEventPolicy()
            policy.setActive(true)
            XCTAssertTrue(policy.key(.keyDown, code: code, repeating: false).act)
            XCTAssertFalse(policy.active)
            XCTAssertFalse(policy.key(.keyDown, code: 123, repeating: false).consume)
            XCTAssertFalse(policy.key(.keyDown, code: code, repeating: true).act)
            XCTAssertTrue(policy.key(.keyUp, code: code, repeating: false).consume)
            XCTAssertFalse(policy.needsFilter)
        }
    }

    func testTimeoutAndSystemDisableCannotReenableInterception() {
        for reason in [KeyboardEventPolicy.Failure.timeout, .disabledBySystem] {
            var policy = KeyboardEventPolicy()
            policy.setActive(true)
            _ = policy.key(.keyDown, code: 123, repeating: false)
            policy.disable(reason)
            policy.setActive(true)
            policy.disable(.timeout)
            XCTAssertEqual(policy.failure, reason)
            XCTAssertFalse(policy.needsFilter)
            XCTAssertFalse(policy.key(.keyDown, code: 53, repeating: false).consume)
            XCTAssertFalse(policy.key(.keyUp, code: 123, repeating: false).consume)
        }
    }

    func testInterruptionDropsInterceptionWithoutFailing() {
        var policy = KeyboardEventPolicy()
        policy.setActive(true)
        _ = policy.key(.keyDown, code: 123, repeating: false)
        policy.interrupt()
        XCTAssertNil(policy.failure)
        XCTAssertFalse(policy.needsFilter)
        XCTAssertFalse(policy.key(.keyUp, code: 123, repeating: false).consume)
        policy.setActive(true)
        XCTAssertTrue(policy.key(.keyDown, code: 53, repeating: false).act)
    }
}
