import AppKit
import ApplicationServices

/// Which desktop each window is on: AeroSpace workspaces when AeroSpace is running,
/// otherwise macOS Spaces numbered like Mission Control. Both are best effort; a
/// window missing from the result simply shows no desktop.
enum Desktops {
    static func windowID(_ element: AXElement) -> CGWindowID? {
        var id: CGWindowID = 0
        return _AXUIElementGetWindow(element.rawValue, &id) == .success && id != 0 ? id : nil
    }

    static func labels(for windows: [CGWindowID]) -> [CGWindowID: String] {
        guard !windows.isEmpty else { return [:] }
        if !NSRunningApplication.runningApplications(withBundleIdentifier: "bobko.aerospace").isEmpty {
            // AeroSpace keeps every workspace on one macOS Space, so Spaces would say nothing useful.
            return aeroSpaceWorkspaces() ?? [:]
        }
        return spaces(for: windows)
    }

    // MARK: AeroSpace

    private static let aeroSpacePaths = ["/opt/homebrew/bin/aerospace", "/usr/local/bin/aerospace"]

    private static func aeroSpaceWorkspaces() -> [CGWindowID: String]? {
        guard let path = aeroSpacePaths.first(where: FileManager.default.isExecutableFile(atPath:)) else { return nil }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = ["list-windows", "--all", "--json", "--format", "%{window-id} %{workspace}"]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return nil }
        // The CLI waits on the AeroSpace server; don't let a stuck server hold up the switcher.
        let timeout = DispatchWorkItem { process.terminate() }
        DispatchQueue.global().asyncAfter(deadline: .now() + 1, execute: timeout)
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        timeout.cancel()
        guard process.terminationStatus == 0,
              let windows = try? JSONDecoder().decode([AeroSpaceWindow].self, from: data) else { return nil }
        return Dictionary(windows.map { ($0.id, $0.workspace) }, uniquingKeysWith: { first, _ in first })
    }

    private struct AeroSpaceWindow: Decodable {
        let id: CGWindowID
        let workspace: String
        enum CodingKeys: String, CodingKey {
            case id = "window-id"
            case workspace
        }
    }

    // MARK: macOS Spaces

    private static func spaces(for windows: [CGWindowID]) -> [CGWindowID: String] {
        let connection = CGSMainConnectionID()
        // Mission Control numbers desktops per display and names full-screen spaces separately.
        var names: [UInt64: String] = [:]
        let displays = CGSCopyManagedDisplaySpaces(connection) as? [[String: Any]] ?? []
        for display in displays {
            var desktop = 0
            for space in display["Spaces"] as? [[String: Any]] ?? [] {
                guard let id = (space["id64"] ?? space["ManagedSpaceID"]) as? NSNumber else { continue }
                if (space["type"] as? NSNumber)?.intValue == fullScreenSpaceType {
                    names[id.uint64Value] = "Full Screen"
                } else {
                    desktop += 1
                    names[id.uint64Value] = "\(desktop)"
                }
            }
        }
        var labels: [CGWindowID: String] = [:]
        for window in windows {
            let spaces = CGSCopySpacesForWindows(connection, allSpacesMask, [NSNumber(value: window)] as CFArray)
            // A window on every Space (sticky) or on none (minimized) has no one desktop.
            guard let ids = spaces as? [NSNumber], ids.count == 1, let name = names[ids[0].uint64Value] else { continue }
            labels[window] = name
        }
        return labels
    }

    private static let fullScreenSpaceType = 4
    private static let allSpacesMask: Int32 = 0x7
}

@_silgen_name("_AXUIElementGetWindow")
private func _AXUIElementGetWindow(_ element: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError

@_silgen_name("CGSMainConnectionID")
private func CGSMainConnectionID() -> Int32

@_silgen_name("CGSCopyManagedDisplaySpaces")
private func CGSCopyManagedDisplaySpaces(_ connection: Int32) -> CFArray

@_silgen_name("CGSCopySpacesForWindows")
private func CGSCopySpacesForWindows(_ connection: Int32, _ mask: Int32, _ windows: CFArray) -> CFArray
