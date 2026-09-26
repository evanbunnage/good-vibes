import AppKit
import ApplicationServices

/// Immutable reference to a remote UI element, not a local UI object. The raw
/// CF proxy is only messaged through AccessibilityClient on worker queues.
struct AXElement: @unchecked Sendable, Equatable {
    let rawValue: AXUIElement
    init(_ rawValue: AXUIElement) { self.rawValue = rawValue }
    static func application(_ pid: pid_t) -> Self { Self(AXUIElementCreateApplication(pid)) }
    static func == (lhs: Self, rhs: Self) -> Bool { CFEqual(lhs.rawValue, rhs.rawValue) }
}

enum AccessibilityFailure: Error, Equatable {
    case cancelled, permissionDenied, deadlineExceeded, invalidValue, tooManyChildren
    case api(Int32)

    var isMissing: Bool {
        self == .api(AXError.noValue.rawValue) || self == .api(AXError.attributeUnsupported.rawValue)
    }
    var isGone: Bool { self == .api(AXError.invalidUIElement.rawValue) }
}

/// The only test seam is the operating-system boundary. Production uses the
/// stateless native client; tests supply remote-app responses and failures.
protocol AccessibilityClient: Sendable {
    var trusted: Bool { get }
    var applications: [NSRunningApplication] { get }
    var frontmostApplication: NSRunningApplication? { get }
    func read(_ element: AXElement, _ attribute: String) throws -> CFTypeRef
    /// One round trip for several attributes; each has its own result.
    func read(_ element: AXElement, _ attributes: [String]) throws -> [Result<CFTypeRef, AccessibilityFailure>]
    func write(_ element: AXElement, _ attribute: String, _ value: CFTypeRef) throws
    func perform(_ element: AXElement, _ action: String) throws
    func children(_ element: AXElement, limit: Int) throws -> [AXElement]
    func supportsPress(_ element: AXElement) throws -> Bool
    func isRunning(_ app: NSRunningApplication) -> Bool
    func activate(_ app: NSRunningApplication) -> Bool
    func reopen(_ app: NSRunningApplication, completion: @escaping @Sendable (Bool) -> Void)
}

struct NativeAccessibilityClient: AccessibilityClient {
    private static let configured: Void = {
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.12)
    }()
    init() { _ = Self.configured }
    var trusted: Bool { AXIsProcessTrusted() }
    var applications: [NSRunningApplication] {
        NSWorkspace.shared.runningApplications.filter {
            $0.activationPolicy == .regular && $0.processIdentifier != ProcessInfo.processInfo.processIdentifier
        }
    }
    var frontmostApplication: NSRunningApplication? { NSWorkspace.shared.frontmostApplication }
    private func check(_ error: AXError) throws {
        guard error == .success else { throw AccessibilityFailure.api(error.rawValue) }
    }
    func read(_ element: AXElement, _ attribute: String) throws -> CFTypeRef {
        var value: CFTypeRef?
        try check(AXUIElementCopyAttributeValue(element.rawValue, attribute as CFString, &value))
        guard let value else { throw AccessibilityFailure.invalidValue }
        return value
    }
    func read(_ element: AXElement, _ attributes: [String]) throws -> [Result<CFTypeRef, AccessibilityFailure>] {
        var values: CFArray?
        try check(AXUIElementCopyMultipleAttributeValues(element.rawValue, attributes as CFArray,
                                                         AXCopyMultipleAttributeOptions(rawValue: 0), &values))
        guard let values = values as [CFTypeRef]?, values.count == attributes.count else {
            throw AccessibilityFailure.invalidValue
        }
        // A per-attribute failure comes back in place as an AXValue holding an AXError.
        return values.map { value in
            guard CFGetTypeID(value) == AXValueGetTypeID() else { return .success(value) }
            let axValue = value as! AXValue
            var error = AXError.success
            guard AXValueGetType(axValue) == .axError, AXValueGetValue(axValue, .axError, &error) else {
                return .success(value)
            }
            return .failure(.api(error.rawValue))
        }
    }
    func write(_ element: AXElement, _ attribute: String, _ value: CFTypeRef) throws {
        try check(AXUIElementSetAttributeValue(element.rawValue, attribute as CFString, value))
    }
    func perform(_ element: AXElement, _ action: String) throws {
        try check(AXUIElementPerformAction(element.rawValue, action as CFString))
    }
    func children(_ element: AXElement, limit: Int) throws -> [AXElement] {
        var count: CFIndex = 0
        try check(AXUIElementGetAttributeValueCount(element.rawValue, kAXChildrenAttribute as CFString, &count))
        guard count >= 0, count <= limit else { throw AccessibilityFailure.tooManyChildren }
        if count == 0 { return [] }
        var values: CFArray?
        try check(AXUIElementCopyAttributeValues(element.rawValue, kAXChildrenAttribute as CFString, 0, count, &values))
        guard let elements = values as? [AXUIElement] else { throw AccessibilityFailure.invalidValue }
        return elements.map(AXElement.init)
    }
    func supportsPress(_ element: AXElement) throws -> Bool {
        var actions: CFArray?
        try check(AXUIElementCopyActionNames(element.rawValue, &actions))
        return (actions as? [String])?.contains(kAXPressAction) == true
    }
    func isRunning(_ app: NSRunningApplication) -> Bool { !app.isTerminated }
    func activate(_ app: NSRunningApplication) -> Bool {
        app.unhide()
        return app.activate(options: [])
    }
    func reopen(_ app: NSRunningApplication, completion: @escaping @Sendable (Bool) -> Void) {
        ApplicationReopener().reopen(at: app.bundleURL, completion: completion)
    }
}

struct AccessibilityAccess: Sendable {
    let client: any AccessibilityClient
    let token: OperationToken
    private let deadline: TimeInterval

    init(client: any AccessibilityClient = NativeAccessibilityClient(),
         token: OperationToken = OperationToken(), budget: TimeInterval = .infinity) {
        self.client = client
        self.token = token
        deadline = ProcessInfo.processInfo.systemUptime + budget
    }
    func check() throws {
        if token.isCancelled { throw AccessibilityFailure.cancelled }
        if !client.trusted { throw AccessibilityFailure.permissionDenied }
        if ProcessInfo.processInfo.systemUptime >= deadline { throw AccessibilityFailure.deadlineExceeded }
    }
    func read(_ element: AXElement, _ name: String) throws -> CFTypeRef {
        try check()
        return try client.read(element, name)
    }
    /// Missing optional attributes are normal. Messaging failures still propagate.
    func optional(_ element: AXElement, _ name: String) throws -> CFTypeRef? {
        do { return try read(element, name) }
        catch let failure as AccessibilityFailure where failure.isMissing { return nil }
    }
    /// Several optional attributes in one round trip, with the same missing-value rules.
    func optional(_ element: AXElement, _ names: [String]) throws -> [CFTypeRef?] {
        try check()
        return try client.read(element, names).map { result in
            switch result {
            case .success(let value): return value
            case .failure(let failure) where failure.isMissing: return nil
            case .failure(let failure): throw failure
            }
        }
    }
    func write(_ element: AXElement, _ name: String, _ value: CFTypeRef) throws {
        try check()
        try client.write(element, name, value)
    }
    func perform(_ element: AXElement, _ action: String) throws {
        try check()
        try client.perform(element, action)
    }
    func children(_ element: AXElement, limit: Int) throws -> [AXElement] {
        try check()
        let result = try client.children(element, limit: limit)
        try check()
        return result
    }
    func supportsPress(_ element: AXElement) throws -> Bool {
        try check()
        return try client.supportsPress(element)
    }
    func limited(to budget: TimeInterval) -> Self {
        Self(client: client, token: token,
             budget: min(budget, deadline - ProcessInfo.processInfo.systemUptime))
    }
}

/// Audited synchronization boundary: every access to mutable state holds lock.
final class OperationToken: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }
    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }
}
