import AppKit
import ApplicationServices

struct AppTab: Sendable {
    let element: AXElement
    let window: AXElement
    let title: String
    let selected: Bool
}

enum AccessibilityTabs {
    /// Only direct window tab groups qualify. Unsupported structures fall back
    /// to the window; read failures are preserved for the caller to handle.
    static func snapshot(window: AXElement, access: AccessibilityAccess) throws -> [AppTab]? {
        let children = try access.children(window, limit: 64)
        var groups = [[AppTab]]()
        for child in children {
            guard try access.optional(child, kAXRoleAttribute) as? String == "AXTabGroup" else { continue }
            var tabs = [AppTab]()
            for button in try access.children(child, limit: 128) {
                let role = try access.optional(button, kAXRoleAttribute) as? String
                let subrole = try access.optional(button, kAXSubroleAttribute) as? String
                guard subrole == "AXTabButton" || role == "AXRadioButton" else { continue }
                guard let title = try access.optional(button, kAXTitleAttribute) as? String,
                      !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      try access.supportsPress(button),
                      let selected = try access.optional(button, kAXValueAttribute) as? NSNumber else { return nil }
                tabs.append(AppTab(element: button, window: window, title: title, selected: selected.boolValue))
            }
            if tabs.count > 1 { groups.append(tabs) }
        }
        try access.check()
        guard groups.count == 1, groups[0].filter({ $0.selected }).count == 1 else { return nil }
        return groups[0]
    }
}
