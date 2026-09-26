import XCTest
import AppKit
import ApplicationServices
@testable import coolswitch

@MainActor
final class WindowWorkTests: XCTestCase {
    func testRealFocusPipelineCompletesWhileDiscoveryIsBlocked() async {
        let client = TestAccessibilityClient()
        let work = WindowWork(client: client)
        let scanning = expectation(description: "Discovery entered remote read")
        let focused = expectation(description: "Selected window was raised")
        let finished = expectation(description: "Discovery completed")
        let release = DispatchSemaphore(value: 0)
        client.withState { state in
            state.onRead = { _, name in
                if name == kAXWindowsAttribute {
                    scanning.fulfill()
                    _ = release.wait(timeout: .now() + 3)
                }
            }
        }
        let discoveryToken = OperationToken()
        work.discover(includeTabs: false, previous: [], token: discoveryToken) { _, _ in finished.fulfill() }
        await fulfillment(of: [scanning], timeout: 2)
        let window = AXElement.application(101)
        client.window(window)
        work.focus(WindowEntry(element: window, app: .current, title: "Window", minimized: false), token: OperationToken()) { result in
            if case .failure(let failure) = result { XCTFail("Focus failed: \(failure)") }
            focused.fulfill()
        }
        await fulfillment(of: [focused], timeout: 1)
        discoveryToken.cancel()
        release.signal()
        await fulfillment(of: [finished], timeout: 2)
        XCTAssertTrue(client.withState { $0.calls.contains("perform:\(kAXRaiseAction)") })
    }
}
