import AppKit

/// Blocking Accessibility IPC stays on dedicated queues. Only immutable models
/// cross back to the main actor; worker closures never capture the UI controller.
@MainActor
final class WindowWork: SwitchWorking {
    private let discoveryQueue = DispatchQueue(label: "window-discovery", qos: .utility)
    private let focusQueue = DispatchQueue(label: "window-focus", qos: .userInitiated)
    private let client: any AccessibilityClient
    init(client: any AccessibilityClient = NativeAccessibilityClient()) { self.client = client }

    /// Running apps that can own windows. No Accessibility calls.
    var applications: [NSRunningApplication] { client.applications }

    func discover(includeTabs: Bool, previous: [WindowEntry], token: OperationToken,
                  completion: @escaping @MainActor @Sendable (Result<[WindowEntry], AccessibilityFailure>, EntryIdentity?) -> Void) {
        let client = client
        let apps = client.applications
        discoveryQueue.async {
            let access = AccessibilityAccess(client: client, token: token)
            do {
                let entries = try WindowStore.snapshot(apps: apps, includeTabs: includeTabs, previous: previous, access: access)
                let focused = try? WindowStore.focusedIdentity(in: entries, app: client.frontmostApplication,
                                                              access: access.limited(to: 0.2))
                DispatchQueue.main.async { completion(.success(entries), focused) }
            } catch {
                let failure = error as? AccessibilityFailure ?? .invalidValue
                DispatchQueue.main.async { completion(.failure(failure), nil) }
            }
        }
    }

    func resolve(_ entries: [WindowEntry], token: OperationToken,
                 completion: @escaping @MainActor @Sendable (Result<EntryIdentity?, AccessibilityFailure>) -> Void) {
        let client = client
        focusQueue.async {
            let result: Result<EntryIdentity?, AccessibilityFailure>
            do {
                result = .success(try WindowStore.focusedIdentity(in: entries, app: client.frontmostApplication,
                    access: AccessibilityAccess(client: client, token: token, budget: 0.2)))
            } catch { result = .failure(error as? AccessibilityFailure ?? .invalidValue) }
            DispatchQueue.main.async { completion(result) }
        }
    }

    func focus(_ entry: WindowEntry, token: OperationToken,
               completion: @escaping @MainActor @Sendable (Result<Void, FocusFailure>) -> Void) {
        let client = client
        let queue = focusQueue
        queue.async {
            WindowFocus(client: client).focus(entry, token: token, queue: queue) { result in
                DispatchQueue.main.async { completion(result) }
            }
        }
    }
}
