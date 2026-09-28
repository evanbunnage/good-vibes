import AppKit
import SwiftUI
import ApplicationServices
import ServiceManagement

@MainActor
final class SettingsModel: ObservableObject {
    @Published var trusted = AXIsProcessTrusted()
    @Published var ready = false
    @Published private(set) var stoppedReason: String?
    @Published var openingSettings = false
    @Published var waitingForPermission = false
    @Published var settingsError: String?
    @Published private(set) var openAtLogin = false
    @Published private(set) var loginItemNeedsApproval = false
    @Published var loginItemError: String?
    var menuBarIconChanged: () -> Void = {}
    var includeTabsChanged: () -> Void = {}
    var requestAccessibility: () -> Void = {}
    var retryKeyboard: () -> Void = {}
    var setOpenAtLogin: (Bool) -> Void = { _ in }

    var keyboardStopped: Bool { stoppedReason != nil }

    func beginPermissionRequest() {
        openingSettings = true
        waitingForPermission = true
        settingsError = nil
    }

    func settingsOpened(failed: Bool) {
        openingSettings = false
        if failed {
            waitingForPermission = false
            settingsError = "Couldn’t open System Settings."
        }
    }

    func permissionChanged(trusted: Bool) {
        if self.trusted != trusted { self.trusted = trusted }
        if trusted && waitingForPermission { waitingForPermission = false }
    }

    func keyboardStopped(reason: String) { stoppedReason = reason }
    func keyboardRestarted() { stoppedReason = nil }

    func loginItemChanged(_ status: SMAppService.Status) {
        openAtLogin = status == .enabled || status == .requiresApproval
        loginItemNeedsApproval = status == .requiresApproval
        if status == .enabled { loginItemError = nil }
    }
}

private struct SettingsView: View {
    @ObservedObject var model: SettingsModel
    let dismiss: () -> Void
    @AppStorage("showMenuBarIcon") private var showMenuBarIcon = false
    @AppStorage("includeTabs") private var includeTabs = true

    var body: some View {
        Group {
            if model.trusted { preferences } else { onboarding }
        }
        .frame(width: 400, height: 380)
    }

    private var onboarding: some View {
        VStack(spacing: 28) {
            Image(systemName: "rectangle.on.rectangle")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(Color.accentColor)
                .accessibilityHidden(true)
            Text("CoolSwitch needs Accessibility access").font(.title3.bold())
            VStack(spacing: 12) {
                Button(action: model.requestAccessibility) {
                    Text("Open System Settings")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)
                .disabled(model.openingSettings)
                if model.waitingForPermission {
                    VStack(spacing: 4) {
                        HStack(spacing: 8) {
                            SettingsSpinner()
                            Text("Waiting for access…")
                        }
                        // Privacy & Security often takes several seconds to show Accessibility.
                        Text("System Settings can take a moment to open.")
                            .foregroundStyle(.secondary)
                    }
                    .font(.callout)
                }
            }
            if let error = model.settingsError {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var preferences: some View {
        VStack(alignment: .leading, spacing: 20) {
            status
            Divider()
            VStack(alignment: .leading, spacing: 12) {
                Toggle("Open at login", isOn: Binding(get: { model.openAtLogin },
                                                      set: { model.setOpenAtLogin($0) }))
                if model.loginItemNeedsApproval {
                    HStack(spacing: 6) {
                        Text("Allow CoolSwitch in Login Items.").foregroundStyle(.secondary)
                        Button("Open Login Items") { SMAppService.openSystemSettingsLoginItems() }
                            .buttonStyle(.link)
                    }
                    .font(.callout)
                }
                if let error = model.loginItemError {
                    Text(error).font(.callout).foregroundStyle(.secondary)
                }
                Toggle("Show in menu bar", isOn: $showMenuBarIcon)
                    .onChange(of: showMenuBarIcon) { _ in model.menuBarIconChanged() }
                Toggle("Include tabs in window switcher", isOn: $includeTabs)
                    .onChange(of: includeTabs) { _ in model.includeTabsChanged() }
            }
            Spacer(minLength: 0)
            HStack {
                Text("CoolSwitch \(AppIdentity.version)").foregroundStyle(.secondary)
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }
                Button("Done", action: dismiss)
                    .keyboardShortcut(.defaultAction)
            }
            .font(.callout)
        }
        .padding(24)
    }

    @ViewBuilder private var status: some View {
        if let reason = model.stoppedReason {
            VStack(alignment: .leading, spacing: 8) {
                Text("Window switching stopped").font(.title2.bold())
                Text(reason).fixedSize(horizontal: false, vertical: true)
                Button("Try Again", action: model.retryKeyboard)
            }
        } else if model.ready {
            VStack(alignment: .leading, spacing: 8) {
                Text("Success!").font(.title2.bold())
                Text("⌘Tab to switch windows.")
                    .fixedSize(horizontal: false, vertical: true)
                Text("While holding ⌘, press Shift to go back.")
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            HStack(spacing: 8) {
                SettingsSpinner()
                Text("Finishing setup…").font(.title2.bold())
            }
        }
    }
}

private struct SettingsSpinner: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spinning = false

    var body: some View {
        Circle()
            .trim(from: 0, to: 0.75)
            .stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round))
            .frame(width: 12, height: 12)
            .rotationEffect(.degrees(spinning ? 360 : 0))
            .animation(reduceMotion ? nil : .linear(duration: 2).repeatForever(autoreverses: false), value: spinning)
            .onAppear { spinning = true }
            .accessibilityHidden(true)
    }
}

final class SettingsWindowController: NSWindowController, NSWindowDelegate {
    private var inForeground = false

    init(model: SettingsModel) {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 380),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "CoolSwitch Settings"
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: SettingsView(model: model, dismiss: { [weak window] in window?.close() }))
        super.init(window: window)
        if !window.setFrameUsingName("SettingsWindow") { window.center() }
        window.setContentSize(NSSize(width: 400, height: 380))
        window.setFrameAutosaveName("SettingsWindow")
        window.delegate = self
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func present() {
        if !inForeground { inForeground = true; Foreground.begin() }
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        // Coming back from System Settings, macOS may not activate us; still show on top.
        window?.orderFrontRegardless()
        // macOS 14+ declines activation while another app is active, but honors it through
        // Accessibility once we have access. Off the main thread, which has to answer it.
        guard AXIsProcessTrusted(), !NSApp.isActive else { return }
        let app = AXUIElementCreateApplication(ProcessInfo.processInfo.processIdentifier)
        DispatchQueue.global(qos: .userInitiated).async {
            AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
        }
    }

    func windowWillClose(_ notification: Notification) {
        if inForeground { inForeground = false; Foreground.end() }
    }
}
