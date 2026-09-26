import AppKit
import ApplicationServices

extension WindowStore {
    /// Enumerate all ordinary windows before optional tab work. There is no
    /// per-app wall-clock cutoff that can starve windows later in the list.
    static func snapshot(apps: [NSRunningApplication], includeTabs: Bool,
                         previous: [WindowEntry], access: AccessibilityAccess) throws -> [WindowEntry] {
        var entries: [WindowEntry] = []
        for app in apps {
            try access.check()
            let old = previous.filter { $0.app == app }
            let windows: [AXElement]
            do {
                let value = try access.read(.application(app.processIdentifier), kAXWindowsAttribute)
                guard let raw = value as? [AXUIElement] else { throw AccessibilityFailure.invalidValue }
                windows = raw.map(AXElement.init)
            } catch let failure as AccessibilityFailure where failure.isGone {
                continue
            } catch let failure as AccessibilityFailure where failure.isMissing {
                entries.append(WindowEntry(app: app))
                continue
            } catch {
                try access.check()
                entries += old.isEmpty ? [WindowEntry(app: app)] : old
                continue
            }
            var appEntries: [WindowEntry] = []
            for window in windows {
                do {
                    if let entry = try readWindow(window, app: app, access: access) { appEntries.append(entry) }
                } catch let failure as AccessibilityFailure where failure.isGone {
                    continue
                } catch {
                    try access.check()
                    // A timeout doesn't establish that a previously observed window closed.
                    appEntries += old.filter { $0.window == window }
                }
            }
            entries += appEntries.isEmpty ? [WindowEntry(app: app)] : appEntries
        }
        guard includeTabs else { return entries }
        var enriched: [WindowEntry] = []
        for entry in entries {
            try access.check()
            guard let window = entry.element else { enriched.append(entry); continue }
            do {
                guard try access.optional(window, kAXSubroleAttribute) as? String == kAXStandardWindowSubrole,
                      let tabs = try AccessibilityTabs.snapshot(window: window, access: access.limited(to: 0.2)) else {
                    enriched.append(entry)
                    continue
                }
                enriched += tabs.map { WindowEntry(tab: $0, app: entry.app, minimized: entry.minimized) }
            } catch {
                try access.check()
                enriched.append(entry)
            }
        }
        return enriched
    }

    private static func readWindow(_ window: AXElement, app: NSRunningApplication,
                                   access: AccessibilityAccess) throws -> WindowEntry? {
        let values = try access.optional(window, [kAXSubroleAttribute, kAXTitleAttribute, kAXMinimizedAttribute])
        let subrole = values[0] as? String
        guard subrole == kAXStandardWindowSubrole || subrole == kAXDialogSubrole else { return nil }
        let title = (values[1] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let minimized = values[2] as? Bool ?? false
        return WindowEntry(element: window, app: app, title: title.isEmpty ? "Untitled window" : title, minimized: minimized)
    }

    static func focusedIdentity(in entries: [WindowEntry], app: NSRunningApplication?,
                                access: AccessibilityAccess) throws -> EntryIdentity? {
        guard let app else { return nil }
        guard let value = try access.optional(.application(app.processIdentifier), kAXFocusedWindowAttribute) else {
            return .application(app.processIdentifier)
        }
        guard CFGetTypeID(value) == AXUIElementGetTypeID() else { throw AccessibilityFailure.invalidValue }
        let window = AXElement(value as! AXUIElement)
        for entry in entries where entry.app == app {
            guard let tab = entry.tab, tab.window == window else { continue }
            if (try access.optional(tab.element, kAXValueAttribute) as? NSNumber)?.boolValue == true {
                return entry.identity
            }
        }
        return .window(window)
    }
}
