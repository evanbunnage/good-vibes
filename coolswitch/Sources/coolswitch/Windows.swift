import AppKit
import ApplicationServices

struct WindowEntry: Sendable {
    let element: AXElement?
    let app: NSRunningApplication
    let title: String
    let minimized: Bool
    let tab: AppTab?
    /// The window server's ID, used to look up which desktop the window is on.
    let windowID: CGWindowID?

    init(element: AXElement, app: NSRunningApplication, title: String, minimized: Bool, windowID: CGWindowID? = nil) {
        self.element = element
        self.app = app
        self.title = title
        self.minimized = minimized
        self.tab = nil
        self.windowID = windowID
    }

    init(tab: AppTab, app: NSRunningApplication, minimized: Bool = false, windowID: CGWindowID? = nil) {
        self.element = nil
        self.app = app
        self.title = tab.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Untitled tab" : tab.title
        self.minimized = minimized
        self.tab = tab
        self.windowID = windowID
    }

    init(app: NSRunningApplication) {
        self.element = nil
        self.app = app
        self.title = app.localizedName ?? "Application"
        self.minimized = false
        self.tab = nil
        self.windowID = nil
    }

    var isApplicationOnly: Bool { element == nil && tab == nil }
    var window: AXElement? { tab?.window ?? element }

    var identity: EntryIdentity {
        if let tab { return .tab(tab.element) }
        if let element { return .window(element) }
        return .application(app.processIdentifier)
    }

    var subtitle: String {
        if isApplicationOnly { return "" }
        var details: [String] = []
        if tab != nil { details.append("Tab") }
        if minimized { details.append("Minimized") }
        return details.joined(separator: " · ")
    }
}

enum EntryIdentity: Equatable, Sendable {
    case application(pid_t)
    case window(AXElement)
    case tab(AXElement)

    static func == (lhs: Self, rhs: Self) -> Bool {
        switch (lhs, rhs) {
        case let (.application(a), .application(b)): return a == b
        case let (.window(a), .window(b)): return a == b
        case let (.tab(a), .tab(b)): return a == b
        default: return false
        }
    }
}

enum WindowStore {
    /// Windows before window-less apps, then most recently used, then by app and title.
    static func sorted(_ entries: [WindowEntry], recent: [EntryIdentity]) -> [WindowEntry] {
        entries.sorted { a, b in
            if a.isApplicationOnly != b.isApplicationOnly { return !a.isApplicationOnly }
            let ai = recent.firstIndex { $0 == a.identity } ?? Int.max
            let bi = recent.firstIndex { $0 == b.identity } ?? Int.max
            if ai != bi { return ai < bi }
            // Finder order: "Doc 2" before "Doc 10", case- and accent-aware.
            let names = (a.app.localizedName ?? "").localizedStandardCompare(b.app.localizedName ?? "")
            if names != .orderedSame { return names == .orderedAscending }
            return a.title.localizedStandardCompare(b.title) == .orderedAscending
        }
    }

    static func initialSelection(_ entries: [WindowEntry], focused: EntryIdentity?, backwards: Bool) -> Int {
        guard !entries.isEmpty else { return 0 }
        if backwards {
            let last = entries.count - 1
            return last > 0 && entries[last].identity == focused ? last - 1 : last
        }
        if entries[0].identity == focused, entries.count > 1 { return 1 }
        return 0
    }
}
