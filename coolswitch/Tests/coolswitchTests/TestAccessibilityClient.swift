import AppKit
import ApplicationServices
import XCTest
@testable import coolswitch

/// Test-only mutable remote-app simulator. All state is protected by a lock;
/// hooks execute outside it so tests can deliberately block one remote request.
final class TestAccessibilityClient: AccessibilityClient, @unchecked Sendable {
    struct State {
        var trusted = true
        var values: [String: Result<CFTypeRef, AccessibilityFailure>] = [:]
        var children: [Int32: [AXElement]] = [:]
        var calls: [String] = []
        var failures: [String: AccessibilityFailure] = [:]
        var activation = true
        var pressable = true
        var reopenCompletion: (@Sendable (Bool) -> Void)?
        var onRead: (@Sendable (AXElement, String) -> Void)?
    }
    private let lock = NSLock()
    private var state = State()
    func withState<T>(_ body: (inout State) -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body(&state)
    }
    static func id(_ element: AXElement) -> Int32 {
        var pid: pid_t = 0
        AXUIElementGetPid(element.rawValue, &pid)
        return pid
    }
    static func key(_ element: AXElement, _ name: String) -> String { "\(id(element)):\(name)" }
    func set(_ element: AXElement, _ name: String, _ value: CFTypeRef) {
        withState { $0.values[Self.key(element, name)] = .success(value) }
    }
    func window(_ element: AXElement, title: String = "Window", minimized: Bool = false) {
        set(element, kAXRoleAttribute, kAXWindowRole as CFString)
        set(element, kAXSubroleAttribute, kAXStandardWindowSubrole as CFString)
        set(element, kAXTitleAttribute, title as CFString)
        set(element, kAXMinimizedAttribute, NSNumber(value: minimized))
    }
    var trusted: Bool { withState { $0.trusted } }
    var applications: [NSRunningApplication] { [.current] }
    var frontmostApplication: NSRunningApplication? { .current }
    func read(_ element: AXElement, _ name: String) throws -> CFTypeRef {
        let hook = withState { $0.onRead }
        hook?(element, name)
        let result = withState { state in
            state.calls.append("read:\(Self.key(element, name))")
            return state.values[Self.key(element, name)] ?? .failure(.api(AXError.noValue.rawValue))
        }
        return try result.get()
    }
    func read(_ element: AXElement, _ names: [String]) throws -> [Result<CFTypeRef, AccessibilityFailure>] {
        names.map { name in Result { try read(element, name) }.mapError { $0 as? AccessibilityFailure ?? .invalidValue } }
    }
    func write(_ element: AXElement, _ name: String, _ value: CFTypeRef) throws {
        let error = withState { state in
            state.calls.append("write:\(name)")
            return state.failures["write:\(name)"]
        }
        if let error { throw error }
        set(element, name, value)
    }
    func perform(_ element: AXElement, _ action: String) throws {
        let error = withState { state in
            state.calls.append("perform:\(action)")
            return state.failures["perform:\(action)"]
        }
        if let error { throw error }
    }
    func children(_ element: AXElement, limit: Int) throws -> [AXElement] {
        let result = withState { $0.children[Self.id(element)] ?? [] }
        guard result.count <= limit else { throw AccessibilityFailure.tooManyChildren }
        return result
    }
    func supportsPress(_ element: AXElement) throws -> Bool { withState { $0.pressable } }
    func isRunning(_ app: NSRunningApplication) -> Bool { true }
    func activate(_ app: NSRunningApplication) -> Bool {
        withState { $0.calls.append("activate"); return $0.activation }
    }
    func reopen(_ app: NSRunningApplication, completion: @escaping @Sendable (Bool) -> Void) {
        withState { $0.calls.append("reopen"); $0.reopenCompletion = completion }
    }
    func completeReopen(_ success: Bool) {
        let completion = withState { state in
            let completion = state.reopenCompletion
            state.reopenCompletion = nil
            return completion
        }
        completion?(success)
    }
}

func sampleWindows() -> [WindowEntry] {
    (1...3).map { WindowEntry(element: .application(pid_t($0)), app: .current,
                             title: "Window \($0)", minimized: false) }
}

struct TabFixture {
    let client = TestAccessibilityClient()
    let window = AXElement.application(101)
    let group = AXElement.application(102)
    let first = AXElement.application(103)
    let second = AXElement.application(104)
    init() {
        client.window(window)
        client.withState { $0.children[101] = [group]; $0.children[102] = [first, second] }
        client.set(group, kAXRoleAttribute, "AXTabGroup" as CFString)
        for (element, selected) in [(first, true), (second, false)] {
            client.set(element, kAXRoleAttribute, "AXRadioButton" as CFString)
            client.set(element, kAXTitleAttribute, "Same title" as CFString)
            client.set(element, kAXValueAttribute, NSNumber(value: selected))
        }
    }
}
