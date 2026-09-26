import AppKit
import ApplicationServices

enum FocusStage: Sendable, Equatable { case validate, restore, raise, selectTab }
enum FocusFailure: Error, Equatable {
    case cancelled, permissionDenied, staleTarget, activationFailed, reopenFailed
    case accessibility(FocusStage, AccessibilityFailure)
}

struct WindowFocus: Sendable {
    let client: any AccessibilityClient
    init(client: any AccessibilityClient = NativeAccessibilityClient()) { self.client = client }

    func focus(_ entry: WindowEntry, token: OperationToken, queue: DispatchQueue,
               completion: @escaping @Sendable (Result<Void, FocusFailure>) -> Void) {
        let access = AccessibilityAccess(client: client, token: token)
        do { try validatePermission(entry, access: access) }
        catch { completion(.failure(failure(error, stage: .validate))); return }
        if entry.isApplicationOnly {
            client.reopen(entry.app) { success in
                do {
                    try validatePermission(entry, access: access)
                    completion(success ? .success(()) : .failure(.reopenFailed))
                } catch { completion(.failure(failure(error, stage: .validate))) }
            }
            return
        }
        let result = attempt(entry, access: access)
        // Only a failed restore warrants a reopen. Activation and tab failures
        // must not reopen the app or accidentally create a different window.
        guard case .failure(.accessibility(.restore, _)) = result else { completion(result); return }
        do { try validatePermission(entry, access: access) }
        catch { completion(.failure(failure(error, stage: .validate))); return }
        client.reopen(entry.app) { success in
            queue.async {
                guard success else { completion(.failure(.reopenFailed)); return }
                completion(attempt(entry, access: access))
            }
        }
    }

    private func attempt(_ entry: WindowEntry, access: AccessibilityAccess) -> Result<Void, FocusFailure> {
        var stage = FocusStage.validate
        do {
            try validatePermission(entry, access: access)
            guard let window = entry.window else { throw FocusFailure.staleTarget }
            if let tab = entry.tab {
                let current = try AccessibilityTabs.snapshot(window: window, access: access.limited(to: 0.2))
                guard current?.contains(where: { $0.element == tab.element }) == true else { throw FocusFailure.staleTarget }
            } else {
                _ = try access.read(window, kAXRoleAttribute)
            }
            let minimized = try access.optional(window, kAXMinimizedAttribute) as? Bool ?? entry.minimized
            if minimized {
                stage = .restore
                try access.write(window, kAXMinimizedAttribute, kCFBooleanFalse)
            }
            try validatePermission(entry, access: access)
            // Since macOS 14 the system may decline activation requested by a background
            // app, even when the request reports success. Accessibility's frontmost
            // attribute is honored, so ask both ways; either one is enough.
            let activated = client.activate(entry.app)
            let frontmost = (try? access.write(.application(entry.app.processIdentifier),
                                                kAXFrontmostAttribute, kCFBooleanTrue)) != nil
            guard activated || frontmost else { throw FocusFailure.activationFailed }
            stage = .raise
            // Some dialog windows don't support Main. Raising is required.
            _ = try? access.write(window, kAXMainAttribute, kCFBooleanTrue)
            try access.perform(window, kAXRaiseAction)
            if let tab = entry.tab {
                stage = .selectTab
                try access.perform(tab.element, kAXPressAction)
            }
            return .success(())
        } catch { return .failure(failure(error, stage: stage)) }
    }

    private func validatePermission(_ entry: WindowEntry, access: AccessibilityAccess) throws {
        try access.check()
        if !client.isRunning(entry.app) { throw FocusFailure.staleTarget }
    }
    private func failure(_ error: Error, stage: FocusStage) -> FocusFailure {
        if let failure = error as? FocusFailure { return failure }
        let failure = error as? AccessibilityFailure ?? .invalidValue
        switch failure {
        case .cancelled: return .cancelled
        case .permissionDenied: return .permissionDenied
        default: return failure.isGone ? .staleTarget : .accessibility(stage, failure)
        }
    }
}
