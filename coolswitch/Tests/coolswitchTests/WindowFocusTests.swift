import XCTest
import AppKit
import ApplicationServices
@testable import coolswitch

final class WindowFocusTests: XCTestCase {
    private func run(_ entry: WindowEntry, client: TestAccessibilityClient, token: OperationToken = OperationToken(),
                     expected: FocusFailure?, afterStart: () -> Void = {}) {
        let finished = expectation(description: "Focus completed")
        WindowFocus(client: client).focus(entry, token: token, queue: DispatchQueue(label: "test-focus")) { result in
            switch result {
            case .success: XCTAssertNil(expected)
            case .failure(let error): XCTAssertEqual(error, expected)
            }
            finished.fulfill()
        }
        afterStart()
        wait(for: [finished], timeout: 2)
    }
    func testSameTitleReplacementDoesNotMatchStaleTab() {
        let fixture = TabFixture()
        let entry = WindowEntry(tab: AppTab(element: .application(999), window: fixture.window, title: "Same title", selected: false), app: .current)
        run(entry, client: fixture.client, expected: .staleTarget)
        XCTAssertFalse(fixture.client.withState { $0.calls.contains("activate") })
    }
    func testPermissionLossOrCancellationDuringReopenStopsRetry() {
        for revokePermission in [true, false] {
            let client = TestAccessibilityClient()
            let window = AXElement.application(101)
            let token = OperationToken()
            client.window(window, minimized: true)
            client.withState { $0.failures["write:\(kAXMinimizedAttribute)"] = .api(AXError.cannotComplete.rawValue) }
            let entry = WindowEntry(element: window, app: .current, title: "Window", minimized: true)
            run(entry, client: client, token: token, expected: revokePermission ? .permissionDenied : .cancelled) {
                if revokePermission { client.withState { $0.trusted = false } }
                else { token.cancel() }
                client.completeReopen(true)
            }
            XCTAssertFalse(client.withState { $0.calls.contains("activate") })
        }
    }
}
